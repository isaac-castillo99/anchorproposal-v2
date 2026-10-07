/** Read SSE without assuming that network chunks end on a line or UTF-8 boundary. */
export async function* eventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lines: string[] = [];
  const consume = (line: string) => {
    if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
    if (lines.join('\n').length > 262144) throw new Error('Provider event exceeded the size limit.');
    if (!line && lines.length) { const data = lines.join('\n'); lines = []; return data; }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 524288) throw new Error('Provider stream exceeded the size limit.');
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const data = consume(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
        if (data !== undefined) yield data;
      }
      if (done) break;
    }
    if (buffer) consume(buffer.replace(/\r$/, ''));
    if (lines.length) yield lines.join('\n');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
