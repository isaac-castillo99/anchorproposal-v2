const { randomUUID } = require('node:crypto');
async function consumeEvents(body, onEvent) {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 262144) throw new Error('Invalid progress response from the server.');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (line.startsWith('data:')) onEvent(JSON.parse(line.slice(5).trim()));
      }
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
class GenerationRunner {
  constructor(session, onUpdate) { this.session = session; this.onUpdate = onUpdate; this.job = null; this.controller = null; }
  get active() { return !!this.controller; }
  update(patch) { this.job = { ...this.job, ...patch }; this.onUpdate(this.job); }
  start(input) {
    if (this.active) throw new Error('A resume is already generating.');
    if (!input || !/^[\w-]{1,80}$/.test(input.applicationId) || (input.templateId && !/^[\w-]{1,80}$/.test(input.templateId))) throw new Error('Choose an application and template.');
    this.controller = new AbortController();
    this.job = { id: randomUUID(), applicationId: input.applicationId, title: String(input.title || 'Resume').slice(0, 200), startedAt: Date.now(), stage: 'connecting', characters: 0 };
    this.update({});
    this.promise = this.run(input, this.controller);
    return this.job;
  }
  async run(input, controller) {
    try {
      const response = await this.session.request(`/applications/${input.applicationId}/generations/stream`, {
        method: 'POST', body: JSON.stringify({ templateId: input.templateId || undefined, idempotencyKey: this.job.id }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(9 * 60_000)]), binary: true,
      });
      if (!response.ok) await this.session.parse(response);
      if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('This server needs the desktop streaming update.');
      await consumeEvents(response.body, event => {
        if (!['generating', 'saving', 'completed', 'failed'].includes(event.stage)) return;
        const patch = { stage: event.stage };
        if (typeof event.generationId === 'string') patch.generationId = event.generationId;
        if (Number.isFinite(event.characters)) patch.characters = Math.max(this.job.characters || 0, event.characters);
        if (event.stage === 'failed') patch.message = String(event.message || 'Generation failed.').slice(0, 500);
        this.update(patch);
      });
      if (!['completed', 'failed'].includes(this.job.stage)) throw new Error('The connection ended early. Check Recent applications before trying again.');
    } catch (error) {
      if (this.job.stage !== 'completed') this.update({ stage: controller.signal.aborted ? 'cancelled' : 'failed', message: controller.signal.aborted ? 'Generation cancelled.' : error.message || 'Could not connect to your server.' });
    } finally { this.controller = null; this.update({ finishedAt: Date.now() }); }
  }
  cancel() { this.controller?.abort(); }
}
module.exports = { consumeEvents, GenerationRunner };
