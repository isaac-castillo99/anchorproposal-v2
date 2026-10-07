import { BadRequestException } from '@nestjs/common';

export type ExperienceTitleMode = 'saved' | 'tailored';

export function parseExperienceTitleMode(value: unknown): ExperienceTitleMode {
  if (value === undefined || value === 'saved') return 'saved';
  if (value === 'tailored') return 'tailored';
  throw new BadRequestException('Experience titles must use saved profile positions or tailored positions.');
}
