/**
 * OpenCode — AuditorAgent
 * Reviews generated code for bugs, type safety violations, and clean code issues.
 * Returns a structured audit report with APPROVED or REJECTED verdict.
 */

import chalk from 'chalk';
import { BaseAgent } from '../core/agent-base.js';
import type { AgentInput, AgentOutput } from '../core/agent-base.js';

// ─── Audit Types ──────────────────────────────────────────────────────────

export type IssueSeverity = 'critical' | 'major' | 'minor' | 'suggestion';

export interface AuditIssue {
  severity: IssueSeverity;
  category: 'bug' | 'type-safety' | 'performance' | 'clean-code' | 'security' | 'logic';
  file?: string;
  line?: number;
  problem: string;
  suggestion: string;
}

export interface AuditVerdict {
  approved: boolean;
  score: number;           // 0–100
  issues: AuditIssue[];
  blockers: AuditIssue[]; // Only critical/major issues that block approval
  summary: string;
  recommendations: string[];
  raw: AgentOutput;
}

// ─── AuditorAgent ─────────────────────────────────────────────────────────

export class AuditorAgent extends BaseAgent {
  readonly agentName = 'Auditor';
  readonly emoji = '🔍';
  readonly color = chalk.yellowBright;

  /** Minimum score required for approval. */
  private readonly approvalThreshold: number;

  constructor(modelOverride?: string, approvalThreshold = 85) {
    super(modelOverride);
    this.approvalThreshold = approvalThreshold;
  }

  readonly systemPrompt = `You are the Auditor Agent of OpenCode — an elite code reviewer with the highest standards in the industry.

YOUR MISSION:
Conduct an exhaustive review of all submitted code. You are the final quality gate before any code ships.

AUDIT CHECKLIST (review EVERYTHING):

[ ] CORRECTNESS
  - Does the code fulfill all requirements from the task plan?
  - Are all edge cases handled?
  - Does the logic produce correct results?

[ ] TYPE SAFETY (TypeScript)
  - Is "any" used anywhere? (automatic CRITICAL issue)
  - Are all function parameters and return types annotated?
  - Are generic types used correctly?
  - Are discriminated unions used where appropriate?
  - Are null/undefined handled safely (no unchecked access)?

[ ] BUGS & LOGIC ERRORS
  - Are there off-by-one errors?
  - Are async/await patterns correct? (no floating promises)
  - Are race conditions possible?
  - Can the code throw unhandled exceptions?
  - Are array/object accesses bounds-checked?

[ ] PERFORMANCE
  - Are there unnecessary loops inside loops (O(n²))?
  - Are expensive operations repeated when they could be cached?
  - Are Map/Set used instead of arrays for lookups?

[ ] CLEAN CODE
  - Are functions longer than 30 lines? (flag it)
  - Is there duplicate code that should be extracted?
  - Are there magic numbers or strings?
  - Are variable names clear and descriptive?

[ ] SECURITY
  - Is user input sanitized?
  - Are secrets exposed?
  - Is eval() or Function() used?

SCORING:
- Start at 100. Deduct per issue:
  • Critical: -25 points each
  • Major: -10 points each
  • Minor: -3 points each
  • Suggestion: -1 point each
- Score >= 85 → APPROVED
- Score < 85 → REJECTED (must fix all Critical + Major issues)

OUTPUT FORMAT — Respond with valid JSON wrapped in <audit> tags:
<audit>
{
  "approved": false,
  "score": 72,
  "summary": "Brief overview of code quality and main problems found.",
  "issues": [
    {
      "severity": "critical",
      "category": "type-safety",
      "file": "service.ts",
      "line": 42,
      "problem": "Parameter 'data' is typed as 'any'",
      "suggestion": "Replace with the specific interface 'UserData' defined in types.ts"
    }
  ],
  "recommendations": [
    "Consider adding input validation at the service boundary",
    "Extract repeated error handling into a utility function"
  ]
}
</audit>`;

  /**
   * Reviews the provided code against the original task requirements.
   * @param code - The full source code to audit
   * @param originalRequirements - The original problem statement / task plan
   * @param iteration - Current iteration number (included in the prompt for context)
   */
  async review(
    code: string,
    originalRequirements: string,
    iteration: number
  ): Promise<AgentOutput> {
    const input: AgentInput = {
      userMessage: `AUDIT REQUEST — Iteration #${iteration}

ORIGINAL REQUIREMENTS:
${originalRequirements}

CODE TO REVIEW:
\`\`\`
${code}
\`\`\`

Perform a full, exhaustive audit of this code. Apply your complete checklist.
Be strict — your approval means this code is production-ready.`,
    };

    return this.execute(input);
  }

  async execute(input: AgentInput): Promise<AgentOutput> {
    return this.runAgent(input, true);
  }

  /**
   * Parses the Auditor's raw output into a structured AuditVerdict.
   */
  parseVerdict(output: AgentOutput): AuditVerdict {
    try {
      const match = output.rawContent.match(/<audit>([\s\S]*?)<\/audit>/);
      if (!match || !match[1]) throw new Error('No <audit> block found in output.');

      const parsed = JSON.parse(match[1].trim()) as {
        approved: boolean;
        score: number;
        summary: string;
        issues: AuditIssue[];
        recommendations: string[];
      };

      const blockers = (parsed.issues ?? []).filter(
        (i) => i.severity === 'critical' || i.severity === 'major'
      );

      // Override approval based on score threshold
      const finalApproved = parsed.score >= this.approvalThreshold && blockers.length === 0;

      return {
        approved: finalApproved,
        score: parsed.score,
        issues: parsed.issues ?? [],
        blockers,
        summary: parsed.summary,
        recommendations: parsed.recommendations ?? [],
        raw: output,
      };
    } catch {
      // If parsing fails, treat as rejected with a parsing error issue
      return {
        approved: false,
        score: 0,
        issues: [
          {
            severity: 'critical',
            category: 'bug',
            problem: 'Audit output could not be parsed.',
            suggestion: 'Retry the audit.',
          },
        ],
        blockers: [],
        summary: 'Audit parsing failed — treating as rejected.',
        recommendations: [],
        raw: output,
      };
    }
  }

  /**
   * Renders a human-readable verdict to the terminal.
   */
  printVerdict(verdict: AuditVerdict, iteration: number): void {
    const border = '═'.repeat(60);
    const status = verdict.approved
      ? chalk.bold.green('✅  APPROVED')
      : chalk.bold.red('❌  REJECTED');

    const scoreColor =
      verdict.score >= 85 ? chalk.green : verdict.score >= 60 ? chalk.yellow : chalk.red;

    console.log(chalk.yellowBright(`\n╔${border}╗`));
    console.log(
      chalk.yellowBright(`║`) +
        chalk.bold(`  AUDIT VERDICT — Iteration #${iteration}`.padEnd(59)) +
        chalk.yellowBright(`║`)
    );
    console.log(chalk.yellowBright(`╚${border}╝`));
    console.log(`\n  Status : ${status}`);
    console.log(`  Score  : ${scoreColor(String(verdict.score) + '/100')}`);
    console.log(`  Issues : ${verdict.issues.length} found (${verdict.blockers.length} blockers)\n`);
    console.log(chalk.dim(`  ${verdict.summary}\n`));

    if (verdict.issues.length > 0) {
      console.log(chalk.bold('  Issues Found:'));
      verdict.issues.forEach((issue, i) => {
        const sev = {
          critical: chalk.red('● CRITICAL'),
          major: chalk.yellow('● MAJOR'),
          minor: chalk.cyan('○ MINOR'),
          suggestion: chalk.dim('○ SUGGEST'),
        }[issue.severity];

        console.log(`\n  [${i + 1}] ${sev} — ${chalk.bold(issue.category)}`);
        if (issue.file) console.log(chalk.dim(`       ${issue.file}${issue.line ? `:${issue.line}` : ''}`));
        console.log(`       Problem   : ${issue.problem}`);
        console.log(`       Fix       : ${chalk.greenBright(issue.suggestion)}`);
      });
    }

    if (verdict.approved && verdict.recommendations.length > 0) {
      console.log(chalk.dim('\n  Recommendations for future improvements:'));
      verdict.recommendations.forEach((r) => console.log(chalk.dim(`  • ${r}`)));
    }

    console.log('\n');
  }
}
