/** Use the server's name even when a cached file has older filename metadata. */
export function downloadFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('Content-Disposition') || '';
  const encoded = disposition.match(/(?:^|;)\s*filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try { return decodeURIComponent(encoded[1].trim()); } catch { /* Try the ASCII name below. */ }
  }
  return disposition.match(/(?:^|;)\s*filename="([^"]+)"/i)?.[1] || fallback;
}
