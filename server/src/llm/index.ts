import { config, llmConfigured } from '../config.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { LLMProvider } from './provider.js';

let override: LLMProvider | null | undefined;
/** Tests can inject a scripted provider. */
export function setProviderForTests(p: LLMProvider | null | undefined) { override = p; }

export function getProvider(): LLMProvider | null {
  if (override !== undefined) return override;
  if (config.agentMode === 'deterministic' || !llmConfigured()) return null;
  return new OpenAICompatibleProvider();
}

export function describeLLM() {
  return { configured: llmConfigured(), mode: config.agentMode, model: llmConfigured() ? config.llm.model : null, base_url_host: llmConfigured() ? new URL(config.llm.baseUrl).host : null };
}
