/**
 * OpenCode — API Server
 * Express backend that serves the chatbot UI and routes requests
 * through the multi-agent pipeline via HuggingFace Inference API.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { hfProvider, HF_MODELS } from '../providers/huggingface.provider.js';
import { buildSystemPrompt, getMasterPrompt } from '../core/system-prompt.js';
import { config } from '../core/config.js';
import type { HFMessage } from '../providers/huggingface.provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Server Setup ─────────────────────────────────────────────────────────

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// ─── WebSocket — Real-time Streaming ─────────────────────────────────────

interface WSMessage {
  type: 'chat' | 'ping';
  prompt: string;
  history: HFMessage[];
  model?: string;
  mode?: 'fast' | 'deep';
}

type AgentPhase =
  | 'analyzing'
  | 'thinking'
  | 'coding'
  | 'auditing'
  | 'done'
  | 'error';

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg: WSMessage;
    try {
      msg = JSON.parse(raw.toString()) as WSMessage;
    } catch {
      send(ws, { type: 'error', message: 'Invalid message format.' });
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }

    if (msg.type !== 'chat') return;

    const model = msg.model ?? HF_MODELS.mid;
    const userPrompt = msg.prompt.trim();
    const history = msg.history ?? [];
    const mode = msg.mode ?? 'deep';

    try {
      // ── Phase: Analyzing ──────────────────────────────────────────
      send(ws, { type: 'phase', phase: 'analyzing' as AgentPhase });

      // ── FAST MODE: Single agent, direct response ──────────────────
      if (mode === 'fast') {
        await runFastMode(ws, model, userPrompt, history);
        return;
      }

      // ── DEEP MODE: Multi-agent pipeline ───────────────────────────
      await runDeepMode(ws, model, userPrompt, history);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      send(ws, { type: 'phase', phase: 'error' as AgentPhase });
      send(ws, { type: 'error', message });
    }
  });
});

// ─── Fast Mode (single agent) ─────────────────────────────────────────────

async function runFastMode(
  ws: WebSocket,
  model: string,
  userPrompt: string,
  history: HFMessage[]
): Promise<void> {
  const messages: HFMessage[] = [
    { role: 'system', content: getMasterPrompt() },
    ...history,
    { role: 'user', content: userPrompt },
  ];

  send(ws, { type: 'phase', phase: 'coding' as AgentPhase });
  send(ws, { type: 'stream_start', agent: 'OpenCode' });

  let fullContent = '';

  await hfProvider.stream(model, messages, (token) => {
    fullContent += token;
    send(ws, { type: 'token', token });
  });

  send(ws, { type: 'stream_end', agent: 'OpenCode', content: fullContent });
  send(ws, { type: 'phase', phase: 'done' as AgentPhase });
}

// ─── Deep Mode (multi-agent pipeline) ────────────────────────────────────

async function runDeepMode(
  ws: WebSocket,
  model: string,
  userPrompt: string,
  history: HFMessage[]
): Promise<void> {
  // ── Step 1: Analyst ──────────────────────────────────────────────
  send(ws, { type: 'phase', phase: 'thinking' as AgentPhase });
  send(ws, { type: 'stream_start', agent: 'Analyst 🧠' });

  const analystMessages: HFMessage[] = [
    { role: 'system', content: buildSystemPrompt('architect') },
    ...history,
    {
      role: 'user',
      content: `Analyze this request and create a structured implementation plan:\n\n${userPrompt}`,
    },
  ];

  let analystOutput = '';
  await hfProvider.stream(model, analystMessages, (token) => {
    analystOutput += token;
    send(ws, { type: 'token', token });
  });
  send(ws, { type: 'stream_end', agent: 'Analyst 🧠', content: analystOutput });

  // ── Step 2: Senior Coder ─────────────────────────────────────────
  send(ws, { type: 'phase', phase: 'coding' as AgentPhase });
  send(ws, { type: 'stream_start', agent: 'Senior Coder 💻' });

  const coderMessages: HFMessage[] = [
    { role: 'system', content: buildSystemPrompt('coder') },
    ...history,
    { role: 'user', content: userPrompt },
    { role: 'assistant', content: `I have analyzed the requirements. Here is my implementation plan:\n${analystOutput}` },
    { role: 'user', content: 'Now implement the complete, production-ready solution based on that plan.' },
  ];

  let coderOutput = '';
  await hfProvider.stream(model, coderMessages, (token) => {
    coderOutput += token;
    send(ws, { type: 'token', token });
  });
  send(ws, { type: 'stream_end', agent: 'Senior Coder 💻', content: coderOutput });

  // ── Step 3: Security Auditor ─────────────────────────────────────
  send(ws, { type: 'phase', phase: 'auditing' as AgentPhase });
  send(ws, { type: 'stream_start', agent: 'Security Auditor 🔍' });

  const auditorMessages: HFMessage[] = [
    { role: 'system', content: buildSystemPrompt('security') },
    {
      role: 'user',
      content: `Review this code for bugs, type safety, and security issues:\n\n${coderOutput}\n\nProvide a score (0-100) and list any issues found. If score >= 85, state APPROVED.`,
    },
  ];

  let auditOutput = '';
  await hfProvider.stream(model, auditorMessages, (token) => {
    auditOutput += token;
    send(ws, { type: 'token', token });
  });
  send(ws, {
    type: 'stream_end',
    agent: 'Security Auditor 🔍',
    content: auditOutput,
    final: true,
  });

  send(ws, { type: 'phase', phase: 'done' as AgentPhase });
}

// ─── REST Endpoints ───────────────────────────────────────────────────────

/** Health check + HF token validation */
app.get('/api/status', async (_req, res) => {
  const tokenInfo = await hfProvider.verifyToken();
  res.json({
    status: 'ok',
    hf: tokenInfo,
    models: HF_MODELS,
    defaultModel: HF_MODELS.mid,
  });
});

/** Test if a specific HF model is accessible */
app.get('/api/models/test/:modelKey', async (req, res) => {
  const key = req.params.modelKey as keyof typeof HF_MODELS;
  const modelId = HF_MODELS[key];
  if (!modelId) {
    res.status(400).json({ error: 'Unknown model key' });
    return;
  }
  const accessible = await hfProvider.testModel(modelId);
  res.json({ model: modelId, accessible });
});

/** Serve the chatbot UI */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../public/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────

export function startServer(): void {
  const port = config.API_PORT;
  server.listen(port, () => {
    console.log(`\n  ◈ OpenCode server running at http://localhost:${port}\n`);
  });
}
