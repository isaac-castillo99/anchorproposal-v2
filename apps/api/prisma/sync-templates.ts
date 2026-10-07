import { PrismaClient } from '@prisma/client';
import { TEMPLATE_CATALOG } from './template-catalog';

const prisma = new PrismaClient();

async function main() {
  for (const template of TEMPLATE_CATALOG) {
    const existing = await prisma.templateVersion.findFirst({
      where: { name: template.name, archivedAt: null },
      orderBy: { version: 'desc' },
    });
    if (existing) {
      await prisma.templateVersion.update({
        where: { id: existing.id },
        data: {
          preset: template.preset,
          configJson: template.configJson,
          isPublished: true,
          publishedAt: existing.publishedAt ?? new Date(),
        },
      });
      console.log('updated', template.name);
    } else {
      await prisma.templateVersion.create({
        data: {
          name: template.name,
          preset: template.preset,
          configJson: template.configJson,
          isPublished: true,
          publishedAt: new Date(),
        },
      });
      console.log('created', template.name);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
