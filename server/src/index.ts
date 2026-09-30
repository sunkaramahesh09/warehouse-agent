import { buildApp } from './http/app.js';
import { config, llmConfigured } from './config.js';
import { ensureSeeded } from './db/reset.js';

const seeded = await ensureSeeded();
const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`Warehouse agent API on :${config.port} (seeded now: ${seeded}; LLM ${llmConfigured() ? `configured, model ${config.llm.model}` : 'not configured → deterministic mode'})`);
