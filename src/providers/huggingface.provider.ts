/**
 * OpenCode — HuggingFace Inference Provider
 * ─────────────────────────────────────────────────────────────────────────────
 * All model inference runs via the HuggingFace Inference API (cloud).
 * No local installation required — just a valid HF token.
 *
 * Supported models (text-generation / conversational):
 *   Heavy : Qwen/Qwen2.5-Coder-32B-Instruct   (best quality, needs HF PRO)
 *   Mid   : Qwen/Qwen2.5-Coder-7B-Instruct    (great quality, free tier)
 *   Lite  : Qwen/Qwen2.5-Coder-1.5B-Instruct  (fastest, free tier)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { HfInference } from '@huggingface/inference';
import { config } from '../core/config.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface HFMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface HFChatOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  repetitionPenalty?: number;
}

export interface HFChatResult {
  content: string;
  model: string;
  durationMs: number;
  tokensGenerated?: number;
}

// ─── Available Coding Models ──────────────────────────────────────────────

export const HF_MODELS = {
  /** Best quality — requires HF PRO subscription */
  heavy: 'Qwen/Qwen2.5-Coder-32B-Instruct',
  /** Excellent balance — free tier */
  mid: 'Qwen/Qwen2.5-Coder-7B-Instruct',
  /** Fastest — free tier, great for quick tasks */
  lite: 'Qwen/Qwen2.5-Coder-1.5B-Instruct',
  /** DeepSeek alternative */
  deepseek: 'deepseek-ai/deepseek-coder-6.7b-instruct',
  /** StarCoder2 — strong in code completion */
  starcoder: 'bigcode/starcoder2-15b',
} as const;

export type HFModelKey = keyof typeof HF_MODELS;

// ─── HuggingFaceProvider ──────────────────────────────────────────────────

export class HuggingFaceProvider {
  private readonly client: HfInference;

  constructor(token?: string) {
    this.client = new HfInference(token ?? config.HF_TOKEN);
  }

  // ─── Chat (non-streaming) ────────────────────────────────────────────

  /**
   * Sends a conversation to the HF Inference API and returns the full response.
   */
  async chat(
    model: string,
    messages: HFMessage[],
    options: HFChatOptions = {}
  ): Promise<HFChatResult> {
    const start = Date.now();

    const response = await this.client.chatCompletion({
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.1,
      top_p: options.topP ?? 0.95,
    });

    const content = response.choices[0]?.message?.content ?? '';

    return {
      content,
      model,
      durationMs: Date.now() - start,
      tokensGenerated: response.usage?.completion_tokens,
    };
  }

  // ─── Stream ──────────────────────────────────────────────────────────

  /**
   * Streams tokens from the HF API, calling `onChunk` for each piece.
   * Returns the complete assembled text when done.
   */
  async stream(
    model: string,
    messages: HFMessage[],
    onChunk: (token: string) => void,
    options: HFChatOptions = {}
  ): Promise<HFChatResult> {
    const start = Date.now();
    let fullContent = '';

    const stream = await this.client.chatCompletionStream({
      model,
      messages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.1,
      top_p: options.topP ?? 0.95,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? '';
      if (token) {
        fullContent += token;
        onChunk(token);
      }
    }

    return {
      content: fullContent,
      model,
      durationMs: Date.now() - start,
    };
  }

  // ─── Health / Validation ─────────────────────────────────────────────

  /**
   * Verifies the HF token is valid by calling the whoami endpoint.
   */
  async verifyToken(): Promise<{ valid: boolean; username?: string; plan?: string }> {
    try {
      const info = await this.client.whoAmI();
      return {
        valid: true,
        username: info.name,
        plan: (info as Record<string, unknown>).type as string | undefined,
      };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Tests if a specific model is accessible with the current token.
   * Returns true if the model responds without error.
   */
  async testModel(model: string): Promise<boolean> {
    try {
      await this.client.chatCompletion({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 8,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the HfInference client for direct access when needed.
   */
  getClient(): HfInference {
    return this.client;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

export const hfProvider = new HuggingFaceProvider();
