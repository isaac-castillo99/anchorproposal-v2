/// <reference lib="es2022.intl" />

/** Keep the complete sentence, including negation and qualifications around the keyword. */
export function sentenceContaining(text: string, index: number, length: number): string {
  const sentence = new Intl.Segmenter('en', { granularity: 'sentence' });
  const end = index + length;
  const pieces: string[] = [];
  for (const part of sentence.segment(text)) {
    if (part.index >= end) break;
    if (part.index + part.segment.length > index) pieces.push(part.segment);
  }
  return pieces.join('').replace(/\s+/g, ' ').replace(/^\s*[-•*]\s+/, '').trim();
}

export type WarningSource = {
  jobTitle: string;
  company: string;
  jobDescription: string;
  location?: string | null;
  workArrangement?: string | null;
};

export function warningSources(data: WarningSource): string[] {
  return [
    data.jobDescription,
    `Job title: ${data.jobTitle}.`,
    data.location ? `Job location: ${data.location}.` : '',
    data.workArrangement ? `The job is marked as ${data.workArrangement.toLowerCase()} work.` : '',
  ].filter(Boolean);
}

/** Enrich older keyword-only warnings without rewriting saved warning decisions. */
export function contextualWarningText(matchedText: string, category: string, data: WarningSource): string {
  if (category === 'DUPLICATE') {
    return matchedText.startsWith('Duplicate application:')
      ? matchedText
      : `Duplicate application: this profile already has an application to ${data.company}.`;
  }
  const needle = matchedText.trim().toLowerCase();
  if (!needle) return matchedText;
  for (const source of warningSources(data)) {
    const index = source.toLowerCase().indexOf(needle);
    if (index !== -1) return sentenceContaining(source, index, needle.length);
  }
  return matchedText;
}
