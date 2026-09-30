/**
 * LLM provider abstraction. The orchestrator depends only on this interface, so the
 * vendor is a configuration choice (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY).
 */
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage>;
}

export class LLMError extends Error {
  constructor(public code: 'RATE_LIMITED' | 'TIMEOUT' | 'HTTP_ERROR' | 'BAD_RESPONSE' | 'NOT_CONFIGURED', message: string) {
    super(message);
  }
}
