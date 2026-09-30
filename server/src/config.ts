/** Central configuration. Secrets come only from environment variables and are never logged. */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/warehouse',
  port: Number(process.env.PORT ?? 3001),
  /** auto = use the LLM when a key is configured, otherwise deterministic. */
  agentMode: (process.env.AGENT_MODE ?? 'auto') as 'auto' | 'llm' | 'deterministic',
  llm: {
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'gemini-3.1-flash-lite',
    // Any OpenAI-compatible chat-completions endpoint (Gemini, OpenAI, Groq, ...).
    baseUrl: process.env.LLM_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 30000),
    /** Client-side pacing to stay under provider RPM limits (free tiers). 0 = off. */
    minIntervalMs: Number(process.env.LLM_MIN_INTERVAL_MS ?? 0),
  },
  toolTimeoutMs: Number(process.env.TOOL_TIMEOUT_MS ?? 5000),
};

export const llmConfigured = () => config.llm.apiKey.length > 0;
