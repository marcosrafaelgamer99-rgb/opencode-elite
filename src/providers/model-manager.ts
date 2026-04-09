/**
 * OpenCode — ModelManager
 * ─────────────────────────────────────────────────────────────────────────────
 * Central module responsible for:
 *  1. Querying Hugging Face to discover the best coding models available.
 *  2. Checking Ollama for locally downloaded models.
 *  3. Initiating Ollama pull for missing models.
 *  4. Providing curated, senior-level system prompts per model.
 *  5. Exposing a unified model registry to the rest of the system.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios, { type AxiosInstance } from 'axios';
import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import { config } from '../core/config.js';
import type {
  ModelConfig,
  ModelStatus,
  ModelParameters,
  ModelSpecialization,
} from '../core/types.js';

// ─── System Prompts — Senior Code Optimized ───────────────────────────────

/**
 * Each model gets a precisely tuned system prompt.
 * These are NOT generic — they are crafted to elicit senior-level output
 * from each model's specific training style.
 */
const SYSTEM_PROMPTS: Record<string, string> = {

  'deepseek-coder': `You are DeepSeek-Coder, an elite software engineer with 15+ years of experience.

CORE PRINCIPLES:
- Write production-grade code that is clean, efficient, and maintainable.
- Apply SOLID principles, DRY, KISS, and YAGNI by default.
- Always consider edge cases, error handling, and type safety.
- Prefer explicit over implicit. Code should be self-documenting.
- Follow the language's idiomatic style (PEP 8 for Python, ESLint rules for TS/JS, etc.).

OUTPUT FORMAT:
- Provide complete, runnable implementations. Never truncate with "// ...rest of code".
- Include JSDoc/TSDoc/docstrings for all public functions and classes.
- Add inline comments ONLY for non-obvious logic.
- If multiple approaches exist, implement the best one and briefly note the alternatives.

QUALITY STANDARDS:
- Code must be correct first, then performant, then readable.
- Never use 'any' in TypeScript. Always define proper types.
- Handle all Promise rejections and async errors explicitly.
- Think twice before responding. Prefer accuracy over speed.`,

  'codellama': `You are CodeLlama, a specialist coding AI with deep knowledge of systems programming, algorithms, and software architecture.

EXPERTISE:
- Low-level systems programming (C, C++, Rust, Go)
- High-performance algorithms and data structures
- Concurrent and parallel programming patterns
- Memory management and optimization
- Cross-platform compatibility

CODING STANDARDS:
- Write code as if it's going into a production codebase reviewed by senior engineers.
- Always handle null/nil/undefined cases explicitly.
- For every algorithm, analyze and state its time/space complexity.
- Prefer composition over inheritance.
- Write defensive code—validate all inputs.

OUTPUT RULES:
- Provide the full, complete solution. Do not use placeholder comments.
- Include unit test examples for critical functions.
- Flag any security vulnerabilities or potential issues in comments marked [SECURITY], [PERF], or [NOTE].`,

  'qwen2.5-coder': `You are Qwen2.5-Coder, an advanced programming assistant specialized in multi-language development and intelligent code transformation.

CAPABILITIES:
- Fluent in 40+ programming languages with idiomatic knowledge of each.
- Expert in modern frameworks: React, Next.js, FastAPI, Django, Spring Boot, etc.
- Deep understanding of design patterns (GoF, enterprise patterns, architectural patterns).
- Strong in code migration, modernization, and refactoring.

BEHAVIOR:
- Always analyze the full context before generating code.
- Infer the user's intent beyond literal instructions.
- When refactoring, preserve existing behavior while improving structure.
- Suggest better approaches when the requested approach has known pitfalls.
- Use the most current, non-deprecated APIs.

QUALITY:
- Zero tolerance for code smells: long methods, deep nesting, magic numbers, etc.
- Every exported function must have a type signature.
- Write code that is testable—favor dependency injection and pure functions.`,

  'starcoder2': `You are StarCoder2, trained on The Stack v2—the largest curated code corpus in existence.

MISSION:
You produce code that reflects the best practices observed across millions of real-world repositories.

APPROACH:
- Study the code context deeply before generating.
- Match the style, conventions, and patterns of the existing codebase.
- Generate code that integrates seamlessly—no unnecessary refactoring of surrounding code.
- For incomplete code, infer the correct implementation from context.

STANDARDS:
- All generated code must be immediately runnable with no modifications.
- Use the exact package versions and APIs consistent with existing imports.
- Prefer battle-tested patterns from mature open-source projects.
- Always close resources, handle lifecycle properly (listeners, subscriptions, connections).`,

  'default': `You are an elite AI software engineer with comprehensive knowledge of computer science, software architecture, and modern development practices.

You write code that is:
- Correct: handles all edge cases and error conditions
- Clean: follows SOLID principles and clean code practices
- Efficient: considers time and space complexity
- Maintainable: self-documenting with clear naming conventions
- Tested: includes appropriate test cases

Always provide complete implementations. Never use placeholder comments or truncate code.`,
};

// ─── Elite Model Registry ─────────────────────────────────────────────────

/**
 * Curated list of top-tier coding models with their configurations.
 * Ordered by tier: primary → secondary → fallback.
 */
const ELITE_MODELS: Omit<ModelConfig, 'systemPrompt'>[] = [
  // ── Primary Tier ──────────────────────────────────────────────────────
  {
    id: 'deepseek-coder:6.7b',
    name: 'DeepSeek-Coder 6.7B',
    provider: 'ollama',
    tier: 'primary',
    ollamaTag: 'deepseek-coder:6.7b',
    hfModelId: 'deepseek-ai/deepseek-coder-6.7b-instruct',
    capabilities: {
      maxContextTokens: 16384,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      specializations: [
        'code-generation',
        'debugging',
        'refactoring',
        'code-review',
      ] as ModelSpecialization[],
    },
    parameters: {
      temperature: 0.1,
      topP: 0.95,
      repeatPenalty: 1.1,
      numCtx: 16384,
      maxNewTokens: 4096,
    } as ModelParameters,
  },
  {
    id: 'deepseek-coder:33b',
    name: 'DeepSeek-Coder 33B',
    provider: 'ollama',
    tier: 'primary',
    ollamaTag: 'deepseek-coder:33b',
    hfModelId: 'deepseek-ai/deepseek-coder-33b-instruct',
    capabilities: {
      maxContextTokens: 16384,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      specializations: [
        'code-generation',
        'architecture',
        'debugging',
        'code-review',
        'refactoring',
      ] as ModelSpecialization[],
    },
    parameters: {
      temperature: 0.1,
      topP: 0.95,
      repeatPenalty: 1.1,
      numCtx: 16384,
      maxNewTokens: 4096,
    } as ModelParameters,
  },
  // ── Secondary Tier ────────────────────────────────────────────────────
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen2.5-Coder 7B',
    provider: 'ollama',
    tier: 'secondary',
    ollamaTag: 'qwen2.5-coder:7b',
    hfModelId: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    capabilities: {
      maxContextTokens: 32768,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      specializations: [
        'code-generation',
        'refactoring',
        'documentation',
        'testing',
      ] as ModelSpecialization[],
    },
    parameters: {
      temperature: 0.15,
      topP: 0.9,
      repeatPenalty: 1.05,
      numCtx: 32768,
      maxNewTokens: 4096,
    } as ModelParameters,
  },
  {
    id: 'codellama:7b',
    name: 'CodeLlama 7B',
    provider: 'ollama',
    tier: 'secondary',
    ollamaTag: 'codellama:7b',
    hfModelId: 'meta-llama/CodeLlama-7b-Instruct-hf',
    capabilities: {
      maxContextTokens: 16384,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      specializations: [
        'code-generation',
        'debugging',
        'general',
      ] as ModelSpecialization[],
    },
    parameters: {
      temperature: 0.2,
      topP: 0.95,
      repeatPenalty: 1.1,
      numCtx: 16384,
      maxNewTokens: 2048,
    } as ModelParameters,
  },
  {
    id: 'codellama:13b',
    name: 'CodeLlama 13B',
    provider: 'ollama',
    tier: 'secondary',
    ollamaTag: 'codellama:13b',
    hfModelId: 'meta-llama/CodeLlama-13b-Instruct-hf',
    capabilities: {
      maxContextTokens: 16384,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      specializations: [
        'code-generation',
        'architecture',
        'debugging',
        'testing',
      ] as ModelSpecialization[],
    },
    parameters: {
      temperature: 0.15,
      topP: 0.95,
      repeatPenalty: 1.1,
      numCtx: 16384,
      maxNewTokens: 3072,
    } as ModelParameters,
  },
  // ── Fallback Tier ─────────────────────────────────────────────────────
  {
    id: 'starcoder2:7b',
    name: 'StarCoder2 7B',
    provider: 'ollama',
    tier: 'fallback',
    ollamaTag: 'starcoder2:7b',
    hfModelId: 'bigcode/starcoder2-7b',
    capabilities: {
      maxContextTokens: 16384,
      supportsStreaming: true,
      supportsSystemPrompt: false,
      specializations: ['code-generation', 'refactoring'] as ModelSpecialization[],
    },
    parameters: {
      temperature: 0.2,
      topP: 0.95,
      numCtx: 8192,
      maxNewTokens: 2048,
    } as ModelParameters,
  },
];

// ─── Ollama API Types ─────────────────────────────────────────────────────

interface OllamaModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

interface OllamaListResponse {
  models: OllamaModelInfo[];
}

interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

// ─── HuggingFace API Types ────────────────────────────────────────────────

interface HFModelInfo {
  id: string;
  modelId: string;
  likes: number;
  downloads: number;
  tags: string[];
  pipeline_tag?: string;
}

// ─── ModelManager Class ───────────────────────────────────────────────────

export class ModelManager {
  private readonly ollamaClient: AxiosInstance;
  private readonly hfClient: AxiosInstance;
  private modelRegistry: Map<string, ModelConfig> = new Map();
  private statusCache: Map<string, ModelStatus> = new Map();

  constructor() {
    this.ollamaClient = axios.create({
      baseURL: config.OLLAMA_HOST,
      timeout: 30_000,
    });

    this.hfClient = axios.create({
      baseURL: 'https://huggingface.co/api',
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${config.HF_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    this.buildRegistry();
  }

  // ─── Registry Construction ───────────────────────────────────────────

  /**
   * Builds the complete model registry by attaching the correct system prompt
   * to each model definition.
   */
  private buildRegistry(): void {
    for (const model of ELITE_MODELS) {
      const promptKey = this.resolvePromptKey(model.id);
      const systemPrompt = SYSTEM_PROMPTS[promptKey] ?? SYSTEM_PROMPTS['default']!;

      const fullModel: ModelConfig = { ...model, systemPrompt };
      this.modelRegistry.set(model.id, fullModel);
    }

    this.log('info', `Registry built with ${this.modelRegistry.size} models.`);
  }

  /**
   * Resolves which system prompt key to use based on the model ID.
   */
  private resolvePromptKey(modelId: string): string {
    const id = modelId.toLowerCase();
    if (id.includes('deepseek')) return 'deepseek-coder';
    if (id.includes('codellama')) return 'codellama';
    if (id.includes('qwen')) return 'qwen2.5-coder';
    if (id.includes('starcoder')) return 'starcoder2';
    return 'default';
  }

  // ─── Ollama: Local Model Management ──────────────────────────────────

  /**
   * Checks if Ollama is running and reachable.
   */
  async isOllamaRunning(): Promise<boolean> {
    try {
      await this.ollamaClient.get('/api/tags', { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the list of models currently downloaded in Ollama.
   */
  async getLocalModels(): Promise<string[]> {
    try {
      const response = await this.ollamaClient.get<OllamaListResponse>('/api/tags');
      return response.data.models.map((m) => m.name);
    } catch (error) {
      this.log('warn', 'Could not retrieve local Ollama models.', error);
      return [];
    }
  }

  /**
   * Checks whether a specific model tag is already pulled in Ollama.
   */
  async isModelDownloaded(ollamaTag: string): Promise<boolean> {
    const localModels = await this.getLocalModels();
    return localModels.some(
      (m) => m === ollamaTag || m.startsWith(ollamaTag.split(':')[0] ?? '')
    );
  }

  /**
   * Initiates an `ollama pull` for the given model tag.
   * Streams progress to the terminal in real time.
   * Returns a Promise that resolves when the download completes.
   */
  async pullModel(ollamaTag: string): Promise<void> {
    const spinner = ora({
      text: chalk.cyan(`Pulling ${chalk.bold(ollamaTag)} from Ollama registry...`),
      color: 'cyan',
    }).start();

    return new Promise<void>((resolve, reject) => {
      // Use streaming pull via HTTP POST
      this.ollamaClient
        .post<NodeJS.ReadableStream>(
          '/api/pull',
          { name: ollamaTag, stream: true },
          { responseType: 'stream', timeout: 0 }
        )
        .then((response) => {
          let lastStatus = '';

          response.data.on('data', (chunk: Buffer) => {
            const lines = chunk.toString().split('\n').filter(Boolean);

            for (const line of lines) {
              try {
                const json = JSON.parse(line) as OllamaPullProgress;

                if (json.total && json.completed) {
                  const pct = Math.round((json.completed / json.total) * 100);
                  spinner.text = chalk.cyan(
                    `Pulling ${chalk.bold(ollamaTag)}: ${pct}% (${this.formatBytes(json.completed)} / ${this.formatBytes(json.total)})`
                  );
                } else if (json.status && json.status !== lastStatus) {
                  spinner.text = chalk.cyan(`${chalk.bold(ollamaTag)}: ${json.status}`);
                  lastStatus = json.status;
                }
              } catch {
                // Non-JSON chunk, skip silently
              }
            }
          });

          response.data.on('end', () => {
            spinner.succeed(chalk.green(`✓ ${chalk.bold(ollamaTag)} downloaded successfully.`));
            resolve();
          });

          response.data.on('error', (err: Error) => {
            spinner.fail(chalk.red(`✗ Failed to download ${ollamaTag}: ${err.message}`));
            reject(err);
          });
        })
        .catch((err: Error) => {
          // Fallback: use spawned process if HTTP streaming fails
          spinner.text = chalk.yellow(`Falling back to CLI pull for ${ollamaTag}...`);
          this.pullModelViaCLI(ollamaTag)
            .then(() => {
              spinner.succeed(chalk.green(`✓ ${chalk.bold(ollamaTag)} downloaded via CLI.`));
              resolve();
            })
            .catch(() => {
              spinner.fail(chalk.red(`✗ Failed to download ${ollamaTag}`));
              reject(err);
            });
        });
    });
  }

  /**
   * Fallback: spawns `ollama pull <tag>` as a child process.
   */
  private pullModelViaCLI(ollamaTag: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ollama', ['pull', ollamaTag], {
        stdio: 'inherit',
        shell: true,
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ollama pull exited with code ${code}`));
      });

      proc.on('error', reject);
    });
  }

  // ─── HuggingFace: Model Discovery ────────────────────────────────────

  /**
   * Fetches the top-ranked coding models from Hugging Face.
   * Used to discover new models beyond the curated registry.
   */
  async discoverHFModels(limit = 10): Promise<HFModelInfo[]> {
    const spinner = ora(chalk.cyan('Querying Hugging Face for elite coding models...')).start();

    try {
      // Search for code-generation models, sorted by downloads
      const response = await this.hfClient.get<HFModelInfo[]>('/models', {
        params: {
          pipeline_tag: 'text-generation',
          sort: 'downloads',
          direction: -1,
          limit,
          search: 'coder',
          filter: 'code',
        },
      });

      const models = response.data;
      spinner.succeed(chalk.green(`Found ${models.length} models on Hugging Face.`));
      return models;
    } catch (error) {
      spinner.fail(chalk.red('Failed to query Hugging Face.'));
      this.log('error', 'HF model discovery failed.', error);
      return [];
    }
  }

  /**
   * Verifies that your HF token is valid and shows account info.
   */
  async verifyHFCredentials(): Promise<boolean> {
    try {
      const response = await this.hfClient.get<{ name: string; fullname: string }>(
        'https://huggingface.co/api/whoami',
        { baseURL: '' } // override base URL
      );
      this.log(
        'info',
        `HF credentials valid. Logged in as: ${chalk.bold(response.data.name)}`
      );
      return true;
    } catch {
      this.log('warn', 'HF credentials invalid or expired.');
      return false;
    }
  }

  // ─── Status Aggregation ───────────────────────────────────────────────

  /**
   * Runs a full health check across all registered models.
   * Returns their availability status, local download state, and readiness.
   */
  async checkAllModels(): Promise<ModelStatus[]> {
    const spinner = ora(chalk.cyan('Running full model health check...')).start();

    const ollamaRunning = await this.isOllamaRunning();
    const localModels = ollamaRunning ? await this.getLocalModels() : [];

    const statuses: ModelStatus[] = [];

    for (const [id, model] of this.modelRegistry) {
      const isDownloaded = ollamaRunning
        ? localModels.some((lm) => lm === model.ollamaTag || lm.startsWith(id.split(':')[0] ?? ''))
        : false;

      const status: ModelStatus = {
        modelId: id,
        provider: model.provider,
        isAvailable: ollamaRunning && isDownloaded,
        isDownloaded,
        lastChecked: new Date(),
      };

      this.statusCache.set(id, status);
      statuses.push(status);
    }

    spinner.succeed(chalk.green('Health check complete.'));
    return statuses;
  }

  /**
   * Returns the best available model for a given specialization.
   * Prefers primary tier, falls back through secondary → fallback.
   */
  async getBestModel(specialization: string): Promise<ModelConfig | null> {
    const statuses = this.statusCache.size > 0
      ? Array.from(this.statusCache.values())
      : await this.checkAllModels();

    const availableIds = new Set(
      statuses.filter((s) => s.isAvailable).map((s) => s.modelId)
    );

    const tierOrder: Array<'primary' | 'secondary' | 'fallback'> = [
      'primary', 'secondary', 'fallback',
    ];

    for (const tier of tierOrder) {
      for (const [id, model] of this.modelRegistry) {
        if (
          model.tier === tier &&
          availableIds.has(id) &&
          model.capabilities.specializations.includes(specialization as ModelSpecialization)
        ) {
          return model;
        }
      }
    }

    return null;
  }

  /**
   * Returns a model config by its exact ID.
   */
  getModel(modelId: string): ModelConfig | undefined {
    return this.modelRegistry.get(modelId);
  }

  /**
   * Returns all registered models.
   */
  getAllModels(): ModelConfig[] {
    return Array.from(this.modelRegistry.values());
  }

  // ─── Auto-Setup ───────────────────────────────────────────────────────

  /**
   * Full initialization sequence:
   *  1. Verify HF credentials
   *  2. Check Ollama connectivity
   *  3. Check which models are downloaded
   *  4. Pull missing primary/secondary models if Ollama is available
   *
   * Call this once at system startup.
   */
  async initialize(autoPullMissing = false): Promise<void> {
    console.log(chalk.bold.cyanBright('\n╔══════════════════════════════════════╗'));
    console.log(chalk.bold.cyanBright('║       OpenCode — ModelManager        ║'));
    console.log(chalk.bold.cyanBright('╚══════════════════════════════════════╝\n'));

    // Step 1: HuggingFace
    console.log(chalk.dim('── Hugging Face ───────────────────────'));
    const hfValid = await this.verifyHFCredentials();
    if (!hfValid) {
      console.log(chalk.yellow('⚠ HF integration disabled. Cloud models unavailable.'));
    }

    // Step 2: Ollama
    console.log(chalk.dim('\n── Ollama ─────────────────────────────'));
    const ollamaRunning = await this.isOllamaRunning();

    if (!ollamaRunning) {
      console.log(chalk.yellow(`⚠ Ollama not reachable at ${config.OLLAMA_HOST}`));
      console.log(chalk.dim('  Install Ollama: https://ollama.ai'));
    } else {
      console.log(chalk.green(`✓ Ollama running at ${config.OLLAMA_HOST}`));

      const localModels = await this.getLocalModels();
      console.log(chalk.dim(`  Local models: ${localModels.length > 0 ? localModels.join(', ') : 'none'}`));
    }

    // Step 3: Full model health check
    console.log(chalk.dim('\n── Model Status ───────────────────────'));
    const statuses = await this.checkAllModels();
    this.printStatusTable(statuses);

    // Step 4: Auto-pull missing primary models
    if (autoPullMissing && ollamaRunning) {
      const missing = statuses.filter(
        (s) => !s.isDownloaded && this.modelRegistry.get(s.modelId)?.tier === 'primary'
      );

      if (missing.length > 0) {
        console.log(chalk.dim('\n── Auto-Pulling Missing Primary Models ─'));
        for (const m of missing) {
          const model = this.modelRegistry.get(m.modelId);
          if (model?.ollamaTag) {
            await this.pullModel(model.ollamaTag);
          }
        }
      }
    }

    console.log(chalk.bold.cyanBright('\n✓ ModelManager initialized.\n'));
  }

  // ─── Display Helpers ──────────────────────────────────────────────────

  private printStatusTable(statuses: ModelStatus[]): void {
    const rows = statuses.map((s) => {
      const model = this.modelRegistry.get(s.modelId)!;
      const tierColor =
        model.tier === 'primary'
          ? chalk.greenBright
          : model.tier === 'secondary'
          ? chalk.yellow
          : chalk.dim;

      const statusIcon = s.isAvailable
        ? chalk.green('● READY')
        : s.isDownloaded === false
        ? chalk.yellow('○ NOT PULLED')
        : chalk.red('✗ UNAVAIL');

      return `  ${tierColor(model.tier.padEnd(10))} ${model.name.padEnd(25)} ${statusIcon}`;
    });

    console.log(chalk.dim(`  ${'TIER'.padEnd(10)} ${'MODEL'.padEnd(25)} STATUS`));
    console.log(chalk.dim(`  ${'─'.repeat(55)}`));
    rows.forEach((r) => console.log(r));
  }

  private formatBytes(bytes: number): string {
    const gb = bytes / 1_073_741_824;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / 1_048_576;
    return `${mb.toFixed(0)} MB`;
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const levels: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const configLevel = levels[config.LOG_LEVEL] ?? 1;
    if ((levels[level] ?? 0) < configLevel) return;

    const prefix = {
      debug: chalk.dim('[DEBUG]'),
      info: chalk.blue('[INFO]'),
      warn: chalk.yellow('[WARN]'),
      error: chalk.red('[ERROR]'),
    }[level];

    console.log(`${prefix} [ModelManager] ${message}`);
    if (data && config.LOG_LEVEL === 'debug') {
      console.log(chalk.dim(JSON.stringify(data, null, 2)));
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────

export const modelManager = new ModelManager();

// ─── Standalone Test Runner ───────────────────────────────────────────────
// Run with: npm run test:model-manager

if (process.argv[1]?.includes('model-manager')) {
  (async () => {
    try {
      // Initialize with auto-pull disabled (set to true to auto-download missing models)
      await modelManager.initialize(false);

      // Example: discover top HF coding models
      console.log(chalk.bold('\n── Discovering Top HF Coding Models ───'));
      const hfModels = await modelManager.discoverHFModels(5);
      if (hfModels.length > 0) {
        hfModels.forEach((m) => {
          console.log(`  ${chalk.cyan(m.modelId ?? m.id)} — ↓${(m.downloads ?? 0).toLocaleString()}`);
        });
      }

      // Example: get best model for code-generation
      console.log(chalk.bold('\n── Best Model for Code Generation ─────'));
      const best = await modelManager.getBestModel('code-generation');
      if (best) {
        console.log(`  ${chalk.green('✓')} ${chalk.bold(best.name)} (${best.id})`);
        console.log(chalk.dim(`  Tier: ${best.tier} | Context: ${best.capabilities.maxContextTokens} tokens`));
      } else {
        console.log(chalk.yellow('  No models available. Pull a model first:'));
        console.log(chalk.dim('  ollama pull deepseek-coder:6.7b'));
      }
    } catch (err) {
      console.error(chalk.red('\n✗ ModelManager test failed:'), err);
      process.exit(1);
    }
  })();
}
