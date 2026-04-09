/**
 * OpenCode — Central Configuration
 * Loads and validates all environment variables. Single source of truth for config.
 */

import 'dotenv/config';
import { z } from 'zod';

// ─── Environment Schema ────────────────────────────────────────────────────

const envSchema = z.object({
  HF_TOKEN: z.string().min(1, 'HF_TOKEN is required. Set it in your .env file.'),
  OLLAMA_HOST: z.string().url().default('http://localhost:11434'),
  PRIMARY_MODEL: z.string().default('deepseek-coder:6.7b'),
  FALLBACK_MODEL: z.string().default('codellama:7b'),
  API_PORT: z.coerce.number().default(process.env.PORT ? parseInt(process.env.PORT) : 7860),
  API_HOST: z.string().default('localhost'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// ─── Parse & Export ────────────────────────────────────────────────────────

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`[OpenCode Config] Invalid environment variables:\n${issues}\n\nCopy .env.example to .env and fill in the required values.`);
  }

  return result.data;
}

export const config = loadConfig();
export type Config = typeof config;
