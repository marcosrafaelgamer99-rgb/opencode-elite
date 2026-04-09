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

      // Helpper to call HF using native fetch
      const callHf = async (messages: any[], max_tokens: number, agentName: string) => {
        sendEvent({ type: 'stream_start', agent: agentName });
        
        const response = await fetch("https://router.huggingface.co/hf-inference/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${hfToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens,
            stream: true
          })
        });

        if (!response.ok) {
           const errText = await response.text();
           throw new Error(`HF API HTTP ${response.status}: ${errText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No stream content from HF");
        
        const dec = new TextDecoder();
        let fullContent = '';
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';
          
          for (const line of parts) {
            if (line.startsWith('data: ')) {
               const dataStr = line.slice(6).trim();
               if (dataStr === '[DONE]') continue;
               try {
                 const data = JSON.parse(dataStr);
                 const token = data.choices[0]?.delta?.content || '';
                 if (token) {
                   fullContent += token;
                   sendEvent({ type: 'token', token });
                 }
               } catch (e) {
                 // ignore parse errors for partial chunks
               }
            }
          }
        }
        return fullContent;
      };

      try {
        sendEvent({ type: 'phase', phase: 'analyzing' });

        if (mode === 'fast') {
          sendEvent({ type: 'phase', phase: 'coding' });
          const out = await callHf(
            [{ role: 'system', content: MASTER_SYSTEM_PROMPT }, ...history, { role: 'user', content: prompt }],
            2000, 'OpenCode'
          );
          sendEvent({ type: 'stream_end', agent: 'OpenCode', content: out, final: true });

        } else {
          // Step 1: Analyst
          sendEvent({ type: 'phase', phase: 'thinking' });
          const analystOutput = await callHf(
            [{ role: 'system', content: MASTER_SYSTEM_PROMPT + '\n' + AGENT_PROMPTS.analyst }, ...history, { role: 'user', content: prompt }],
            1500, 'Analyst 🧠'
          );
          sendEvent({ type: 'stream_end', agent: 'Analyst 🧠', content: analystOutput });

          // Step 2: Coder
          sendEvent({ type: 'phase', phase: 'coding' });
          const coderOutput = await callHf(
            [
              { role: 'system', content: MASTER_SYSTEM_PROMPT + '\n' + AGENT_PROMPTS.coder },
              ...history,
              { role: 'user', content: prompt },
              { role: 'assistant', content: analystOutput },
              { role: 'user', content: `Please implement the exact solution based on your plan.` }
            ],
            2500, 'Senior Coder 💻'
          );
          sendEvent({ type: 'stream_end', agent: 'Senior Coder 💻', content: coderOutput });

          // Step 3: Auditor
          sendEvent({ type: 'phase', phase: 'auditing' });
          const auditOutput = await callHf(
            [
              { role: 'system', content: MASTER_SYSTEM_PROMPT + '\n' + AGENT_PROMPTS.security },
              { role: 'user', content: `Audit this code:\n\n${coderOutput}` }
            ],
            1000, 'Security Auditor 🔍'
          );
          sendEvent({ type: 'stream_end', agent: 'Security Auditor 🔍', content: auditOutput, final: true });
        }

        sendEvent({ type: 'phase', phase: 'done' });
        controller.close();
      } catch (error: any) {
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
