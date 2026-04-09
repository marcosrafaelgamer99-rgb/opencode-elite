/**
 * OpenCode — Ollama Provider
 * Low-level client for the Ollama local inference API.
 * Handles chat, streaming, and health checks.
 */

import axios, { type AxiosInstance } from 'axios';
import { config } from '../core/config.js';

// ─── Ollama API Types ─────────────────────────────────────────────────────

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    repeat_penalty?: number;
    num_ctx?: number;
    num_predict?: number;
    seed?: number;
  };
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaStreamChunk {
  model: string;
  message: { role: string; content: string };
  done: boolean;
}

export interface ChatResult {
  content: string;
  model: string;
  durationMs: number;
  tokensGenerated?: number;
}

// ─── OllamaProvider ───────────────────────────────────────────────────────

export class OllamaProvider {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.OLLAMA_HOST,
      timeout: 300_000, // 5 min for large model responses
    });
  }

  /**
   * Sends a chat request to Ollama and returns the full response.
   * Non-streaming version — waits for the complete output.
   */
  async chat(
    model: string,
    messages: OllamaMessage[],
    options?: OllamaChatRequest['options']
  ): Promise<ChatResult> {
    const start = Date.now();

    const payload: OllamaChatRequest = {
      model,
      messages,
      stream: false,
      options: {
        temperature: 0.1,
        top_p: 0.95,
        repeat_penalty: 1.1,
        num_ctx: 16384,
        num_predict: 4096,
        ...options,
      },
    };

    const response = await this.client.post<OllamaChatResponse>('/api/chat', payload);

    return {
      content: response.data.message.content,
      model: response.data.model,
      durationMs: Date.now() - start,
      tokensGenerated: response.data.eval_count,
    };
  }

  /**
   * Streams a chat response chunk by chunk, calling `onChunk` for each token.
   * Returns the full assembled content when done.
   */
  async stream(
    model: string,
    messages: OllamaMessage[],
    onChunk: (token: string) => void,
    options?: OllamaChatRequest['options']
  ): Promise<ChatResult> {
    const start = Date.now();
    let fullContent = '';

    const payload: OllamaChatRequest = {
      model,
      messages,
      stream: true,
      options: {
        temperature: 0.1,
        top_p: 0.95,
        repeat_penalty: 1.1,
        num_ctx: 16384,
        num_predict: 4096,
        ...options,
      },
    };

    const response = await this.client.post<NodeJS.ReadableStream>('/api/chat', payload, {
      responseType: 'stream',
      timeout: 0,
    });

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as OllamaStreamChunk;
            if (parsed.message?.content) {
              fullContent += parsed.message.content;
              onChunk(parsed.message.content);
            }
          } catch {
            // Incomplete JSON chunk — skip
          }
        }
      });

      response.data.on('end', () => {
        resolve({
          content: fullContent,
          model,
          durationMs: Date.now() - start,
        });
      });

      response.data.on('error', reject);
    });
  }

  /**
   * Returns true if Ollama is running and reachable.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.get('/api/tags', { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists all locally available models.
   */
  async listModels(): Promise<string[]> {
    const resp = await this.client.get<{ models: { name: string }[] }>('/api/tags');
    return resp.data.models.map((m) => m.name);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

export const ollamaProvider = new OllamaProvider();
