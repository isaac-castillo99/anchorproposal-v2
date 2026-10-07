import { FileType, GenerationFileKind } from '@prisma/client';

export function documentDownloadFilename(
  profileSnapshot: unknown,
  structuredOutput: unknown,
  kind: GenerationFileKind,
  type: FileType,
): string {
  const profile = profileSnapshot as { firstName?: unknown; lastName?: unknown } | null;
  const output = structuredOutput as { contact?: { name?: unknown } } | null;
  const profileName = [profile?.firstName, profile?.lastName]
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim()).filter(Boolean).join(' ');
  const candidateName = typeof output?.contact?.name === 'string' ? output.contact.name : '';
  const cleaned = (profileName || candidateName || 'Applicant')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  // Leave room for the suffix and extension on Windows and other filesystems.
  let name = '';
  for (const character of cleaned) {
    if (Buffer.byteLength(name + character, 'utf8') > 150) break;
    name += character;
  }
  name = name.replace(/[. ]+$/g, '') || 'Applicant';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = `_${name}`;
  return `${name}${kind === GenerationFileKind.COVER_LETTER ? '_cover letter' : ''}.${type.toLowerCase()}`;
}

export function documentAttachmentHeader(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
