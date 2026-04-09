/**
 * OpenCode — BaseAgent
 * Abstract foundation that all agents inherit from.
 * Handles model resolution, message building, logging, and execution timing.
 */

import { type ChalkInstance } from 'chalk';
import ora, { type Ora } from 'ora';
import { ollamaProvider } from '../providers/ollama.provider.js';
import { config } from './config.js';
import type { OllamaMessage } from '../providers/ollama.provider.js';

// ─── Agent I/O Types ──────────────────────────────────────────────────────

export interface AgentInput {
  /** The primary instruction or content for this agent to process. */
  userMessage: string;
  /** Optional extra context injected into the conversation (e.g., prior outputs). */
  context?: string;
}

export interface AgentOutput {
  /** Raw text output from the model. */
  rawContent: string;
  /** Agent that produced this output. */
  agentName: string;
  /** Model used for generation. */
  modelUsed: string;
  /** Wall-clock time in ms. */
  durationMs: number;
  /** Whether execution was successful. */
  success: boolean;
  /** Error message if success=false. */
  error?: string;
}

// ─── BaseAgent ────────────────────────────────────────────────────────────

export abstract class BaseAgent {
  /** Display name shown in logs and UI. */
  abstract readonly agentName: string;

  /** Role emoji for terminal output. */
  abstract readonly emoji: string;

  /** ANSI color function for branding this agent's output. */
  abstract readonly color: ChalkInstance;

  /**
   * The system prompt injected at position [0] in every conversation.
   * Should be tuned specifically for this agent's role.
   */
  abstract readonly systemPrompt: string;

  /** Model ID to use. Defaults to env PRIMARY_MODEL. */
  protected model: string;

  /** Accumulated conversation history (system + user + assistant turns). */
  protected history: OllamaMessage[] = [];

  /** Ora spinner instance for visual feedback. */
  protected spinner: Ora | null = null;

  constructor(modelOverride?: string) {
    this.model = modelOverride ?? config.PRIMARY_MODEL;
  }

  // ─── Core Execute ───────────────────────────────────────────────────

  /**
   * Main entry point. Subclasses call this via `super.runAgent()`.
   * Builds the message array, streams the response, and returns AgentOutput.
   */
  protected async runAgent(input: AgentInput, stream = true): Promise<AgentOutput> {
    const start = Date.now();
    this.startSpinner(`Thinking...`);

    // Build message array: system + optional context + user message
    const messages: OllamaMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.history,
    ];

    if (input.context) {
      messages.push({
        role: 'user',
        content: `[CONTEXT FROM PREVIOUS STEP]\n${input.context}`,
      });
      messages.push({
        role: 'assistant',
        content: 'Understood. I have analyzed the provided context and am ready to proceed.',
      });
    }

    messages.push({ role: 'user', content: input.userMessage });

    try {
      let rawContent: string;
      let modelUsed: string;

      if (stream) {
        this.stopSpinner();
        this.printAgentHeader();
        process.stdout.write(this.color(''));

        const result = await ollamaProvider.stream(
          this.model,
          messages,
          (token) => process.stdout.write(this.color(token))
        );

        process.stdout.write('\n');
        rawContent = result.content;
        modelUsed = result.model;
      } else {
        const result = await ollamaProvider.chat(this.model, messages);
        this.stopSpinner();
        rawContent = result.content;
        modelUsed = result.model;
      }

      // Persist to history so next calls have context
      this.history.push({ role: 'user', content: input.userMessage });
      this.history.push({ role: 'assistant', content: rawContent });

      return {
        rawContent,
        agentName: this.agentName,
        modelUsed,
        durationMs: Date.now() - start,
        success: true,
      };
    } catch (error) {
      this.stopSpinner(true);
      const errMsg = error instanceof Error ? error.message : String(error);

      return {
        rawContent: '',
        agentName: this.agentName,
        modelUsed: this.model,
        durationMs: Date.now() - start,
        success: false,
        error: errMsg,
      };
    }
  }

  /**
   * Public execute method. Each subclass implements this to define
   * how it processes input and what structured output it returns.
   */
  abstract execute(input: AgentInput): Promise<AgentOutput>;

  // ─── History Management ─────────────────────────────────────────────

  /** Resets conversation history. Call between independent tasks. */
  resetHistory(): void {
    this.history = [];
  }

  /** Returns a copy of the current history. */
  getHistory(): OllamaMessage[] {
    return [...this.history];
  }

  // ─── Visual Helpers ─────────────────────────────────────────────────

  private startSpinner(text: string): void {
    this.spinner = ora({
      text: this.color(`${this.emoji} [${this.agentName}] ${text}`),
      color: 'cyan',
    }).start();
  }

  private stopSpinner(failed = false): void {
    if (!this.spinner) return;
    if (failed) {
      this.spinner.fail(this.color(`${this.emoji} [${this.agentName}] Failed.`));
    } else {
      this.spinner.stop();
    }
    this.spinner = null;
  }

  protected printAgentHeader(): void {
    const line = '─'.repeat(60);
    console.log(this.color(`\n${line}`));
    console.log(this.color(`${this.emoji}  ${this.agentName.toUpperCase()}  →  ${this.model}`));
    console.log(this.color(`${line}\n`));
  }

  protected printSection(title: string): void {
    console.log(this.color(`\n▸ ${title}`));
  }
}
