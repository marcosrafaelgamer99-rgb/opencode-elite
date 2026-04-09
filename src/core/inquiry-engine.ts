/**
 * OpenCode — InquiryEngine
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements Protocol 1: "Inquiry Before Execution"
 *
 * Before the agent pipeline runs, the InquiryEngine:
 *  1. Classifies prompt complexity (Tier A vs Tier B)
 *  2. If Tier B: generates 2–3 targeted diagnostic questions
 *  3. Collects user answers
 *  4. Builds an enriched context block that feeds into the main pipeline
 * ─────────────────────────────────────────────────────────────────────────────
 */

import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import { ollamaProvider } from '../providers/ollama.provider.js';
import { config } from './config.js';
import { getMasterPrompt } from './system-prompt.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type PromptTier = 'A' | 'B';

export interface InquiryQuestion {
  id: number;
  question: string;
  why_it_matters: string;
  options?: string[];
}

export interface InquiryPlan {
  tier: PromptTier;
  complexity: 'simple' | 'complex' | 'vague' | 'ambiguous';
  reasoning: string;
  questions: InquiryQuestion[];
}

export interface UserAnswer {
  questionId: number;
  question: string;
  answer: string;
}

export interface InquiryResult {
  /** Was the inquiry phase needed? */
  wasRequired: boolean;
  /** The tier classification of the original prompt */
  tier: PromptTier;
  /** Original user prompt */
  originalPrompt: string;
  /** The Q&A session, empty if tier A */
  answers: UserAnswer[];
  /** Enriched prompt context to inject into the agent pipeline */
  enrichedContext: string;
  /** Time spent in inquiry phase in ms */
  durationMs: number;
}

// ─── Classification Prompt ────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `${getMasterPrompt()}

YOUR IMMEDIATE TASK — PROMPT CLASSIFICATION:
Analyze the user's programming request and classify it as Tier A or Tier B.

TIER A (simple/clear): Unambiguous request, well-defined scope, you have enough context.
TIER B (complex/vague): Multiple valid architectural approaches, missing critical constraints,
or the naive implementation would likely be wrong.

Respond ONLY with valid JSON inside <inquiry> tags. Nothing else.

If Tier A:
<inquiry>
{
  "tier": "A",
  "complexity": "simple",
  "reasoning": "Why this is clear enough to proceed",
  "questions": []
}
</inquiry>

If Tier B:
<inquiry>
{
  "tier": "B",
  "complexity": "complex | vague | ambiguous",
  "reasoning": "One sentence on what's missing or ambiguous",
  "questions": [
    {
      "id": 1,
      "question": "The precise diagnostic question",
      "why_it_matters": "What architectural decision this determines",
      "options": ["Option A (implication)", "Option B (implication)"]
    }
  ]
}
</inquiry>

Classify this request:`;

// ─── InquiryEngine ────────────────────────────────────────────────────────

export class InquiryEngine {
  /** Lightweight model for fast classification — saves the heavy model for coding. */
  private readonly classificationModel: string;

  constructor(modelOverride?: string) {
    // Use the lite model for classification — fast and cheap
    this.classificationModel = modelOverride ?? config.FALLBACK_MODEL;
  }

  // ─── Main Entry Point ──────────────────────────────────────────────

  /**
   * Runs the full inquiry flow for a user prompt.
   * If Tier A: returns immediately with enriched context = original prompt.
   * If Tier B: asks questions, collects answers, builds enriched context.
   */
  async run(userPrompt: string, interactive = true): Promise<InquiryResult> {
    const start = Date.now();

    // Step 1: Classify
    this.printAnalyzingStatus();
    const plan = await this.classifyPrompt(userPrompt);
    this.clearStatus();

    // Tier A — proceed immediately
    if (plan.tier === 'A') {
      this.printTierA(plan.reasoning);
      return {
        wasRequired: false,
        tier: 'A',
        originalPrompt: userPrompt,
        answers: [],
        enrichedContext: userPrompt,
        durationMs: Date.now() - start,
      };
    }

    // Tier B — inquiry needed
    this.printTierB(plan);

    let answers: UserAnswer[] = [];

    if (interactive) {
      answers = await this.collectAnswersInteractive(plan.questions);
    }

    const enrichedContext = this.buildEnrichedContext(userPrompt, answers);

    return {
      wasRequired: true,
      tier: 'B',
      originalPrompt: userPrompt,
      answers,
      enrichedContext,
      durationMs: Date.now() - start,
    };
  }

  // ─── Classification ─────────────────────────────────────────────────

  /**
   * Uses the LLM to classify the prompt as Tier A or Tier B.
   * Parses the structured <inquiry> JSON response.
   */
  private async classifyPrompt(userPrompt: string): Promise<InquiryPlan> {
    try {
      const result = await ollamaProvider.chat(
        this.classificationModel,
        [
          {
            role: 'system',
            content: CLASSIFICATION_PROMPT,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        {
          temperature: 0.05,  // Near-zero temp for deterministic classification
          num_predict: 800,
        }
      );

      return this.parseInquiryResponse(result.content);
    } catch {
      // On failure, default to Tier A (proceed without blocking)
      return {
        tier: 'A',
        complexity: 'simple',
        reasoning: 'Classification model unavailable — proceeding directly.',
        questions: [],
      };
    }
  }

  /**
   * Parses the model's <inquiry> JSON block.
   * Falls back to Tier A gracefully on parse errors.
   */
  private parseInquiryResponse(rawContent: string): InquiryPlan {
    const match = rawContent.match(/<inquiry>([\s\S]*?)<\/inquiry>/);
    if (!match?.[1]) {
      return {
        tier: 'A',
        complexity: 'simple',
        reasoning: 'Could not parse classification response.',
        questions: [],
      };
    }

    try {
      const parsed = JSON.parse(match[1].trim()) as InquiryPlan;
      // Enforce max 3 questions regardless of model output
      parsed.questions = (parsed.questions ?? []).slice(0, 3);
      return parsed;
    } catch {
      return {
        tier: 'A',
        complexity: 'simple',
        reasoning: 'JSON parse failed — proceeding directly.',
        questions: [],
      };
    }
  }

  // ─── Interactive Q&A ─────────────────────────────────────────────────

  /**
   * Presents questions to the user in the terminal and collects answers.
   * Returns the array of Q&A pairs.
   */
  private async collectAnswersInteractive(
    questions: InquiryQuestion[]
  ): Promise<UserAnswer[]> {
    const answers: UserAnswer[] = [];
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = (question: string): Promise<string> =>
      new Promise((resolve) => rl.question(question, resolve));

    console.log(chalk.dim('\n' + '─'.repeat(60)));
    console.log(
      chalk.bold.yellowBright('  💡 OpenCode needs clarification before proceeding.\n') +
      chalk.dim('  Answer these questions to unlock a better solution.\n')
    );

    for (const q of questions) {
      // Print the question
      console.log(chalk.bold.white(`  [${q.id}/${questions.length}] ${q.question}`));
      console.log(chalk.dim(`       Why this matters: ${q.why_it_matters}`));

      if (q.options && q.options.length > 0) {
        console.log(chalk.dim('       Options:'));
        q.options.forEach((opt, i) => {
          console.log(chalk.dim(`         ${i + 1}. ${opt}`));
        });
      }

      const answer = await ask(chalk.yellowBright('       → Your answer: '));
      console.log('');

      answers.push({
        questionId: q.id,
        question: q.question,
        answer: answer.trim() || '(no answer provided)',
      });
    }

    rl.close();
    return answers;
  }

  // ─── Context Enrichment ───────────────────────────────────────────────

  /**
   * Combines the original prompt with the Q&A answers into an enriched
   * context block that agents receive instead of the bare prompt.
   */
  private buildEnrichedContext(
    originalPrompt: string,
    answers: UserAnswer[]
  ): string {
    if (answers.length === 0) return originalPrompt;

    const qaBlock = answers
      .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
      .join('\n\n');

    return `ORIGINAL REQUEST:
${originalPrompt}

ADDITIONAL CONTEXT (from pre-flight inquiry):
${qaBlock}

INSTRUCTION: Use the additional context above to tailor the implementation precisely.
Do not re-ask these questions. Proceed with full implementation.`;
  }

  // ─── UI Status Output ─────────────────────────────────────────────────

  private spinner: ReturnType<typeof ora> | null = null;

  /**
   * Shows the gold "Analyzing Architecture..." spinner.
   * This is the UI status shown while the classification LLM call is in flight.
   */
  private printAnalyzingStatus(): void {
    this.spinner = ora({
      text: chalk.bold.yellowBright('Analyzing Architecture...'),
      spinner: {
        interval: 80,
        frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
      },
      color: 'yellow',
      prefixText: chalk.yellowBright('◈'),
    }).start();
  }

  /** Clears the analyzing spinner. */
  private clearStatus(): void {
    this.spinner?.stop();
    this.spinner = null;
  }

  private printTierA(reasoning: string): void {
    console.log(
      chalk.dim('\n  ◈ ') +
      chalk.greenBright('Request classified as direct — proceeding to pipeline.') +
      chalk.dim(` (${reasoning})`)
    );
  }

  private printTierB(plan: InquiryPlan): void {
    console.log(
      chalk.yellowBright('\n  ◈ Inquiry Required') +
      chalk.dim(` — ${plan.complexity}: ${plan.reasoning}`) +
      chalk.dim(`\n  ${plan.questions.length} diagnostic question(s) before proceeding.\n`)
    );
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

export const inquiryEngine = new InquiryEngine();

// ─── Non-interactive Helper ───────────────────────────────────────────────

/**
 * For automated pipelines and tests: injects pre-defined answers
 * instead of prompting the user interactively.
 */
export class InquiryEngineHeadless extends InquiryEngine {
  constructor(modelOverride?: string) {
    super(modelOverride);
  }

  override async run(userPrompt: string): Promise<InquiryResult> {
    return super.run(userPrompt, false);
  }
}
