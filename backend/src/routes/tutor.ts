// AI tutor proxy. The browser sends the conversation (each user turn already
// carries the circuit context); the server adds the system prompt, calls Claude
// with the server's credentials, and streams text back as Server-Sent Events.
//
// The server is stateless: when the reply finishes it sends the assistant's full
// content blocks (including thinking blocks) in a `done` event, and the browser
// appends them unchanged to the history it sends next turn.

import Anthropic from '@anthropic-ai/sdk';
import { Router, type Response } from 'express';
import { handle, HttpError, rateLimit } from '../http';

export const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 100;

const SYSTEM = `You are the built-in electronics tutor of Ohmlab, a circuit simulator used by students and engineers.
Each user turn includes the user's current circuit as a SPICE-style netlist plus the simulator's computed results (node voltages, component voltages, currents and power) and an automatic analysis.
Explain why the circuit behaves the way it does, grounded in those numbers and in physics: Ohm's law, KCL/KVL, power, time constants, reactance, diode and transistor behaviour.
Show the key equation with the actual values substituted when it helps. If the circuit has a problem (overcurrent, missing ground, floating parts, wrong polarity), say so and suggest a concrete fix with component values.
Keep answers focused and readable: short paragraphs or bullet lists, plain-text math (e.g. I = V/R = 9 V / 6.5 kΩ = 1.38 mA). Don't invent measurements that aren't in the data.`;

/**
 * Create a client from the environment (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, an
 * `ant auth login` profile, …) and confirm the credentials with a free Models API lookup.
 * Returns null when there are no usable credentials or OHMLAB_TUTOR=off.
 */
export async function resolveTutorClient(): Promise<{ client: Anthropic | null; reason: string }> {
  if (process.env.OHMLAB_TUTOR === 'off') return { client: null, reason: 'disabled by OHMLAB_TUTOR=off' };
  const client = new Anthropic();
  try {
    await client.models.retrieve(MODEL);
    return { client, reason: `enabled (${MODEL})` };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      return { client: null, reason: 'disabled — the Anthropic credentials were rejected' };
    if (!(e instanceof Anthropic.APIError))
      return { client: null, reason: 'disabled — no Anthropic credentials (set ANTHROPIC_API_KEY or run `ant auth login`)' };
    // network trouble or a transient API error: keep the tutor on, requests will report errors
    return { client, reason: `enabled (${MODEL}), but the credential check failed: ${e.message}` };
  }
}

function parseMessages(body: unknown): Anthropic.Beta.BetaMessageParam[] {
  const messages = (body as { messages?: unknown } | undefined)?.messages;
  if (!Array.isArray(messages) || messages.length === 0) throw new HttpError(400, '"messages" must be a non-empty array.');
  if (messages.length > MAX_TURNS * 2) throw new HttpError(400, 'Conversation is too long. Start a new one.');
  messages.forEach((m, i) => {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== (i % 2 === 0 ? 'user' : 'assistant')) throw new HttpError(400, 'Messages must alternate user / assistant, starting with user.');
    if (typeof content !== 'string' && !Array.isArray(content)) throw new HttpError(400, 'Each message needs string or array content.');
  });
  if (messages.length % 2 === 0) throw new HttpError(400, 'The last message must be from the user.');
  return messages as Anthropic.Beta.BetaMessageParam[];
}

function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The server's Anthropic credentials were rejected.";
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API — wait a moment and try again.';
  if (e instanceof Anthropic.BadRequestError) return `The request was rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'The server could not reach the Anthropic API.';
  if (e instanceof Anthropic.APIError) return `Anthropic API error ${e.status}.`;
  return 'The tutor failed unexpectedly.';
}

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function tutorRouter(client: Anthropic | null): Router {
  const r = Router();

  r.get('/tutor', (_req, res) => res.json({ enabled: client !== null, model: MODEL }));

  r.post(
    '/tutor',
    rateLimit(20, 60_000),
    handle(async (req, res) => {
      if (!client) throw new HttpError(503, 'The AI tutor is not configured on this server (set ANTHROPIC_API_KEY).');
      const messages = parseMessages(req.body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        messages,
      } as Anthropic.Beta.Messages.MessageCreateParamsStreaming);

      // stop paying for tokens nobody will read
      res.on('close', () => {
        if (!res.writableEnded) stream.abort();
      });
      stream.on('text', (text) => sse(res, 'text', { text }));

      try {
        const final = await stream.finalMessage();
        sse(res, 'done', { content: final.content, stopReason: final.stop_reason });
      } catch (e) {
        if (!res.destroyed) {
          if (!(e instanceof Anthropic.APIUserAbortError)) console.error('tutor:', e);
          sse(res, 'error', { message: describeError(e) });
        }
      }
      res.end();
    }),
  );

  return r;
}
