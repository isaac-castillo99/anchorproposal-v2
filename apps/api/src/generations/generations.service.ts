import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RulesService } from '../rules/rules.service';
import { SettingsService } from '../settings/settings.service';
import { TemplatesService } from '../templates/templates.service';
import { DocumentRendererService } from '../documents/document-renderer.service';
import { DeepseekService } from '../deepseek/deepseek.service';
import { FileType, GenerationFileKind, GenerationStatus, UserRole } from '@prisma/client';
import type { GenerationOutput } from '@anchorproposal/shared';
import { AuthUser } from '../common/types/auth.types';
import { canBid, isAdmin, isMaster } from '../common/utils/roles.util';
import { parseExperienceTitleMode, type ExperienceTitleMode } from './experience-title-mode';
import { COVER_LETTER_UNAVAILABLE, usableCoverLetter } from '../deepseek/cover-letter';
import { documentDownloadFilename } from '../documents/download-filename';

export type ManualGenerationInput = {
  responseJson: string;
  contextHash: string;
  idempotencyKey: string;
  templateId?: string;
  experienceTitleMode?: ExperienceTitleMode;
};

@Injectable()
export class GenerationsService {
  constructor(
    private prisma: PrismaService,
    private profilesService: ProfilesService,
    private rulesService: RulesService,
    private settingsService: SettingsService,
    private templatesService: TemplatesService,
    private renderer: DocumentRendererService,
    @InjectQueue('resume-generation') private queue: Queue,
    private deepseek: DeepseekService,
  ) {}

  private async assertAppAccess(application: { bidderId: string; profileId: string }, user: AuthUser) {
    await this.profilesService.checkAccess(application.profileId, user);
    if (isMaster(user.role)) return;
    if (isAdmin(user.role)) {
      if (application.bidderId === user.id) return;
      const bidder = await this.prisma.user.findUnique({ where: { id: application.bidderId } });
      if (bidder?.managedByAdminId === user.id) return;
      throw new ForbiddenException('Access denied');
    }
    if (application.bidderId !== user.id) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async authorizeGeneration(applicationId: string, user: AuthUser) {
    if (!canBid(user.role)) {
      throw new ForbiddenException('Master accounts cannot generate resumes');
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser?.canGenerateResumes) {
      throw new ForbiddenException('You do not have permission to generate resumes');
    }

    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: { warnings: true, profile: true },
    });
    if (!application) throw new NotFoundException('Application not found');

    await this.assertAppAccess(application, user);

    const genCheck = this.rulesService.canGenerate(
      application.warnings.map((w) => ({
        category: w.category,
        matchedText: w.matchedText,
        severity: w.severity,
        behavior: w.behavior,
      })),
    );
    if (!genCheck.allowed) {
      throw new BadRequestException('Generation blocked due to policy warnings');
    }

    return application;
  }

  private async prepareGeneration(profileId: string, user: AuthUser, templateId?: string) {
    if (templateId !== undefined && typeof templateId !== 'string') {
      throw new BadRequestException('Invalid template ID');
    }
    const resolved = await this.settingsService.resolveGenerationPrompt(user, profileId);
    const prompt = resolved.prompt;
    if (!prompt) throw new BadRequestException('No published prompt version');

    let templateVersionId = templateId;
    if (!templateVersionId) {
      templateVersionId = await this.templatesService.resolveDefaultTemplateId(user);
      if (!templateVersionId) {
        throw new BadRequestException(
          user.role === UserRole.BIDDER
            ? 'No template assigned. Ask your Admin to assign a template.'
            : 'No published template available',
        );
      }
    } else {
      await this.templatesService.checkAccess(templateVersionId, user);
      if (user.role === UserRole.BIDDER) {
        const tpl = await this.prisma.templateVersion.findUnique({ where: { id: templateVersionId } });
        if (!tpl?.isPublished) {
          throw new BadRequestException('Bidders may only use published templates');
        }
      }
    }

    const profile = await this.profilesService.findOne(profileId, user);
    const profileSnapshot = this.profilesService.buildProfileSnapshot(profile!);

    return { resolved, prompt, templateVersionId, profileSnapshot, experienceTitleMode: parseExperienceTitleMode(resolved.experienceTitleMode) };
  }

  async startGeneration(
    applicationId: string,
    user: AuthUser,
    templateId?: string,
    idempotencyKey?: string,
    requestedTitleMode?: ExperienceTitleMode,
  ) {
    // Older clients may still send a position choice; the resolved prompt is authoritative.
    parseExperienceTitleMode(requestedTitleMode);
    const application = await this.authorizeGeneration(applicationId, user);
    if (idempotencyKey) {
      const existing = await this.prisma.resumeGeneration.findUnique({ where: { idempotencyKey } });
      if (existing) {
        if (existing.applicationId !== applicationId || existing.creatorId !== user.id) {
          throw new ConflictException('Generation request key is already in use');
        }
        return existing;
      }
    }
    // Reject before creating a generation or adding a job. The worker checks again
    // when it calls the provider, in case configuration changes while queued.
    await this.settingsService.requireApiKey();
    const { prompt, templateVersionId, profileSnapshot, experienceTitleMode } =
      await this.prepareGeneration(application.profileId, user, templateId);
    const generation = await this.prisma.$transaction(async tx => {
      // Web, manual imports, and desktop streams share the same version allocation lock.
      await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId} FOR UPDATE`;
      if (idempotencyKey) {
        const existing = await tx.resumeGeneration.findUnique({ where: { idempotencyKey } });
        if (existing) {
          if (existing.applicationId !== applicationId || existing.creatorId !== user.id) throw new ConflictException('Generation request key is already in use');
          return existing;
        }
      }
      const latestGen = await tx.resumeGeneration.findFirst({ where: { applicationId }, orderBy: { version: 'desc' } });
      return tx.resumeGeneration.create({ data: {
        applicationId, creatorId: user.id, status: GenerationStatus.QUEUED,
        version: (latestGen?.version || 0) + 1, promptVersionId: prompt.id, templateVersionId,
        profileSnapshotJson: profileSnapshot, idempotencyKey, experienceTitleMode,
      } });
    });

    await this.queue.add('generate', {
      generationId: generation.id,
      applicationId,
      userId: user.id,
    }, { jobId: generation.id });

    return generation;
  }

  private async manualGenerationContext(applicationId: string, user: AuthUser, templateId?: string, requestedTitleMode?: ExperienceTitleMode) {
    // Older clients may still send a position choice; the resolved prompt is authoritative.
    parseExperienceTitleMode(requestedTitleMode);
    const application = await this.authorizeGeneration(applicationId, user);
    const context = await this.prepareGeneration(application.profileId, user, templateId);
    const { experienceTitleMode } = context;
    const systemPrompt = this.deepseek.resumeSystemContent(experienceTitleMode);
    const userPrompt = this.deepseek.buildPrompt(context.prompt.content, {
      profileJson: JSON.stringify(context.profileSnapshot),
      jobTitle: application.jobTitle,
      company: application.company,
      jobDescription: application.jobDescription,
      experienceTitleMode,
    });
    // Detect edits while the user works in another model; never silently save against a different prompt.
    const contextHash = createHash('sha256').update(JSON.stringify({
      applicationId, profileId: application.profileId,
      promptId: context.prompt.id, templateId: context.templateVersionId,
      profile: context.profileSnapshot, systemPrompt, userPrompt, experienceTitleMode,
    })).digest('hex');
    return { ...context, application, systemPrompt, userPrompt, contextHash, experienceTitleMode };
  }

  async previewManualGeneration(applicationId: string, user: AuthUser, templateId?: string, experienceTitleMode?: ExperienceTitleMode) {
    const context = await this.manualGenerationContext(applicationId, user, templateId, experienceTitleMode);
    return {
      prompt: `SYSTEM INSTRUCTIONS\n${context.systemPrompt}\n\nRESUME REQUEST\n${context.userPrompt}`,
      contextHash: context.contextHash,
      experienceTitleMode: context.experienceTitleMode,
      templateId: context.templateVersionId,
      usedDefault: context.resolved.usedDefault,
      promptName: context.resolved.promptName,
      profileName: context.resolved.profileName,
    };
  }

  /** A bounded, immediate server stream for the desktop. Provider credentials never leave this service. */
  async streamDesktopGeneration(
    applicationId: string, user: AuthUser,
    input: { templateId?: string; idempotencyKey?: string; experienceTitleMode?: ExperienceTitleMode }, signal: AbortSignal,
    emit: (event: Record<string, unknown>) => void,
  ) {
    if (!input || typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.idempotencyKey)) {
      throw new BadRequestException('A valid generation request key is required.');
    }
    const context = await this.manualGenerationContext(applicationId, user, input.templateId, input.experienceTitleMode);
    const idempotencyKey = `desktop:${user.id}:${applicationId}:${input.idempotencyKey}`;
    const previous = await this.prisma.resumeGeneration.findUnique({ where: { idempotencyKey } });
    if (previous) {
      if (previous.status === GenerationStatus.COMPLETED) { emit({ stage: 'completed', generationId: previous.id }); return; }
      throw new ConflictException('This request was already started. Check Recent applications before retrying.');
    }
    await this.settingsService.requireApiKey();
    signal.throwIfAborted();
    const generation = await this.prisma.$transaction(async (tx) => {
      // A short, database-wide reservation lock works across API instances. No AI work runs under this lock.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(71623091)::text`;
      await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId} FOR UPDATE`;
      const saved = await tx.resumeGeneration.findUnique({ where: { idempotencyKey } });
      if (saved) throw new ConflictException('This request was already started. Check Recent applications.');
      await tx.resumeGeneration.updateMany({
        where: { idempotencyKey: { startsWith: 'desktop:' }, status: GenerationStatus.GENERATING, createdAt: { lt: new Date(Date.now() - 10 * 60_000) } },
        data: { status: GenerationStatus.FAILED, errorMessage: 'The generation connection expired. Please try again.' },
      });
      const active = { idempotencyKey: { startsWith: 'desktop:' }, status: GenerationStatus.GENERATING };
      const [mine, total] = await Promise.all([
        tx.resumeGeneration.count({ where: { ...active, creatorId: user.id } }),
        tx.resumeGeneration.count({ where: active }),
      ]);
      const capacity = Math.max(1, Math.min(256, Number(process.env.DESKTOP_GENERATION_CONCURRENCY) || 16));
      if (mine >= 2 || total >= capacity) throw new ConflictException('Generation capacity is busy. Wait for an active request to finish and try again.');
      const latest = await tx.resumeGeneration.findFirst({ where: { applicationId }, orderBy: { version: 'desc' } });
      return tx.resumeGeneration.create({ data: {
        applicationId, creatorId: user.id, status: GenerationStatus.GENERATING,
        version: (latest?.version || 0) + 1, promptVersionId: context.prompt.id,
        templateVersionId: context.templateVersionId, profileSnapshotJson: context.profileSnapshot, idempotencyKey,
        experienceTitleMode: context.experienceTitleMode,
      } });
    });
    try {
      emit({ stage: 'generating', generationId: generation.id, characters: 0 });
      const snapshot = context.profileSnapshot;
      const result = await this.deepseek.generate(context.userPrompt, {
        experienceTitleMode: context.experienceTitleMode, profileSnapshot: snapshot,
        jobTitle: context.application.jobTitle, company: context.application.company,
        candidateName: `${snapshot.firstName || ''} ${snapshot.lastName || ''}`.trim(),
        profileTitle: snapshot.profileTitle || undefined,
        profileExperiences: snapshot.experiences as unknown as Record<string, unknown>[],
      }, { signal, onProgress: (characters) => emit({ stage: 'generating', characters }) });
      signal.throwIfAborted();
      emit({ stage: 'saving' });
      await this.prisma.$transaction(async (tx) => {
        await tx.resumeGeneration.update({ where: { id: generation.id }, data: {
          status: GenerationStatus.COMPLETED, completedAt: new Date(), tokenUsage: result.tokenUsage,
          structuredOutputJson: JSON.parse(JSON.stringify(result.content)),
          turns: { create: result.transcript.map((turn, index) => ({
            sequence: index + 1, role: turn.role, purpose: `resume_${turn.role}`, content: turn.content,
          })) },
        } });
        await tx.auditEvent.create({ data: { action: 'RESUME_DESKTOP_GENERATED', targetType: 'ResumeGeneration', targetId: generation.id, actorId: user.id } });
      });
      emit({ stage: 'completed', generationId: generation.id, tokenUsage: result.tokenUsage });
    } catch (error) {
      // A disconnect after the save commits must not turn a completed resume into a failure.
      await this.prisma.resumeGeneration.updateMany({ where: { id: generation.id, status: GenerationStatus.GENERATING }, data: {
        status: signal.aborted ? GenerationStatus.CANCELLED : GenerationStatus.FAILED,
        errorMessage: signal.aborted ? 'Generation cancelled or connection closed.' : error instanceof Error ? error.message : 'Generation failed.',
      } });
      throw error;
    }
  }

  async importManualGeneration(applicationId: string, user: AuthUser, input: ManualGenerationInput) {
    if (!input || typeof input.responseJson !== 'string' || !input.responseJson.trim() ||
        input.responseJson.length > 80_000) {
      throw new BadRequestException('Paste a JSON response between 1 and 80,000 characters.');
    }
    if (typeof input.contextHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.contextHash) ||
        typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.idempotencyKey) ||
        (input.templateId !== undefined && typeof input.templateId !== 'string')) {
      throw new BadRequestException('Reload the manual generation prompt before saving.');
    }
    await this.authorizeGeneration(applicationId, user);
    const idempotencyKey = `manual:${user.id}:${applicationId}:${input.idempotencyKey}`;
    const existing = await this.prisma.resumeGeneration.findUnique({ where: { idempotencyKey } });
    parseExperienceTitleMode(input.experienceTitleMode);
    if (existing) {
      return existing;
    }

    const context = await this.manualGenerationContext(applicationId, user, input.templateId, input.experienceTitleMode);
    const { experienceTitleMode } = context;
    if (context.contextHash !== input.contextHash) {
      throw new ConflictException('The profile, job, template, prompt, or experience title mode changed. Reload the prompt and generate a new response before saving.');
    }
    const snapshot = context.profileSnapshot;
    let output: GenerationOutput;
    try {
      output = this.deepseek.parseManualResponse(input.responseJson, {
        experienceTitleMode, profileSnapshot: snapshot,
        jobTitle: context.application.jobTitle,
        company: context.application.company,
        candidateName: `${snapshot.firstName || ''} ${snapshot.lastName || ''}`.trim(),
        profileTitle: snapshot.profileTitle || undefined,
        profileExperiences: snapshot.experiences as unknown as Record<string, unknown>[],
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid resume JSON');
    }

    return this.prisma.$transaction(async (tx) => {
      // Serialize version allocation and retried imports for this application.
      await tx.$queryRaw`SELECT id FROM applications WHERE id = ${applicationId} FOR UPDATE`;
      const saved = await tx.resumeGeneration.findUnique({ where: { idempotencyKey } });
      if (saved) {
        return saved;
      }
      const latest = await tx.resumeGeneration.findFirst({
        where: { applicationId }, orderBy: { version: 'desc' },
      });
      const generation = await tx.resumeGeneration.create({
        data: {
          applicationId, creatorId: user.id,
          status: GenerationStatus.COMPLETED, completedAt: new Date(),
          version: (latest?.version || 0) + 1,
          promptVersionId: context.prompt.id, templateVersionId: context.templateVersionId,
          profileSnapshotJson: snapshot, structuredOutputJson: JSON.parse(JSON.stringify(output)),
          idempotencyKey, experienceTitleMode,
          turns: { create: [
            { sequence: 1, role: 'system', purpose: 'resume_system', content: context.systemPrompt },
            { sequence: 2, role: 'user', purpose: 'resume_user', content: context.userPrompt },
            { sequence: 3, role: 'assistant', purpose: 'resume_assistant', content: JSON.stringify(output) },
          ] },
        },
      });
      await tx.auditEvent.create({ data: {
        action: 'RESUME_MANUALLY_GENERATED', targetType: 'ResumeGeneration',
        targetId: generation.id, actorId: user.id,
      } });
      return generation;
    });
  }

  async previewGenerationPrompt(applicationId: string, user: AuthUser) {
    if (!canBid(user.role)) {
      throw new ForbiddenException('Master accounts cannot generate resumes');
    }
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { bidderId: true, profileId: true },
    });
    if (!application) throw new NotFoundException('Application not found');
    await this.assertAppAccess(application, user);
    const resolved = await this.settingsService.resolveGenerationPrompt(user, application.profileId);
    return {
      experienceTitleModes: ['saved', 'tailored'],
      experienceTitleMode: parseExperienceTitleMode(resolved.experienceTitleMode),
      experienceTitleModeSource: 'prompt',
      usedDefault: resolved.usedDefault,
      promptName: resolved.promptName,
      profileName: resolved.profileName,
    };
  }

  async findByApplication(applicationId: string, user: AuthUser) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw new NotFoundException('Application not found');
    await this.assertAppAccess(application, user);

    return this.prisma.resumeGeneration.findMany({
      where: { applicationId },
      include: { files: true, promptVersion: true, templateVersion: true },
      orderBy: { version: 'desc' },
    });
  }

  async previewHtml(id: string, user: AuthUser) {
    const generation = await this.findOne(id, user);
    if (generation.status !== GenerationStatus.COMPLETED || !generation.structuredOutputJson) {
      throw new BadRequestException('The resume is not ready yet');
    }
    const output = generation.structuredOutputJson as GenerationOutput;
    const html = this.templatesService.renderPreviewHtml(
      {
        contact: output.contact,
        summary: output.summary,
        skills: output.skills,
        experiences: output.experiences,
        educations: output.educations,
        certificates: output.certificates,
      },
      (generation.templateVersion?.configJson || {}) as object,
    );
    const box = this.templatesService.pdfLayout(
      (generation.templateVersion?.configJson || {}) as object,
    );
    return { html, pageSize: box.pageSize };
  }

  async findOne(id: string, user: AuthUser) {
    const gen = await this.prisma.resumeGeneration.findUnique({
      where: { id },
      include: { files: true, application: true, promptVersion: true, templateVersion: true },
    });
    if (!gen) throw new NotFoundException('Generation not found');
    await this.assertAppAccess(gen.application, user);
    return gen;
  }

  async exportFile(
    generationId: string,
    user: AuthUser,
    kind: GenerationFileKind,
    type: FileType,
  ) {
    if (type !== FileType.PDF && type !== FileType.DOCX) {
      throw new BadRequestException('Choose PDF or DOCX');
    }
    if (kind !== GenerationFileKind.RESUME && kind !== GenerationFileKind.COVER_LETTER) {
      throw new BadRequestException('Choose a resume or cover letter');
    }

    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!isMaster(user.role) && !dbUser?.canDownloadDocuments) {
      throw new ForbiddenException('You do not have permission to download documents');
    }

    const generation = await this.prisma.resumeGeneration.findUnique({
      where: { id: generationId },
      include: {
        application: true,
        templateVersion: true,
        files: true,
      },
    });
    if (!generation) throw new NotFoundException('Generation not found');
    await this.assertAppAccess(generation.application, user);
    if (generation.status !== GenerationStatus.COMPLETED || !generation.structuredOutputJson) {
      throw new BadRequestException('The resume is not ready yet');
    }

    const existing = generation.files.find((file) => file.kind === kind && file.type === type);
    const output = generation.structuredOutputJson as GenerationOutput;
    const profile = generation.profileSnapshotJson as { firstName?: string; lastName?: string };
    const baseFilename =
      `${profile.firstName || ''}_${profile.lastName || ''}_${generation.application.company}_${generation.application.jobTitle}`
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .substring(0, 100) + `_v${generation.version}`;
    const templateConfig = (generation.templateVersion?.configJson || {}) as object;
    const candidateName =
      `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || output.contact?.name || 'Applicant';
    const coverLetter = usableCoverLetter(output.coverLetter, candidateName);
    if (kind === GenerationFileKind.COVER_LETTER && !coverLetter) throw new BadRequestException(COVER_LETTER_UNAVAILABLE);

    const built =
      kind === GenerationFileKind.RESUME
        ? await this.renderer.renderAll(
            generation.applicationId,
            generation.id,
            {
              contact: output.contact,
              summary: output.summary,
              skills: output.skills,
              experiences: output.experiences,
              educations: output.educations,
              certificates: output.certificates,
            },
            templateConfig,
            baseFilename,
            [type],
          )
        : await this.renderer.renderCoverLetter(
            generation.applicationId,
            generation.id,
            {
              greeting: coverLetter!.greeting,
              paragraphs: coverLetter!.paragraphs,
              closing: coverLetter!.closing,
              signatureName: candidateName,
              company: generation.application.company,
            },
            baseFilename,
            templateConfig,
            [type],
          );

    const file = built[0];
    if (!file) throw new BadRequestException('Could not build that file');
    if (existing) await this.prisma.generationFile.delete({ where: { id: existing.id } });

    const saved = await this.prisma.generationFile.create({
      data: {
        generationId: generation.id,
        type: file.type,
        kind: file.kind,
        filename: documentDownloadFilename(generation.profileSnapshotJson, output, kind, type),
        storagePath: file.storagePath,
        version: generation.version,
      },
    });
    return { id: saved.id, filename: saved.filename };
  }

  async getAccessibleGeneration(id: string, user: AuthUser) {
    const generation = await this.prisma.resumeGeneration.findUnique({
      where: { id },
      include: { application: true },
    });
    if (!generation) throw new NotFoundException('Generation not found');
    await this.assertAppAccess(generation.application, user);
    return generation;
  }

  async updateStatus(
    id: string,
    status: GenerationStatus,
    data?: Partial<{
      structuredOutputJson: object;
      tokenUsage: number;
      costEstimate: number;
      errorMessage: string;
    }>,
  ) {
    return this.prisma.resumeGeneration.update({
      where: { id },
      data: {
        status,
        ...data,
        ...(status === GenerationStatus.COMPLETED ? { completedAt: new Date() } : {}),
      },
    });
  }
}
