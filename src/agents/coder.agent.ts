/**
 * OpenCode — CoderAgent
 * Writes production-grade code based on the Analyst's task plan.
 * Can receive Auditor feedback and apply corrections iteratively.
 */

import chalk from 'chalk';
import { BaseAgent } from '../core/agent-base.js';
import type { AgentInput, AgentOutput } from '../core/agent-base.js';
import type { AnalysisResult } from './analyst.agent.js';
import type { AuditIssue } from './auditor.agent.js';

// ─── Coder Output Types ───────────────────────────────────────────────────

export interface CodeFile {
  filename: string;
  language: string;
  content: string;
  description: string;
}

export interface CoderResult {
  files: CodeFile[];
  explanation: string;
  usageExample: string;
  raw: AgentOutput;
}

// ─── CoderAgent ───────────────────────────────────────────────────────────

export class CoderAgent extends BaseAgent {
  readonly agentName = 'Coder';
  readonly emoji = '💻';
  readonly color = chalk.greenBright;

  readonly systemPrompt = `You are the Coder Agent of OpenCode — an elite software engineer producing world-class, production-ready code.

YOUR STANDARDS (non-negotiable):
1. CORRECTNESS: The code must work correctly for all cases described in the task plan.
2. TYPE SAFETY: Use TypeScript with strict mode. No 'any'. Explicit types everywhere.
3. CLEAN CODE: Functions < 30 lines. Single responsibility. No magic numbers. Meaningful names.
4. ERROR HANDLING: Every async call wrapped in try/catch. All error paths handled.
5. PERFORMANCE: Choose optimal data structures. Avoid O(n²) when O(n) is possible.
6. DOCUMENTATION: JSDoc for all public APIs. Inline comments only for non-obvious logic.

IMPLEMENTING FROM A TASK PLAN:
- Implement ALL tasks in the plan — do not skip any.
- Respect task dependencies — implement foundational pieces first.
- Declare all interfaces and types before the implementation code.
- Export everything that may be needed by consumers.

FIXING FROM AUDITOR FEEDBACK:
- Address EVERY issue listed. Do not ignore any.
- When fixing, show the complete corrected file — never partial patches.
- After each fix, briefly explain what you changed and why.

OUTPUT FORMAT — Wrap each file in <file> tags:
<file name="filename.ts" lang="typescript">
// full file content here
</file>
<explanation>
What was built and key design decisions.
</explanation>
<usage>
// Example showing how to use the implemented code
</usage>

ABSOLUTE RULES:
- Never use placeholder comments like "// implement this later" or "// TODO".
- Never truncate code with "// ... rest of implementation".
- Every function must have a return type annotation.
- Prefer composition over inheritance.
- Prefer pure functions over stateful classes where possible.`;

  /**
   * First-pass: generates code from the Analyst's plan.
   */
  async generateFromPlan(analysis: AnalysisResult): Promise<AgentOutput> {
    const taskList = analysis.tasks
      .map(
        (t) =>
          `[Task ${t.id}] (${t.priority.toUpperCase()}) ${t.title}\n  → ${t.description}\n  → Type: ${t.type} | Dependencies: ${t.dependencies.length ? t.dependencies.join(', ') : 'none'}`
      )
      .join('\n\n');

    const input: AgentInput = {
      userMessage: `Implement the following coding plan completely and professionally.

LANGUAGE: ${analysis.language}
COMPLEXITY: ${analysis.estimatedComplexity}
ARCHITECTURE NOTES: ${analysis.architectureNotes}

CONSTRAINTS:
${analysis.constraints.map((c) => `• ${c}`).join('\n')}

TASK PLAN (implement ALL tasks):
${taskList}

SUMMARY: ${analysis.summary}

Produce the complete, production-ready implementation now.`,
    };

    return this.execute(input);
  }

  /**
   * Revision pass: fixes code based on Auditor feedback.
   * Receives the previous code and the list of issues to fix.
   */
  async revise(
    previousCode: string,
    issues: AuditIssue[],
    iteration: number
  ): Promise<AgentOutput> {
    const issueList = issues
      .map(
        (issue, i) =>
          `[Issue ${i + 1}] SEVERITY: ${issue.severity.toUpperCase()}\n  File: ${issue.file ?? 'unknown'} ${issue.line ? `Line ${issue.line}` : ''}\n  Problem: ${issue.problem}\n  Fix required: ${issue.suggestion}`
      )
      .join('\n\n');

    const input: AgentInput = {
      userMessage: `REVISION REQUEST #${iteration} — The Auditor has found issues in your code. You MUST fix all of them.

PREVIOUS CODE:
${previousCode}

AUDITOR ISSUES TO FIX (${issues.length} total):
${issueList}

Instructions:
1. Fix every single issue listed above.
2. Do not introduce new problems while fixing.
3. Return the COMPLETE corrected files — not patches.
4. After the code, briefly explain each fix you made.`,
    };

    return this.execute(input);
  }

  async execute(input: AgentInput): Promise<AgentOutput> {
    return this.runAgent(input, true);
  }

  /**
   * Parses the structured code output from the model.
   * Extracts individual files, explanation, and usage example.
   */
  parseOutput(output: AgentOutput): CoderResult {
    const files: CodeFile[] = [];

    // Extract all <file> blocks
    const fileRegex = /<file\s+name="([^"]+)"\s+lang="([^"]+)">([\s\S]*?)<\/file>/g;
    let match: RegExpExecArray | null;

    while ((match = fileRegex.exec(output.rawContent)) !== null) {
      files.push({
        filename: match[1]!,
        language: match[2]!,
        content: match[3]!.trim(),
        description: '',
      });
    }

    // If no tagged files found, treat entire output as one file
    if (files.length === 0) {
      const codeBlocks = output.rawContent.match(/```[\w]*\n([\s\S]*?)```/g) ?? [];
      codeBlocks.forEach((block, i) => {
        const content = block.replace(/```[\w]*\n/, '').replace(/```$/, '').trim();
        files.push({
          filename: `output_${i + 1}.ts`,
          language: 'typescript',
          content,
          description: 'Extracted code block',
        });
      });
    }

    // Extract explanation and usage
    const explanationMatch = output.rawContent.match(/<explanation>([\s\S]*?)<\/explanation>/);
    const usageMatch = output.rawContent.match(/<usage>([\s\S]*?)<\/usage>/);

    return {
      files,
      explanation: explanationMatch?.[1]?.trim() ?? '',
      usageExample: usageMatch?.[1]?.trim() ?? '',
      raw: output,
    };
  }

  /**
   * Extracts all code as a single concatenated string for Auditor review.
   */
  extractCodeForReview(result: CoderResult): string {
    if (result.files.length > 0) {
      return result.files
        .map((f) => `// ── FILE: ${f.filename} ──\n${f.content}`)
        .join('\n\n');
    }
    return result.raw.rawContent;
  }
}
