export const maxDuration = 60; // 60s max execution for typical AI

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { HfInference } from '@huggingface/inference';

const MASTER_SYSTEM_PROMPT = `You are OpenCode — an elite software engineering system. 
Follow these principles:
1. Write production-ready, highly optimized, and maintainable code.
2. Use strict typing and modern best practices.
3. Be direct, professional, and act as a senior staff engineer.
4. When planning architecture, explain tradeoffs clearly.
5. Provide mentor-level feedback silently identifying potential bottlenecks.`;

const AGENT_PROMPTS = {
  analyst: `YOUR ROLE: Agent.Architect. Analyze the request, define the structure, patterns, and strict execution plan. Output your plan clearly.`,
  coder: `YOUR ROLE: Agent.Senior_Coder. Implement the architecture plan with perfect code. No magic numbers, strict types, clean logic.`,
  security: `YOUR ROLE: Agent.Security_Auditor. Review code strictly for memory leaks, injections, type safety, and race conditions. Pass if everything is production-ready.`,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // HF Token da Vercel
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    return res.status(500).json({ error: 'HF_TOKEN missing in Vercel' });
  }

  const body = (req.body || {}) as any;
  const { prompt, history = [], model = 'Qwen/Qwen2.5-Coder-7B-Instruct', mode = 'deep' } = body;
  
  const hf = new HfInference(hfToken);

  // Setup Server-Sent Events headers natively
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as any).flush?.(); // Explicit Vercel native flush
  };

  try {
    sendEvent({ type: 'phase', phase: 'analyzing' });

    if (mode === 'fast') {
      sendEvent({ type: 'phase', phase: 'coding' });
      sendEvent({ type: 'stream_start', agent: 'OpenCode' });
      
      const stream = hf.chatCompletionStream({
        model,
        messages: [{ role: 'system', content: MASTER_SYSTEM_PROMPT }, ...history, { role: 'user', content: prompt }],
        max_tokens: 2000,
      });

      let full = '';
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content || '';
        if (token) {
           full += token;
           sendEvent({ type: 'token', token });
        }
      }

      sendEvent({ type: 'stream_end', agent: 'OpenCode', content: full, final: true });

    } else {
      // Step 1: Analyst
      sendEvent({ type: 'phase', phase: 'thinking' });
      sendEvent({ type: 'stream_start', agent: 'Analyst 🧠' });
      let analystOutput = '';
      let stream1 = hf.chatCompletionStream({
        model,
        messages: [
          { role: 'system', content: MASTER_SYSTEM_PROMPT + '\n' + AGENT_PROMPTS.analyst },
          ...history,
          { role: 'user', content: prompt }
        ],
        max_tokens: 1500,
      });
      for await (const chunk of stream1) {
        const token = chunk.choices[0]?.delta?.content || '';
        analystOutput += token;
        sendEvent({ type: 'token', token });
      }
      sendEvent({ type: 'stream_end', agent: 'Analyst 🧠', content: analystOutput });

      // Step 2: Coder
      sendEvent({ type: 'phase', phase: 'coding' });
      sendEvent({ type: 'stream_start', agent: 'Senior Coder 💻' });
      let coderOutput = '';
      let stream2 = hf.chatCompletionStream({
        model,
        messages: [
          { role: 'system', content: MASTER_SYSTEM_PROMPT + '\n' + AGENT_PROMPTS.coder },
          ...history,
          { role: 'user', content: prompt },
          { role: 'assistant', content: analystOutput },
          { role: 'user', content: `Please implement the exact solution based on your plan.` }
        ],
        max_tokens: 2500,
      });
      for await (const chunk of stream2) {
        const token = chunk.choices[0]?.delta?.content || '';
        coderOutput += token;
        sendEvent({ type: 'token', token });
      }
      sendEvent({ type: 'stream_end', agent: 'Senior Coder 💻', content: coderOutput });

      // Step 3: Auditor
      sendEvent({ type: 'phase', phase: 'auditing' });
      sendEvent({ type: 'stream_start', agent: 'Security Auditor 🔍' });
      let auditOutput = '';
      let stream3 = hf.chatCompletionStream({
        model,
        messages: [
          { role: 'system', content: MASTER_SYSTEM_PROMPT + '\n' + AGENT_PROMPTS.security },
          { role: 'user', content: `Audit this code:\n\n${coderOutput}` }
        ],
        max_tokens: 1000,
      });
      for await (const chunk of stream3) {
        const token = chunk.choices[0]?.delta?.content || '';
        auditOutput += token;
        sendEvent({ type: 'token', token });
      }
      sendEvent({ type: 'stream_end', agent: 'Security Auditor 🔍', content: auditOutput, final: true });
    }

    sendEvent({ type: 'phase', phase: 'done' });
    res.end();
  } catch (error: any) {
    sendEvent({ type: 'error', message: error.message || 'Hugging Face API Error' });
    sendEvent({ type: 'phase', phase: 'error' });
    res.end();
  }
}
