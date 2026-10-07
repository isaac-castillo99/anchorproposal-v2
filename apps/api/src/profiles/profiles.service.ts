import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';
import { isAdmin, isStaff } from '../common/utils/roles.util';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ProfilesService {
  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  async findAll(user: AuthUser) {
    if (isStaff(user.role)) {
      const profiles = await this.prisma.profile.findMany({
        where: { archivedAt: null },
        include: {
          _count: { select: { assignments: true, applications: true } },
          assignments: {
            where: { userId: user.id, activeTo: null },
            select: { isDefault: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      });

      return profiles.map(({ assignments, ...profile }) => ({
        ...profile,
        isDefault: assignments.some((a) => a.isDefault),
      }));
    }

    const assignments = await this.prisma.profileAssignment.findMany({
      where: { userId: user.id, activeTo: null },
      include: { profile: true },
    });
    return assignments
      .map((a) => ({
        ...a.profile,
        isDefault: a.isDefault,
      }))
      .filter((p) => !p.archivedAt);
  }

  async findOne(id: string, user: AuthUser) {
    await this.checkAccess(id, user);
    return this.prisma.profile.findUnique({
      where: { id },
      include: {
        experiences: { orderBy: { sortOrder: 'asc' } },
        education: { orderBy: { sortOrder: 'asc' } },
        skills: true,
        certifications: true,
        links: true,
      },
    });
  }

  async create(data: Record<string, unknown>) {
    const { experiences, education, skills, certifications, links, ...profileData } = data as {
      experiences?: unknown[];
      education?: unknown[];
      skills?: unknown[];
      certifications?: unknown[];
      links?: unknown[];
      [key: string]: unknown;
    };

    return this.prisma.profile.create({
      data: {
        ...(profileData as object),
        experiences: experiences ? { create: experiences as never[] } : undefined,
        education: education ? { create: education as never[] } : undefined,
        skills: skills ? { create: skills as never[] } : undefined,
        certifications: certifications ? { create: certifications as never[] } : undefined,
        links: links ? { create: links as never[] } : undefined,
      } as never,
      include: {
        experiences: true,
        education: true,
        skills: true,
        certifications: true,
        links: true,
      },
    });
  }

  async update(id: string, data: Record<string, unknown>) {
    const { experiences, education, skills, certifications, links, ...profileData } = data as {
      experiences?: unknown[];
      education?: unknown[];
      skills?: unknown[];
      certifications?: unknown[];
      links?: unknown[];
      [key: string]: unknown;
    };

    return this.prisma.profile.update({
      where: { id },
      data: {
        ...(profileData as object),
        experiences: experiences ? { deleteMany: {}, create: this.copyRows(experiences) } : undefined,
        education: education ? { deleteMany: {}, create: this.copyRows(education) } : undefined,
        skills: skills ? { deleteMany: {}, create: this.copyRows(skills) } : undefined,
        certifications: certifications ? { deleteMany: {}, create: this.copyRows(certifications) } : undefined,
        links: links ? { deleteMany: {}, create: this.copyRows(links) } : undefined,
      } as never,
      include: {
        experiences: true,
        education: true,
        skills: true,
        certifications: true,
        links: true,
      },
    });
  }

  async archive(id: string) {
    return this.prisma.profile.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  private copyRows(rows: unknown[]): never[] {
    return rows.map((row) => {
      const { id: _id, profileId: _profileId, ...data } = row as Record<string, unknown>;
      return data;
    }) as never[];
  }

  async clone(id: string) {
    const original = await this.findOne(id, { id: '', email: '', role: UserRole.ADMIN, firstName: '', lastName: '' });
    if (!original) throw new NotFoundException('Profile not found');

    const { id: _id, createdAt, updatedAt, archivedAt, ...data } = original;
    return this.create({
      ...data,
      firstName: `${data.firstName} (Copy)`,
      experiences: this.copyRows(original.experiences),
      education: this.copyRows(original.education),
      skills: this.copyRows(original.skills),
      certifications: this.copyRows(original.certifications),
      links: this.copyRows(original.links),
    });
  }

  async getAssignedProfiles(userId: string) {
    const assignments = await this.prisma.profileAssignment.findMany({
      where: { userId, activeTo: null },
      include: { profile: true },
    });
    return assignments;
  }

  async getDefaultProfile(userId: string) {
    const assignment = await this.prisma.profileAssignment.findFirst({
      where: { userId, isDefault: true, activeTo: null },
      include: { profile: true },
    });
    return assignment?.profile || null;
  }

  async setDefaultProfile(profileId: string, user: AuthUser) {
    await this.checkAccess(profileId, user);

    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, archivedAt: null },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    await this.prisma.profileAssignment.updateMany({
      where: { userId: user.id, activeTo: null },
      data: { isDefault: false },
    });

    const existing = await this.prisma.profileAssignment.findUnique({
      where: { userId_profileId: { userId: user.id, profileId } },
    });

    if (existing) {
      await this.prisma.profileAssignment.update({
        where: { id: existing.id },
        data: { isDefault: true, activeTo: null },
      });
    } else {
      await this.prisma.profileAssignment.create({
        data: { userId: user.id, profileId, isDefault: true },
      });
    }

    return { success: true, profileId, isDefault: true };
  }

  async checkAccess(profileId: string, user: AuthUser) {
    if (isStaff(user.role)) return;

    const assignment = await this.prisma.profileAssignment.findFirst({
      where: { userId: user.id, profileId, activeTo: null },
    });
    if (!assignment) throw new ForbiddenException('Profile not assigned to you');
  }

  async getProfilePromptAssignments(profileId: string, actor: AuthUser) {
    if (!isStaff(actor.role)) throw new ForbiddenException();
    const profile = await this.prisma.profile.findFirst({
      where: { id: profileId, archivedAt: null },
      select: { id: true, firstName: true, lastName: true, promptVersionId: true },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const [mode, prompts, profileAssignments, existing] = await Promise.all([
      this.settingsService.getPromptAssignmentMode(),
      this.settingsService.listAssignablePrompts(actor),
      this.prisma.profileAssignment.findMany({
        where: {
          profileId,
          activeTo: null,
          user: {
            role: UserRole.BIDDER,
            ...(isAdmin(actor.role) ? { managedByAdminId: actor.id } : {}),
          },
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { user: { firstName: 'asc' } },
      }),
      this.prisma.profilePromptAssignment.findMany({
        where: { profileId },
        select: { userId: true, promptVersionId: true },
      }),
    ]);

    const promptByUser = new Map(existing.map((row) => [row.userId, row.promptVersionId]));
    return {
      mode,
      profile,
      prompts: prompts.map((p) => ({
        id: p.id,
        name: p.name,
        isInitial: p.isInitial,
        ownerId: p.ownerId,
        ownerName: p.owner ? `${p.owner.firstName} ${p.owner.lastName}`.trim() : null,
      })),
      bidders: profileAssignments.map((row) => ({
        id: row.user.id,
        firstName: row.user.firstName,
        lastName: row.user.lastName,
        email: row.user.email,
        promptVersionId: promptByUser.get(row.user.id) ?? null,
      })),
    };
  }

  async updateProfilePromptAssignments(
    profileId: string,
    assignments: { userId: string; promptVersionId: string | null }[],
    actor: AuthUser,
    profilePromptVersionId?: string | null,
  ) {
    if (!isStaff(actor.role)) throw new ForbiddenException();
    const current = await this.getProfilePromptAssignments(profileId, actor);
    const allowedBidders = new Set(current.bidders.map((b) => b.id));
    const promptIds = [
      ...assignments.map((a) => a.promptVersionId).filter((id): id is string => Boolean(id)),
      ...(profilePromptVersionId ? [profilePromptVersionId] : []),
    ];
    await this.settingsService.assertAssignablePrompts(actor, promptIds);

    // Validate every bidder before any shared or bidder-specific prompt is changed.
    for (const row of assignments) {
      if (!allowedBidders.has(row.userId)) {
        throw new ForbiddenException('You can only assign prompts to bidders on this profile');
      }
    }

    if (profilePromptVersionId !== undefined) {
      await this.prisma.profile.update({
        where: { id: profileId },
        data: { promptVersionId: profilePromptVersionId },
      });
    }

    for (const row of assignments) {
      if (!allowedBidders.has(row.userId)) {
        throw new ForbiddenException('You can only assign prompts to bidders on this profile');
      }
      if (!row.promptVersionId) {
        await this.prisma.profilePromptAssignment.deleteMany({
          where: { profileId, userId: row.userId },
        });
        continue;
      }
      await this.prisma.profilePromptAssignment.upsert({
        where: { profileId_userId: { profileId, userId: row.userId } },
        create: { profileId, userId: row.userId, promptVersionId: row.promptVersionId },
        update: { promptVersionId: row.promptVersionId },
      });
    }

    await this.prisma.auditEvent.create({
      data: {
        actorId: actor.id,
        action: 'PROFILE_PROMPT_ASSIGNMENTS_UPDATED',
        targetType: 'Profile',
        targetId: profileId,
        changesJson: { assignments },
      },
    });

    return this.getProfilePromptAssignments(profileId, actor);
  }

  buildProfileSnapshot(profile: NonNullable<Awaited<ReturnType<typeof this.findOne>>>) {
    return {
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      state: profile.state,
      country: profile.country,
      profileTitle: profile.profileTitle,
      summary: profile.summary,
      workAuthorization: profile.workAuthorization,
      experiences: profile.experiences,
      education: profile.education,
      skills: profile.skills,
      certifications: profile.certifications,
      links: profile.links,
    };
  }
}
