import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/types/auth.types';
import { isAdmin, isMaster } from '../common/utils/roles.util';
import { DEFAULT_PROMPT } from '@anchorproposal/shared';
import { parseExperienceTitleMode, type ExperienceTitleMode } from '../generations/experience-title-mode';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  static readonly PROMPT_MODE_KEY = 'prompt_assignment_mode';
  static readonly BUILTIN_DEFAULT_PROMPT_ID = 'e17b921b-41c9-4b4a-83c1-1dfd6c7b687c';
  static readonly ANSWER_PROMPT_KEY = 'answer_prompt';
  static readonly DEFAULT_ANSWER_PROMPT = [
    'Continue this same conversation. You already wrote the resume above.',
    '',
    'I will ask job-application questions next, one at a time. Answer each later question as the candidate, using only facts from that resume and profile. Do not rewrite the resume. Do not answer any question in this reply.',
    '',
    'Reply to this message with only the single word: yes',
  ].join('\n');

  /** Shared initial prompt, with the bundled default for databases that have none. */
  async getMasterPublishedPrompt() {
    const published = await this.prisma.promptVersion.findMany({
      where: { ownerId: null, isPublished: true, isPersonalDefault: false },
      orderBy: [{ isInitial: 'desc' }, { publishedAt: 'desc' }],
    });
    const shared = published.find((prompt) => prompt.content.trim());
    if (shared) return shared;

    // Persist it because resume generations reference a real prompt version. A fixed
    // ID makes simultaneous first loads idempotent; never overwrite an existing edit.
    const fallback = await this.prisma.promptVersion.upsert({
      where: { id: SettingsService.BUILTIN_DEFAULT_PROMPT_ID },
      update: {},
      create: {
        id: SettingsService.BUILTIN_DEFAULT_PROMPT_ID,
        name: 'Default resume prompt', content: DEFAULT_PROMPT,
        ownerId: null, isInitial: true, isPublished: true, publishedAt: new Date(),
      },
    });
    return fallback.ownerId === null && fallback.isPublished && !fallback.isPersonalDefault && fallback.content.trim()
      ? fallback : null;
  }

  async getPromptAssignmentMode(user?: { id: string; role: string }): Promise<'user' | 'profile'> {
    // This choice affects the admin's own generations, not other admins or assigned bidders.
    if (!user || !isAdmin(user.role)) return 'profile';
    const admin = await this.prisma.user.findUnique({ where: { id: user.id } });
    return admin?.generationPromptMode === 'user' ? 'user' : 'profile';
  }

  async setPromptAssignmentMode(user: AuthUser, mode: 'user' | 'profile') {
    if (!isAdmin(user.role)) throw new ForbiddenException('Only admins can change their generation prompt');
    if (mode !== 'user' && mode !== 'profile') {
      throw new BadRequestException('Prompt mode must be user or profile');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { generationPromptMode: mode },
    });
    return { mode };
  }

  /** @deprecated Prefer resolvePromptForUser — kept for callers expecting global publish. */
  async getPublishedPrompt() {
    return this.getMasterPublishedPrompt();
  }

  async getMasterPrompts() {
    return this.prisma.promptVersion.findMany({
      where: { ownerId: null, archivedAt: null },
      orderBy: { version: 'desc' },
    });
  }

  async createMasterPrompt(content: string, name?: string, requestedMode?: ExperienceTitleMode) {
    const experienceTitleMode = parseExperienceTitleMode(requestedMode);
    if (!content?.trim()) throw new BadRequestException('Prompt content is required');
    const latest = await this.prisma.promptVersion.findFirst({
      where: { ownerId: null },
      orderBy: { version: 'desc' },
    });
    const hasInitial = await this.prisma.promptVersion.findFirst({
      where: { ownerId: null, isInitial: true },
      select: { id: true },
    });
    if (!hasInitial && experienceTitleMode !== 'saved') throw new BadRequestException('The default prompt must use fixed profile positions.');
    return this.prisma.promptVersion.create({
      data: {
        experienceTitleMode,
        name: name?.trim() || `Prompt ${(latest?.version || 0) + 1}`,
        content: content.trim(),
        version: (latest?.version || 0) + 1,
        ownerId: null,
        isPublished: true,
        isInitial: !hasInitial,
        publishedAt: new Date(),
      },
    });
  }

  /** Marks a master prompt as the initial fallback without hiding the others. */
  async publishMasterPrompt(id: string) {
    const prompt = await this.prisma.promptVersion.findUnique({ where: { id } });
    if (!prompt || prompt.archivedAt || prompt.ownerId !== null) {
      throw new NotFoundException('Master prompt not found');
    }
    await this.prisma.promptVersion.updateMany({
      where: { ownerId: null },
      data: { isInitial: false },
    });
    return this.prisma.promptVersion.update({
      where: { id },
      data: { isPublished: true, isInitial: true, experienceTitleMode: 'saved', publishedAt: prompt.publishedAt ?? new Date() },
    });
  }

  async updateMasterPrompt(id: string, content: string, name?: string) {
    if (!content?.trim()) throw new BadRequestException('Prompt content is required');
    const prompt = await this.prisma.promptVersion.findUnique({ where: { id } });
    if (!prompt || prompt.archivedAt || prompt.ownerId !== null) {
      throw new NotFoundException('Master prompt not found');
    }
    return this.prisma.promptVersion.update({
      where: { id },
      data: {
        content: content.trim(),
        ...(name?.trim() ? { name: name.trim() } : {}),
      },
    });
  }

  async deleteMasterPrompt(id: string) {
    const prompt = await this.prisma.promptVersion.findUnique({ where: { id } });
    if (!prompt || prompt.archivedAt || prompt.ownerId !== null) {
      throw new NotFoundException('Master prompt not found');
    }
    await this.deletePromptRecord(id);
    return { success: true, id };
  }

  private promptSelect = {
    id: true,
    name: true,
    content: true,
    version: true,
    isPublished: true,
    isInitial: true,
    experienceTitleMode: true,
    ownerId: true,
    owner: { select: { id: true, firstName: true, lastName: true, role: true } },
  } as const;

  /** Prompts this staff user can edit. Bidders cannot add prompts. */
  async listManagedPrompts(actor: AuthUser) {
    if (!isMaster(actor.role) && !isAdmin(actor.role)) {
      throw new ForbiddenException('Only admins and master can manage prompts');
    }
    return this.prisma.promptVersion.findMany({
      where: { ...(isMaster(actor.role) ? { ownerId: null } : { ownerId: actor.id }), isPersonalDefault: false, archivedAt: null },
      orderBy: [{ isInitial: 'desc' }, { updatedAt: 'desc' }],
      select: this.promptSelect,
    });
  }

  /** Prompts that can be assigned to a bidder. */
  async listAssignablePrompts(actor: AuthUser) {
    if (!isMaster(actor.role) && !isAdmin(actor.role)) {
      throw new ForbiddenException('Only admins and master can assign prompts');
    }
    return this.prisma.promptVersion.findMany({
      where: isMaster(actor.role)
        ? {
            isPublished: true,
            isPersonalDefault: false,
            archivedAt: null,
            OR: [{ ownerId: null }, { owner: { role: 'ADMIN' } }],
          }
        : {
            isPublished: true,
            isPersonalDefault: false,
            archivedAt: null,
            OR: [{ ownerId: null }, { ownerId: actor.id }],
          },
      orderBy: [{ isInitial: 'desc' }, { name: 'asc' }],
      select: this.promptSelect,
    });
  }

  async assertAssignablePrompts(actor: AuthUser, ids: string[]) {
    if (ids.length === 0) return;
    const allowed = await this.listAssignablePrompts(actor);
    const allowedIds = new Set(allowed.map((p) => p.id));
    if (ids.some((id) => !allowedIds.has(id))) {
      throw new BadRequestException('One or more prompts cannot be assigned');
    }
  }

  async createLibraryPrompt(actor: AuthUser, data: { name: string; content: string; experienceTitleMode?: ExperienceTitleMode }) {
    const experienceTitleMode = parseExperienceTitleMode(data.experienceTitleMode);
    const name = data.name?.trim();
    const content = data.content?.trim();
    if (!name) throw new BadRequestException('Prompt name is required');
    if (!content) throw new BadRequestException('Prompt content is required');
    if (isMaster(actor.role)) {
      return this.createMasterPrompt(content, name, experienceTitleMode);
    }
    if (!isAdmin(actor.role)) {
      throw new ForbiddenException('Bidders cannot add prompts');
    }
    const latest = await this.prisma.promptVersion.findFirst({
      where: { ownerId: actor.id },
      orderBy: { version: 'desc' },
    });
    return this.prisma.promptVersion.create({
      data: {
        name,
        content,
        experienceTitleMode,
        version: (latest?.version || 0) + 1,
        ownerId: actor.id,
        isPublished: true,
        publishedAt: new Date(),
      },
      select: this.promptSelect,
    });
  }

  async updateLibraryPrompt(
    actor: AuthUser,
    id: string,
    data: { name?: string; content?: string; experienceTitleMode?: ExperienceTitleMode },
  ) {
    const prompt = await this.prisma.promptVersion.findUnique({ where: { id } });
    if (!prompt || prompt.archivedAt) throw new NotFoundException('Prompt not found');
    this.assertCanEditPrompt(actor, prompt.ownerId);
    const experienceTitleMode = data.experienceTitleMode === undefined ? parseExperienceTitleMode(prompt.experienceTitleMode) : parseExperienceTitleMode(data.experienceTitleMode);
    if ((prompt.isInitial || prompt.isPersonalDefault) && experienceTitleMode !== 'saved') {
      throw new BadRequestException('Default prompts must use fixed profile positions.');
    }
    const name = data.name?.trim();
    const content = data.content?.trim();
    if (data.content !== undefined && !content) {
      throw new BadRequestException('Prompt content is required');
    }
    if (data.name !== undefined && !name) {
      throw new BadRequestException('Prompt name is required');
    }
    return this.prisma.promptVersion.update({
      where: { id },
      data: {
        experienceTitleMode,
        ...(name ? { name } : {}),
        ...(content ? { content } : {}),
      },
      select: this.promptSelect,
    });
  }

  async deleteLibraryPrompt(actor: AuthUser, id: string) {
    const prompt = await this.prisma.promptVersion.findUnique({ where: { id } });
    if (!prompt || prompt.archivedAt) throw new NotFoundException('Prompt not found');
    this.assertCanEditPrompt(actor, prompt.ownerId);
    await this.deletePromptRecord(id);
    return { success: true, id };
  }

  private assertCanEditPrompt(actor: AuthUser, ownerId: string | null) {
    if (isMaster(actor.role)) {
      if (ownerId !== null) {
        throw new ForbiddenException('Master edits the shared prompt library from Settings');
      }
      return;
    }
    if (isAdmin(actor.role) && ownerId === actor.id) return;
    throw new ForbiddenException('You can only edit your own prompts');
  }

  private async deletePromptRecord(id: string) {
    // Keep the referenced prompt for existing resume versions and queued jobs.
    // Removing it from the library also removes active assignments, just as a
    // physical delete would, without deleting any generated resumes.
    await this.prisma.$transaction(async (tx) => {
      const assignedUsers = await tx.promptAssignment.findMany({ where: { promptVersionId: id }, select: { userId: true } });
      await tx.promptVersion.update({ where: { id }, data: { archivedAt: new Date(), isPublished: false, isInitial: false } });
      await tx.promptAssignment.deleteMany({ where: { promptVersionId: id } });
      await tx.profilePromptAssignment.deleteMany({ where: { promptVersionId: id } });
      await tx.profile.updateMany({ where: { promptVersionId: id }, data: { promptVersionId: null } });
      await tx.user.updateMany({ where: { selectedPromptId: id }, data: { selectedPromptId: null, useMasterPrompt: true } });
      // Removing a bidder's final assignment must leave a usable default.
      await tx.user.updateMany({
        where: {
          id: { in: assignedUsers.map(row => row.userId) },
          role: 'BIDDER',
          useMasterPrompt: false,
          promptAssignments: { none: { promptVersion: { archivedAt: null } } },
          ownedPrompts: { none: { isPublished: true, archivedAt: null } },
        },
        data: { useMasterPrompt: true },
      });
    });
  }

  private async getAdminPublishedPrompt(adminId: string) {
    return this.prisma.promptVersion.findFirst({
      where: { isPublished: true, ownerId: adminId },
      orderBy: { publishedAt: 'desc' },
    });
  }

  private async getBidderPublishedPrompt(bidderId: string) {
    return this.prisma.promptVersion.findFirst({
      where: { isPublished: true, ownerId: bidderId },
      orderBy: { publishedAt: 'desc' },
    });
  }

  /**
   * Prompt assigned to this user for a profile, or the prompt assigned to the profile itself.
   */
  private async findProfileAssignedPrompt(userId: string, profileId: string) {
    const [override, profile] = await Promise.all([
      this.prisma.profilePromptAssignment.findUnique({
        where: { profileId_userId: { profileId, userId } },
        include: { promptVersion: true },
      }),
      this.prisma.profile.findUnique({
        where: { id: profileId },
        include: { assignedPrompt: true },
      }),
    ]);
    return {
      profile,
      prompt: (override?.promptVersion && !override.promptVersion.archivedAt ? override.promptVersion : null)
        ?? (profile?.assignedPrompt && !profile.assignedPrompt.archivedAt ? profile.assignedPrompt : null),
    };
  }

  /**
   * Generation uses the profile's assigned prompt when one exists.
   * Otherwise it uses the bidder or admin default prompt.
   */
  async resolveGenerationPrompt(
    user: AuthUser | { id: string; role: string },
    profileId: string,
  ) {
    const { profile, prompt: assigned } = await this.findProfileAssignedPrompt(user.id, profileId);
    if (!profile) throw new NotFoundException('Profile not found');
    const profileName = `${profile.firstName} ${profile.lastName}`.trim();
    const mode = await this.getPromptAssignmentMode(user);
    if (mode === 'profile' && assigned && !assigned.isPersonalDefault) {
      return {
        usedDefault: false as const,
        experienceTitleMode: assigned.isInitial ? 'saved' as const : parseExperienceTitleMode(assigned.experienceTitleMode),
        promptName: assigned.name,
        profileName,
        prompt: assigned,
      };
    }
    const prompt = await this.resolvePromptForUser(user);
    return {
      // Falling back is only a warning when the admin chose profile assignments.
      usedDefault: mode === 'profile',
      experienceTitleMode: 'saved' as const,
      promptName: prompt.name,
      profileName,
      prompt,
    };
  }

  /**
   * Resolve the prompt used for generations.
   * A profile assignment wins. Otherwise the bidder's default prompt, then the initial prompt.
   */
  async resolvePromptForUser(
    user: AuthUser | { id: string; role: string },
    options?: { profileId?: string },
  ): Promise<{ id: string; name: string; content: string; version: number; isPublished: boolean }> {
    if (isMaster(user.role)) {
      const prompt = await this.getMasterPublishedPrompt();
      if (!prompt) throw new BadRequestException('No published initial prompt');
      return prompt;
    }

    if (isAdmin(user.role)) {
      const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
      if (!dbUser) throw new NotFoundException('User not found');
      if (dbUser.useMasterPrompt) {
        const prompt = await this.getMasterPublishedPrompt();
        if (!prompt) throw new BadRequestException('No published initial prompt');
        return prompt;
      }
      if (dbUser.selectedPromptId) {
        const selected = await this.prisma.promptVersion.findFirst({
          where: { id: dbUser.selectedPromptId, ownerId: user.id, isPublished: true },
        });
        if (selected) return selected;
      }
      const custom = await this.getAdminPublishedPrompt(user.id);
      if (!custom) {
        throw new BadRequestException(
          'You selected a custom prompt but have not saved one yet. Add a prompt in Settings.',
        );
      }
      return custom;
    }

    const bidder = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!bidder?.managedByAdminId) {
      throw new BadRequestException('Bidder is not assigned to an admin; cannot resolve prompt');
    }

    if (options?.profileId) {
      const { prompt: assigned } = await this.findProfileAssignedPrompt(user.id, options.profileId);
      if (assigned && !assigned.isPersonalDefault) return assigned;
    }

    const assigned = await this.prisma.promptAssignment.findFirst({
      where: { userId: user.id, promptVersion: { archivedAt: null } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { promptVersion: true },
    });
    if (assigned?.promptVersion && !assigned.promptVersion.isPersonalDefault) return assigned.promptVersion;

    if (bidder.useMasterPrompt !== false) {
      const prompt = await this.getMasterPublishedPrompt();
      if (!prompt) throw new BadRequestException('No published initial prompt');
      return prompt;
    }

    const custom = await this.getBidderPublishedPrompt(bidder.id);
    if (!custom) {
      throw new BadRequestException(
        'No prompt assigned yet. Ask your Admin to assign a prompt.',
      );
    }
    return custom;
  }

  async getMyPromptSettings(user: AuthUser) {
    const masterPrompt = await this.getMasterPublishedPrompt();
    const assignmentMode = await this.getPromptAssignmentMode(user);

    if (isMaster(user.role)) {
      return {
        role: 'MASTER' as const,
        useMasterPrompt: true,
        promptSource: 'initial' as const,
        assignmentMode,
        masterPrompt,
        myPrompt: null,
        myPrompts: [] as { id: string; name: string; content: string }[],
        assignedPrompts: [] as { id: string; name: string; isDefault: boolean }[],
        profilePrompts: [] as { profileName: string; promptName: string }[],
        selectedPromptId: null as string | null,
        effectivePrompt: masterPrompt,
      };
    }

    if (isAdmin(user.role)) {
      const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
      const myPrompts = await this.prisma.promptVersion.findMany({
        where: { ownerId: user.id, isPublished: true, isPersonalDefault: false },
        orderBy: { updatedAt: 'desc' },
      });
      const selected = dbUser?.selectedPromptId
        ? await this.prisma.promptVersion.findFirst({ where: { id: dbUser.selectedPromptId, ownerId: user.id, isPublished: true } })
        : await this.getAdminPublishedPrompt(user.id);
      const useMasterPrompt = dbUser?.useMasterPrompt ?? true;
      let effectivePrompt = masterPrompt;
      if (!useMasterPrompt && selected) effectivePrompt = selected;
      else if (!useMasterPrompt && !selected) effectivePrompt = null;
      return {
        role: 'ADMIN' as const,
        useMasterPrompt,
        promptSource: (useMasterPrompt ? 'initial' : 'custom') as 'initial' | 'custom',
        assignmentMode,
        masterPrompt,
        myPrompt: selected,
        myPrompts,
        assignedPrompts: [],
        profilePrompts: [],
        selectedPromptId: dbUser?.selectedPromptId ?? selected?.id ?? null,
        effectivePrompt,
      };
    }

    const bidder = await this.prisma.user.findUnique({ where: { id: user.id } });
    const assignedRows = await this.prisma.promptAssignment.findMany({
      where: { userId: user.id, promptVersion: { archivedAt: null } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      include: { promptVersion: { select: { id: true, name: true, content: true } } },
    });
    const assignedPrompts = assignedRows.map((row) => ({
      id: row.promptVersion.id,
      name: row.promptVersion.name,
      content: row.promptVersion.content,
      isDefault: row.isDefault,
    }));
    const profileRows = await this.prisma.profilePromptAssignment.findMany({
      where: { userId: user.id, promptVersion: { archivedAt: null } },
      include: {
        promptVersion: { select: { name: true } },
        profile: { select: { firstName: true, lastName: true } },
      },
    });
    const useMasterPrompt = assignedPrompts.length === 0 && bidder?.useMasterPrompt !== false;
    const effectivePrompt = await this.resolvePromptForUser(user).catch(() => null);

    return {
      role: 'BIDDER' as const,
      useMasterPrompt,
      promptSource: (useMasterPrompt ? 'initial' : 'custom') as 'initial' | 'custom',
      assignmentMode,
      masterPrompt: useMasterPrompt ? masterPrompt : null,
      myPrompt: effectivePrompt,
      myPrompts: [],
      assignedPrompts,
      profilePrompts: profileRows.map((row) => ({
        profileName: `${row.profile.firstName} ${row.profile.lastName}`.trim(),
        promptName: row.promptVersion.name,
      })),
      selectedPromptId: assignedPrompts.find((p) => p.isDefault)?.id ?? assignedPrompts[0]?.id ?? null,
      effectivePrompt,
    };
  }

  async updateMyPromptSettings(
    user: AuthUser,
    data: { mode?: 'user' | 'profile'; content?: string; resetToDefault?: boolean },
  ) {
    if (!isAdmin(user.role)) {
      throw new ForbiddenException('Only admins can update their prompt settings');
    }

    if (!data || (data.mode === undefined && data.content === undefined && data.resetToDefault !== true)) {
      throw new BadRequestException('Choose a prompt mode or edit the default prompt');
    }
    if (data.mode !== undefined && data.mode !== 'user' && data.mode !== 'profile') {
      throw new BadRequestException('Prompt mode must be user or profile');
    }
    if (data.resetToDefault !== undefined && typeof data.resetToDefault !== 'boolean') {
      throw new BadRequestException('Invalid reset option');
    }
    if (data.content !== undefined && (typeof data.content !== 'string' || !data.content.trim() || data.content.length > 80_000)) {
      throw new BadRequestException('Prompt content must contain between 1 and 80,000 characters');
    }
    if (data.resetToDefault && data.content !== undefined) {
      throw new BadRequestException('Choose either a default reset or edited content');
    }
    if (data.resetToDefault) {
      const shared = await this.getMasterPublishedPrompt();
      if (!shared?.content.trim()) {
        throw new BadRequestException('The shared default prompt is unavailable. Your current prompt has not been changed.');
      }
    }
    const current = data.content !== undefined ? (await this.getMyPromptSettings(user)).effectivePrompt : null;
    await this.prisma.$transaction(async (tx) => {
      const patch: { generationPromptMode?: string; useMasterPrompt?: boolean; selectedPromptId?: string | null } = {};
      if (data.mode) patch.generationPromptMode = data.mode;
      if (data.resetToDefault) {
        patch.useMasterPrompt = true;
        patch.selectedPromptId = null;
      } else if (data.content !== undefined && data.content.trim() !== current?.content.trim()) {
        // Always copy: editing a default must never change a shared or assigned library prompt.
        const latest = await tx.promptVersion.findFirst({ where: { ownerId: user.id }, orderBy: { version: 'desc' } });
        const created = await tx.promptVersion.create({ data: {
          name: 'My default prompt', content: data.content.trim(), ownerId: user.id,
          version: (latest?.version || 0) + 1, isPublished: true, publishedAt: new Date(),
          isPersonalDefault: true,
        } });
        patch.selectedPromptId = created.id;
        patch.useMasterPrompt = false;
      }
      if (Object.keys(patch).length) await tx.user.update({ where: { id: user.id }, data: patch });
    });

    return this.getMyPromptSettings(user);
  }

  async getAiSettings() {
    const key = await this.getApiKey();
    const model = await this.prisma.systemSetting.findUnique({ where: { key: 'deepseek_model' } });
    return {
      hasApiKey: !!key,
      model: model?.value || 'deepseek-v4-flash',
    };
  }

  async updateAiSettings(data: { apiKey?: string; model?: string }) {
    if (!data || (data.apiKey !== undefined && typeof data.apiKey !== 'string') ||
        (data.model !== undefined && typeof data.model !== 'string')) {
      throw new BadRequestException('API key and model must be text');
    }
    const apiKey = data.apiKey?.trim();
    if (apiKey) {
      await this.prisma.systemSetting.upsert({
        where: { key: 'deepseek_api_key' },
        create: { key: 'deepseek_api_key', value: apiKey },
        update: { value: apiKey },
      });
    }
    if (data.model) {
      await this.prisma.systemSetting.upsert({
        where: { key: 'deepseek_model' },
        create: { key: 'deepseek_model', value: data.model },
        update: { value: data.model },
      });
    }
    return this.getAiSettings();
  }

  async getApiKey(): Promise<string | null> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'deepseek_api_key' } });
    // Settings and every provider call must use the same Master-managed key.
    return setting?.value?.trim() || null;
  }

  async requireApiKey(): Promise<string> {
    const key = await this.getApiKey();
    if (!key) {
      throw new BadRequestException('AI generation is unavailable. Ask Master to save a DeepSeek API key in Settings → AI Provider.');
    }
    return key;
  }

  async getModel(): Promise<string> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'deepseek_model' } });
    return setting?.value || 'deepseek-v4-flash';
  }

  async getAnswerPrompt(): Promise<string> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: SettingsService.ANSWER_PROMPT_KEY },
    });
    const value = setting?.value?.trim();
    return value || SettingsService.DEFAULT_ANSWER_PROMPT;
  }

  async setAnswerPrompt(prompt: string): Promise<string> {
    const value = prompt?.trim() || SettingsService.DEFAULT_ANSWER_PROMPT;
    if (value.length > 20_000) {
      throw new BadRequestException('Answer prompt is too long');
    }
    await this.prisma.systemSetting.upsert({
      where: { key: SettingsService.ANSWER_PROMPT_KEY },
      create: { key: SettingsService.ANSWER_PROMPT_KEY, value },
      update: { value },
    });
    return value;
  }
}
