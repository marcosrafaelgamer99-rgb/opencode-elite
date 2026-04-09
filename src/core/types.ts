/**
 * OpenCode — Core Type Definitions
 * Central type system for the entire multi-agent architecture.
 */

// ─── LLM Provider Types ────────────────────────────────────────────────────

export type ProviderName = 'ollama' | 'huggingface';

export type ModelTier = 'primary' | 'secondary' | 'fallback';

export interface ModelCapabilities {
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsSystemPrompt: boolean;
  specializations: ModelSpecialization[];
}

export type ModelSpecialization =
  | 'code-generation'
  | 'code-review'
  | 'debugging'
  | 'refactoring'
  | 'architecture'
  | 'documentation'
  | 'testing'
  | 'general';

export interface ModelConfig {
  id: string;                     // e.g. "deepseek-coder:6.7b"
  name: string;                   // Human-readable name
  provider: ProviderName;
  tier: ModelTier;
  capabilities: ModelCapabilities;
  systemPrompt: string;           // Senior-code optimized system prompt
  parameters: ModelParameters;
  hfModelId?: string;             // HuggingFace model repo ID (if cloud model)
  ollamaTag?: string;             // Ollama pull tag (if local model)
}

export interface ModelParameters {
  temperature: number;            // 0.0–1.0 (lower = more deterministic for code)
  topP: number;
  topK?: number;
  repeatPenalty?: number;
  numCtx?: number;                // Context window size (Ollama)
  maxNewTokens?: number;          // Max tokens to generate
  seed?: number;                  // For reproducibility
}

export interface ModelStatus {
  modelId: string;
  provider: ProviderName;
  isAvailable: boolean;
  isDownloaded?: boolean;         // Relevant for Ollama
  downloadProgress?: number;      // 0–100
  lastChecked: Date;
  error?: string;
}

// ─── Agent Types ───────────────────────────────────────────────────────────

export type AgentRole =
  | 'planner'
  | 'coder'
  | 'reviewer'
  | 'refactorer'
  | 'tester'
  | 'debugger'
  | 'architect'
  | 'documenter';

export interface AgentTask {
  id: string;
  role: AgentRole;
  input: string;
  context?: CodeContext;
  previousResults?: AgentResult[];
  modelOverride?: string;
  sessionId: string;
}

export interface AgentResult {
  taskId: string;
  role: AgentRole;
  output: string;
  modelUsed: string;
  providerUsed: ProviderName;
  tokensUsed?: number;
  durationMs: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type AgentStatus = 'idle' | 'running' | 'completed' | 'failed' | 'retrying';

// ─── Pipeline Types ────────────────────────────────────────────────────────

export interface PipelineStep {
  agentRole: AgentRole;
  dependsOn?: AgentRole[];
  optional?: boolean;
  retryCount?: number;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  steps: PipelineStep[];
}

export type PipelineName =
  | 'code-generation'
  | 'debug'
  | 'refactor'
  | 'full-feature';

// ─── Code Context Types ────────────────────────────────────────────────────

export interface CodeContext {
  language?: string;
  framework?: string;
  existingCode?: string;
  filePath?: string;
  errorMessage?: string;
  stackTrace?: string;
  projectStructure?: string;
  dependencies?: string[];
}

// ─── Logging ───────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
}
