/**
 * OpenCode — AgentOrchestrator
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the full multi-agent workflow:
 *
 *   [User Prompt]
 *        │
 *        ▼
 *   ┌────────────────────┐
 *   │  INQUIRY ENGINE    │  → Tier A: proceed | Tier B: ask 2-3 questions
 *   └────────┬───────────┘
 *            │ (enriched context)
 *            ▼
 *   ┌─────────────┐
 *   │  ANALYST    │  → Decomposes problem into structured task plan
 *   └──────┬──────┘
 *          │
 *          ▼
 *   ┌─────────────┐
 *   │   CODER     │  → Generates production-grade code
 *   └──────┬──────┘
 *          │
 *          ▼
 *   ┌─────────────┐
 *   │  AUDITOR    │  → Reviews code against strict quality standards
 *   └──────┬──────┘
 *          │
 *     Approved? ──── YES ──→ Return final result ✅
 *          │
 *          NO
 *          │
 *          └──→ CODER (revision with Auditor feedback)
 *                    │
 *                    └──→ AUDITOR (re-review)
 *                              │
 *                         (repeat until approved OR max iterations)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import chalk from 'chalk';
import { AnalystAgent } from '../agents/analyst.agent.js';
import { CoderAgent } from '../agents/coder.agent.js';
import { AuditorAgent } from '../agents/auditor.agent.js';
import { InquiryEngine } from './inquiry-engine.js';
import { ollamaProvider } from '../providers/ollama.provider.js';
import { config } from './config.js';
import type { AnalysisResult } from '../agents/analyst.agent.js';
import type { CoderResult } from '../agents/coder.agent.js';
import type { AuditVerdict } from '../agents/auditor.agent.js';

// ─── Orchestration Types ──────────────────────────────────────────────────

export interface OrchestratorOptions {
  /** Model to use for all agents. Defaults to PRIMARY_MODEL from env. */
  model?: string;
  /** Lightweight model used for inquiry classification. Defaults to FALLBACK_MODEL. */
  inquiryModel?: string;
  /** Maximum number of Coder→Auditor iterations before giving up. Default: 3. */
  maxIterations?: number;
  /** Minimum audit score to approve. Default: 85. */
  approvalThreshold?: number;
  /** Enable verbose logging. Default: true. */
  verbose?: boolean;
  /** Stream agent outputs in real time. Default: true. */
  stream?: boolean;
  /** Skip the inquiry phase entirely. Default: false. */
  skipInquiry?: boolean;
}

export interface IterationRecord {
  iteration: number;
  coderOutput: CoderResult;
  auditVerdict: AuditVerdict;
  durationMs: number;
}

export interface OrchestrationResult {
  /** Final verdict: true if code was approved. */
  approved: boolean;
  /** The final code output (approved or best attempt). */
  finalCode: CoderResult;
  /** The final audit verdict. */
  finalVerdict: AuditVerdict;
  /** The analyst's decomposition of the problem. */
  analysis: AnalysisResult;
  /** Full history of all coder→auditor iterations. */
  iterations: IterationRecord[];
  /** Total wall-clock time for the entire workflow. */
  totalDurationMs: number;
  /** Total iterations executed. */
  totalIterations: number;
  /** Model used throughout the workflow. */
  modelUsed: string;
  /** Whether the inquiry phase was triggered. */
  inquiryWasRequired: boolean;
  /** The enriched prompt context used by agents (includes Q&A answers). */
  enrichedContext: string;
}

// ─── AgentOrchestrator ────────────────────────────────────────────────────

export class AgentOrchestrator {
  private readonly analyst: AnalystAgent;
  private readonly coder: CoderAgent;
  private readonly auditor: AuditorAgent;
  private readonly inquiry: InquiryEngine;
  private readonly options: Required<OrchestratorOptions>;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      model: options.model ?? config.PRIMARY_MODEL,
      inquiryModel: options.inquiryModel ?? config.FALLBACK_MODEL,
      maxIterations: options.maxIterations ?? 3,
      approvalThreshold: options.approvalThreshold ?? 85,
      verbose: options.verbose ?? true,
      stream: options.stream ?? true,
      skipInquiry: options.skipInquiry ?? false,
    };

    this.analyst = new AnalystAgent(this.options.model);
    this.coder = new CoderAgent(this.options.model);
    this.auditor = new AuditorAgent(this.options.model, this.options.approvalThreshold);
    this.inquiry = new InquiryEngine(this.options.inquiryModel);
  }

  // ─── Main Entry Point ───────────────────────────────────────────────

  /**
   * Runs the full Analyst → Coder → Auditor workflow for the given prompt.
   * Iterates until the code is approved or max iterations is reached.
   */
  async run(userPrompt: string): Promise<OrchestrationResult> {
    const workflowStart = Date.now();

    this.printWorkflowHeader(userPrompt);

    // ── Pre-flight: Verify Ollama is running ─────────────────────────
    await this.assertOllamaReady();

    // ──────────────────────────────────────────────────────────────────
    // PHASE 0: INQUIRY ENGINE — Critical Thinking Layer
    // ──────────────────────────────────────────────────────────────────
    let enrichedContext = userPrompt;
    let inquiryWasRequired = false;

    if (!this.options.skipInquiry) {
      this.printPhaseHeader(0, 'INQUIRY', '◈', 'Analyzing request complexity...');
      const inquiryResult = await this.inquiry.run(userPrompt, true);
      enrichedContext = inquiryResult.enrichedContext;
      inquiryWasRequired = inquiryResult.wasRequired;

      if (inquiryWasRequired) {
        this.log('info', `Inquiry complete — context enriched with ${inquiryResult.answers.length} answer(s).`);
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // PHASE 1: ANALYSIS
    // ──────────────────────────────────────────────────────────────────
    this.printPhaseHeader(1, 'ANALYSIS', '🧠', 'Decomposing the problem...');

    const analystOutput = await this.analyst.execute({ userMessage: enrichedContext });

    if (!analystOutput.success) {
      throw new OrchestratorError('Analyst failed to process the prompt.', analystOutput.error);
    }

    const analysis = this.analyst.parseOutput(analystOutput, userPrompt);
    this.printAnalysisSummary(analysis);

    // ──────────────────────────────────────────────────────────────────
    // PHASE 2: INITIAL CODE GENERATION
    // ──────────────────────────────────────────────────────────────────
    this.printPhaseHeader(2, 'CODE GENERATION', '💻', 'Writing the initial implementation...');

    const initialCoderOutput = await this.coder.generateFromPlan(analysis);
    if (!initialCoderOutput.success) {
      throw new OrchestratorError('Coder failed on initial generation.', initialCoderOutput.error);
    }
    let currentCoderResult = this.coder.parseOutput(initialCoderOutput);

    // ──────────────────────────────────────────────────────────────────
    // PHASE 3: ITERATIVE AUDIT LOOP
    // ──────────────────────────────────────────────────────────────────
    const iterations: IterationRecord[] = [];
    let approved = false;
    let finalVerdict!: AuditVerdict;

    for (let i = 1; i <= this.options.maxIterations; i++) {
      const iterStart = Date.now();

      this.printPhaseHeader(
        2 + i,
        `AUDIT — Iteration #${i}/${this.options.maxIterations}`,
        '🔍',
        `Reviewing code quality (threshold: ${this.options.approvalThreshold}/100)...`
      );

      // Extract code as a flat string for the Auditor
      const codeForReview = this.coder.extractCodeForReview(currentCoderResult);

      // Run Auditor
      const auditorOutput = await this.auditor.review(
        codeForReview,
        `${userPrompt}\n\nTask plan:\n${analysis.tasks.map((t) => `- ${t.title}: ${t.description}`).join('\n')}`,
        i
      );

      if (!auditorOutput.success) {
        this.log('warn', `Auditor failed on iteration ${i}. Skipping.`);
        continue;
      }

      const verdict = this.auditor.parseVerdict(auditorOutput);
      this.auditor.printVerdict(verdict, i);

      const iterRecord: IterationRecord = {
        iteration: i,
        coderOutput: currentCoderResult,
        auditVerdict: verdict,
        durationMs: Date.now() - iterStart,
      };
      iterations.push(iterRecord);

      finalVerdict = verdict;

      // ── APPROVED → Exit loop ──────────────────────────────────────
      if (verdict.approved) {
        approved = true;
        this.printApproval(i, verdict.score);
        break;
      }

      // ── REJECTED → Check if we have iterations left ───────────────
      if (i === this.options.maxIterations) {
        this.printMaxIterationsReached(verdict);
        break;
      }

      // ── REJECTED → Feed issues back to Coder ─────────────────────
      this.printRevisionRequest(i, verdict.blockers.length);

      const revisionOutput = await this.coder.revise(
        codeForReview,
        verdict.blockers.length > 0 ? verdict.blockers : verdict.issues,
        i
      );

      if (!revisionOutput.success) {
        this.log('warn', `Coder revision failed on iteration ${i}. Using previous output.`);
      } else {
        currentCoderResult = this.coder.parseOutput(revisionOutput);
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // RESULT ASSEMBLY
    // ──────────────────────────────────────────────────────────────────
    const totalDuration = Date.now() - workflowStart;
    this.printWorkflowComplete(approved, totalDuration, iterations.length);

    return {
      approved,
      finalCode: currentCoderResult,
      finalVerdict,
      analysis,
      iterations,
      totalDurationMs: totalDuration,
      totalIterations: iterations.length,
      modelUsed: this.options.model,
      inquiryWasRequired,
      enrichedContext,
    };
  }

  // ─── Pre-flight ─────────────────────────────────────────────────────

  private async assertOllamaReady(): Promise<void> {
    const healthy = await ollamaProvider.isHealthy();
    if (!healthy) {
      throw new OrchestratorError(
        `Ollama is not running at ${config.OLLAMA_HOST}.\nStart it with: ollama serve`
      );
    }

    const models = await ollamaProvider.listModels();
    const modelShort = this.options.model.split(':')[0] ?? this.options.model;
    const hasModel = models.some((m) => m.includes(modelShort));

    if (!hasModel) {
      throw new OrchestratorError(
        `Model "${this.options.model}" is not downloaded.\nRun: ollama pull ${this.options.model}`
      );
    }

    this.log('info', `Ollama ready. Using model: ${chalk.bold(this.options.model)}`);
  }

  // ─── Print Helpers ──────────────────────────────────────────────────

  private printWorkflowHeader(prompt: string): void {
    const line = '═'.repeat(68);
    console.log(chalk.bold.cyanBright(`\n╔${line}╗`));
    console.log(chalk.bold.cyanBright(`║`) + chalk.bold(`  🚀 OpenCode AgentOrchestrator`.padEnd(68)) + chalk.bold.cyanBright(`║`));
    console.log(chalk.bold.cyanBright(`╚${line}╝`));
    console.log(chalk.dim(`\n  Model      : ${this.options.model}`));
    console.log(chalk.dim(`  Max Iters  : ${this.options.maxIterations}`));
    console.log(chalk.dim(`  Threshold  : ${this.options.approvalThreshold}/100`));
    console.log(chalk.dim(`\n  Prompt     : "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`));
    console.log(chalk.dim(`\n  Pipeline   : 🧠 Analyst → 💻 Coder → 🔍 Auditor [loop until ✅]\n`));
  }

  private printPhaseHeader(phase: number, name: string, emoji: string, desc: string): void {
    const line = '─'.repeat(68);
    console.log(chalk.cyanBright(`\n${line}`));
    console.log(chalk.bold.cyanBright(`  Phase ${phase}: ${emoji}  ${name}`));
    console.log(chalk.dim(`  ${desc}`));
    console.log(chalk.cyanBright(`${line}\n`));
  }

  private printAnalysisSummary(analysis: AnalysisResult): void {
    console.log(chalk.bold('\n  📋 Analysis Summary'));
    console.log(chalk.dim(`  Language    : ${analysis.language}`));
    console.log(chalk.dim(`  Complexity  : ${analysis.estimatedComplexity}`));
    console.log(chalk.dim(`  Tasks       : ${analysis.tasks.length} identified`));
    console.log(chalk.dim(`  Constraints : ${analysis.constraints.length}\n`));
    analysis.tasks.forEach((t) => {
      const p = { critical: chalk.red, high: chalk.yellow, medium: chalk.cyan, low: chalk.dim }[t.priority];
      console.log(`  ${p(`[${t.priority.toUpperCase()}]`)} ${t.title}`);
    });
    console.log('');
  }

  private printRevisionRequest(iteration: number, blockerCount: number): void {
    console.log(
      chalk.yellow(
        `\n  ⟳ Iteration #${iteration} rejected — ${blockerCount} blocker(s) found. Sending to Coder for revision...\n`
      )
    );
  }

  private printApproval(iteration: number, score: number): void {
    console.log(
      chalk.bold.green(
        `\n  ✅ Code APPROVED on iteration #${iteration} with score ${score}/100!\n`
      )
    );
  }

  private printMaxIterationsReached(verdict: AuditVerdict): void {
    console.log(
      chalk.yellow(
        `\n  ⚠ Max iterations reached. Best score: ${verdict.score}/100. Returning best attempt.\n`
      )
    );
  }

  private printWorkflowComplete(
    approved: boolean,
    durationMs: number,
    iterations: number
  ): void {
    const line = '═'.repeat(68);
    const durationSec = (durationMs / 1000).toFixed(1);
    const status = approved ? chalk.bold.green('✅ APPROVED') : chalk.bold.yellow('⚠ BEST EFFORT');

    console.log(chalk.bold.cyanBright(`\n╔${line}╗`));
    console.log(chalk.bold.cyanBright(`║`) + chalk.bold(`  Workflow Complete`.padEnd(68)) + chalk.bold.cyanBright(`║`));
    console.log(chalk.bold.cyanBright(`╚${line}╝`));
    console.log(`\n  Result    : ${status}`);
    console.log(`  Duration  : ${chalk.cyan(durationSec + 's')}`);
    console.log(`  Iterations: ${iterations}\n`);
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (!this.options.verbose) return;
    const colors = { info: chalk.blue, warn: chalk.yellow, error: chalk.red };
    console.log(colors[level](`  [Orchestrator] ${message}`));
  }
}

// ─── Custom Error ─────────────────────────────────────────────────────────

export class OrchestratorError extends Error {
  constructor(message: string, public readonly cause?: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}
