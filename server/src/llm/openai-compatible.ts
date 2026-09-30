/**
 * Provider for any OpenAI-compatible /chat/completions endpoint with function calling
 * (Google Gemini's OpenAI-compatible API by default; also OpenAI, Groq, etc.).
 * Uses fetch directly: no vendor SDK dependency.
 */
import { config } from '../config.js';
import { LLMError, type ChatMessage, type LLMProvider, type ToolSpec } from './provider.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
        if (attempt < this.maxRetries - 1) {
          const ra = Number(res.headers.get('retry-after'));
          await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 4000 * 2 ** attempt);
          continue;
        }
        throw new LLMError('RATE_LIMITED', `LLM provider returned ${res.status} after ${this.maxRetries} attempts`);
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
        tool_calls: (msg.tool_calls ?? []).map((tc: any, i: number) => ({
          id: tc.id || `call_${Date.now()}_${i}`,
          type: 'function',
          function: { name: tc.function?.name, arguments: tc.function?.arguments ?? '{}' },
        })),
      };
    }
  }
}
