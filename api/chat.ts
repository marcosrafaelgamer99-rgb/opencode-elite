export const config = {
  runtime: 'edge', // Usa Edge Runtime da Vercel para permitir Streaming ilimitado/imediato sem timeout
};

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

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  // HF Token da Vercel
  const hfToken = process.env.HF_TOKEN;
  if (!hfToken) {
    return new Response(JSON.stringify({ error: 'HF_TOKEN missing in Vercel' }), { status: 500 });
  }

  const payload = await req.json();
  const { prompt, history = [], model = 'Qwen/Qwen2.5-Coder-7B-Instruct', mode = 'deep' } = payload;
  
  const hf = new HfInference(hfToken);

  const encoder = new TextEncoder();

  // Cria um ReadableStream (padrão web) que a Vercel adora e streama em tempo real
  const customStream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: any) => {
        const str = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(str));
      };

      try {
        sendEvent({ type: 'phase', phase: 'analyzing' });

        if (mode === 'fast') {
          // ── FAST MODE ──
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
            full += token;
            sendEvent({ type: 'token', token });
          }

          sendEvent({ type: 'stream_end', agent: 'OpenCode', content: full, final: true });

        } else {
          // ── DEEP MODE (Multi-Agente) ──
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
        controller.close();
      } catch (error: any) {
        // Se ocorrer qualquer erro (API rate limit, timeout da HF) enviamos pro chat.
        sendEvent({ type: 'error', message: error.message || 'Hugging Face API Error' });
        sendEvent({ type: 'phase', phase: 'error' });
        controller.close();
      }
    }
  });

  return new Response(customStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
