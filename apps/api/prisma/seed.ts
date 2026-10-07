import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs/promises';
import * as path from 'path';
import { STARTER_WARNING_RULES } from '@anchorproposal/shared';
import { TEMPLATE_CATALOG } from './template-catalog';

const prisma = new PrismaClient();

const STORAGE_PATH = process.env.STORAGE_PATH || path.join(process.cwd(), 'storage');
const SEED_PROFILE_EMAIL = 'alexandra.chen@email.com';

async function removeDemoData() {
  const oldDemoApps = await prisma.application.findMany({
    where: { company: { startsWith: 'Demo Co' } },
    select: { id: true },
  });
  for (const old of oldDemoApps) {
    try {
      await fs.rm(path.join(STORAGE_PATH, 'resumes', old.id), { recursive: true, force: true });
    } catch {
      // ignore missing storage
    }
  }
  await prisma.application.deleteMany({ where: { company: { startsWith: 'Demo Co' } } });

  const seedProfile = await prisma.profile.findFirst({ where: { email: SEED_PROFILE_EMAIL } });
  if (seedProfile) {
    const profileApps = await prisma.application.findMany({
      where: { profileId: seedProfile.id },
      select: { id: true },
    });
    for (const app of profileApps) {
      try {
        await fs.rm(path.join(STORAGE_PATH, 'resumes', app.id), { recursive: true, force: true });
      } catch {
        // ignore missing storage
      }
    }
    await prisma.application.deleteMany({ where: { profileId: seedProfile.id } });
    await prisma.profileAssignment.deleteMany({ where: { profileId: seedProfile.id } });
    await prisma.profile.delete({ where: { id: seedProfile.id } });
  }
}

async function main() {
  await removeDemoData();

  const masterPassword = process.env.MASTER_PASSWORD || 'master@2005$@&';
  const masterHash = await bcrypt.hash(masterPassword, 10);
  const adminHash = await bcrypt.hash('admin123', 10);
  const bidderHash = await bcrypt.hash('bidder123', 10);

  const master = await prisma.user.upsert({
    where: { email: 'master@anchorproposal.com' },
    update: {
      username: 'Master',
      role: UserRole.MASTER,
      status: 'ACTIVE',
      passwordHash: masterHash,
    },
    create: {
      email: 'master@anchorproposal.com',
      username: 'Master',
      passwordHash: masterHash,
      firstName: 'Master',
      lastName: 'Account',
      role: UserRole.MASTER,
      status: 'ACTIVE',
    },
  });

  

  for (const rule of STARTER_WARNING_RULES) {
    const existing = await prisma.warningRule.findFirst({
      where: { category: rule.category as 'REMOTE_CONFLICT', pattern: rule.pattern },
    });
    if (!existing) {
      await prisma.warningRule.create({
        data: {
          category: rule.category as 'REMOTE_CONFLICT',
          pattern: rule.pattern,
          severity: rule.severity as 'CONFIRM',
          behavior: rule.behavior as 'CONFIRM',
        },
      });
    }
  }

  for (const t of TEMPLATE_CATALOG) {
    const exists = await prisma.templateVersion.findFirst({ where: { name: t.name } });
    if (!exists) {
      await prisma.templateVersion.create({
        data: { ...t, isPublished: true, publishedAt: new Date() },
      });
    }
  }

  console.log('Seed completed (baseline only):', {
    master: `${master.username} / ${masterPassword}`
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
