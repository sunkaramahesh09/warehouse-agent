/**
 * Provider for any OpenAI-compatible /chat/completions endpoint with function calling
 * (Google Gemini's OpenAI-compatible API by default; also OpenAI, Groq, etc.).
 * Uses fetch directly: no vendor SDK dependency.
 */
import { config } from '../config.js';
import { LLMError, type ChatMessage, type LLMProvider, type ToolSpec } from './provider.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Process-wide pacing: requests are spaced at least minIntervalMs apart (shared by all runs).
let nextSlot = 0;
async function pace(minIntervalMs: number) {
  if (minIntervalMs <= 0) return;
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + minIntervalMs;
  if (at > now) await sleep(at - now);
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible';
  constructor(
    readonly model = config.llm.model,
    private baseUrl = config.llm.baseUrl.replace(/\/$/, ''),
    private apiKey = config.llm.apiKey,
    private timeoutMs = config.llm.timeoutMs,
    private maxRetries = 3,
  ) {}

  async chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage> {
    if (!this.apiKey) throw new LLMError('NOT_CONFIGURED', 'LLM_API_KEY is not set');
    const body = JSON.stringify({
      model: this.model,
      messages,
      ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}),
      temperature: 0,
    });
    for (let attempt = 0; ; attempt++) {
      await pace(config.llm.minIntervalMs);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
          body,
          signal: ac.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (attempt < this.maxRetries - 1) { await sleep(1000 * (attempt + 1)); continue; }
        throw new LLMError(ac.signal.aborted ? 'TIMEOUT' : 'HTTP_ERROR', `LLM request failed: ${(e as Error).message}`);
      }
      clearTimeout(timer);
      if (res.status === 429 || res.status === 503) {
        const text = await res.text();
        // Gemini puts the wait in the body ("Please retry in 23.1s"); others use Retry-After.
        const hinted = Number(res.headers.get('retry-after')) || Number(/retry in ([\d.]+)s/i.exec(text)?.[1]);
        const waitMs = Number.isFinite(hinted) && hinted > 0 ? hinted * 1000 + 500 : 4000 * 2 ** attempt;
        if (attempt < this.maxRetries - 1 && waitMs <= 35000) { await sleep(waitMs); continue; }
        throw new LLMError('RATE_LIMITED', `LLM provider returned ${res.status} (${/quota|limit/i.test(text) ? 'quota exceeded' : 'overloaded'}) after ${attempt + 1} attempt(s)`);
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        throw new LLMError('HTTP_ERROR', `LLM provider returned ${res.status}: ${text}`);
      }
      const json: any = await res.json();
      const msg = json?.choices?.[0]?.message;
      if (!msg) throw new LLMError('BAD_RESPONSE', 'LLM response had no message');
      return {
        role: 'assistant',
        content: msg.content ?? null,
        ...(msg.extra_content !== undefined ? { extra_content: msg.extra_content } : {}),
        tool_calls: (msg.tool_calls ?? []).map((tc: any, i: number) => ({
          id: tc.id || `call_${Date.now()}_${i}`,
          type: 'function',
          function: { name: tc.function?.name, arguments: tc.function?.arguments ?? '{}' },
          ...(tc.extra_content !== undefined ? { extra_content: tc.extra_content } : {}),
        })),
      };
    }
  }
}
