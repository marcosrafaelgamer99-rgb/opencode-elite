/**
 * OpenCode — AnalystAgent
 * Decomposes a user's programming problem into a structured execution plan.
 * Output is a JSON task list consumed by the CoderAgent.
 */

import chalk from 'chalk';
import { BaseAgent } from '../core/agent-base.js';
import type { AgentInput, AgentOutput } from '../core/agent-base.js';

// ─── Analyst Output Types ─────────────────────────────────────────────────

export interface AnalysisTask {
  id: number;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  type: 'implementation' | 'interface' | 'logic' | 'validation' | 'error-handling' | 'testing';
  dependencies: number[]; // IDs of tasks this depends on
}

export interface AnalysisResult {
  summary: string;
  language: string;
  estimatedComplexity: 'simple' | 'moderate' | 'complex' | 'expert';
  architectureNotes: string;
  tasks: AnalysisTask[];
  constraints: string[];
  raw: AgentOutput;
}

// ─── AnalystAgent ─────────────────────────────────────────────────────────

export class AnalystAgent extends BaseAgent {
  readonly agentName = 'Analyst';
  readonly emoji = '🧠';
  readonly color = chalk.blueBright;

  readonly systemPrompt = `You are the Analyst Agent of OpenCode — an elite software architect responsible for deeply analyzing programming requests.

YOUR MISSION:
Deconstruct any coding problem into a precise, structured execution plan that a senior developer can follow exactly.

ANALYSIS PROCESS:
1. Understand the full scope (what, why, for whom, constraints).
2. Identify all components, interfaces, data flows, and edge cases.
3. Break the problem into atomic, actionable tasks ordered by dependency.
4. Specify the programming language, patterns, and architecture approach.
5. Flag risks, ambiguities, and non-obvious constraints.

OUTPUT FORMAT — You MUST respond with valid JSON wrapped in <analysis> tags:
<analysis>
{
  "summary": "One-paragraph summary of the problem and proposed solution",
  "language": "typescript | python | javascript | etc.",
  "estimatedComplexity": "simple | moderate | complex | expert",
  "architectureNotes": "Key architectural decisions and patterns to apply",
  "tasks": [
    {
      "id": 1,
      "title": "Short task title",
      "description": "Detailed description of what must be implemented",
      "priority": "critical | high | medium | low",
      "type": "implementation | interface | logic | validation | error-handling | testing",
      "dependencies": []
    }
  ],
  "constraints": [
    "Must use strict TypeScript",
    "No external dependencies unless necessary",
    "All functions must be pure and testable"
  ]
}
</analysis>

QUALITY STANDARDS:
- Tasks must be granular (one responsibility each).
- Every edge case must be represented as a task or constraint.
- Order tasks logically — foundational tasks first.
- Be specific: "implement X using Y pattern" not "add X feature".`;

  async execute(input: AgentInput): Promise<AgentOutput> {
    const output = await this.runAgent(input, true);
    return output;
  }

  /**
   * Parses the raw agent output into a structured AnalysisResult.
   * Falls back gracefully if JSON parsing fails.
   */
  parseOutput(output: AgentOutput, originalPrompt: string): AnalysisResult {
    try {
      const match = output.rawContent.match(/<analysis>([\s\S]*?)<\/analysis>/);
      if (!match || !match[1]) throw new Error('No <analysis> block found.');

      const parsed = JSON.parse(match[1].trim()) as Omit<AnalysisResult, 'raw'>;

      return { ...parsed, raw: output };
    } catch {
      // Graceful fallback: return a minimal structure
      return {
        summary: output.rawContent.slice(0, 300),
        language: 'typescript',
        estimatedComplexity: 'moderate',
        architectureNotes: 'See raw output for details.',
        tasks: [
          {
            id: 1,
            title: 'Implement the requested feature',
            description: originalPrompt,
            priority: 'critical',
            type: 'implementation',
            dependencies: [],
          },
        ],
        constraints: ['Follow TypeScript strict mode', 'Write clean, documented code'],
        raw: output,
      };
    }
  }
}
