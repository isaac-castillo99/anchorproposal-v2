import { coverLetterSchema, type CoverLetterContent } from '@anchorproposal/shared';

export const COVER_LETTER_INSTRUCTIONS = [
  'Include a coverLetter object in the same JSON response: {"greeting":"Dear Hiring Manager,","paragraphs":["Opening tailored to the role and company","Specific candidate evidence linked to the job requirements","Closing tailored to the opportunity"],"closing":"Sincerely,","signatureName":"Candidate name"}.',
  'Write a complete, natural cover letter with 3-4 substantive paragraphs, tailored to this job description and company. Connect at least two relevant, supported skills or contributions from the candidate resume to the advertised responsibilities. Do not invent achievements, metrics, qualifications, personal motivations, or company facts.',
  'Follow the custom prompt cover-letter style instructions within this JSON format. Return no separate plain-text letter or text outside the JSON. Use the saved candidate name for the signature.',
].join(' ');

export const COVER_LETTER_UNAVAILABLE = 'This resume has no tailored cover letter. Regenerate the resume, or import JSON containing coverLetter with greeting, paragraphs, closing, and signatureName. The old default letter is no longer used.';

/** Recognize usable content, excluding the exact legacy placeholder letters. */
export function usableCoverLetter(value: unknown, candidateName?: string): CoverLetterContent | undefined {
  const parsed = coverLetterSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const letter = parsed.data;
  const paragraphs = letter.paragraphs.map(p => p.trim());
  if (!letter.greeting.trim() || !letter.closing.trim() || paragraphs.some(p => !p)) return undefined;
  const normalized = paragraphs.map(p => p.replace(/\s+/g, ' ').toLowerCase());
  if (normalized.includes('my experience and skills, as outlined in my resume, align well with what you are looking for, and i would welcome the opportunity to contribute to your team.')) return undefined;
  if (paragraphs.length === 1 && /^i am writing to express my interest in the .+ (role|position) at .+\.$/i.test(paragraphs[0])) return undefined;
  return { greeting: letter.greeting.trim(), paragraphs, closing: letter.closing.trim(), signatureName: candidateName?.trim() || letter.signatureName?.trim() || undefined };
}
