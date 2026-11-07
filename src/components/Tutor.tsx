import { useMemo, useRef, useState } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { useStore } from '../state/store';
import { Simulator } from '../engine/simulator';
import { explainCircuit } from '../engine/explain';
import { exportSpice } from '../model/spice';
import { EXAMPLES } from '../model/examples';
import { runtime } from '../state/runtime';

const KEY_STORE = 'ohmlab.anthropicKey';
const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are the built-in electronics tutor of Ohmlab, a circuit simulator used by students and engineers.
Each user turn includes the user's current circuit as a SPICE-style netlist plus the simulator's computed results (node voltages, component voltages, currents and power) and an automatic analysis.
Explain why the circuit behaves the way it does, grounded in those numbers and in physics: Ohm's law, KCL/KVL, power, time constants, reactance, diode and transistor behaviour.
Show the key equation with the actual values substituted when it helps. If the circuit has a problem (overcurrent, missing ground, floating parts, wrong polarity), say so and suggest a concrete fix with component values.
Keep answers focused and readable: short paragraphs or bullet lists, plain-text math (e.g. I = V/R = 9 V / 6.5 kΩ = 1.38 mA). Don't invent measurements that aren't in the data.`;

function readKey() {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

interface ChatMsg {
  role: 'user' | 'assistant';
  shown: string;
}

export function Tutor() {
  const circuit = useStore((s) => s.circuit);
  const snapshot = useStore((s) => s.snapshot);
  const status = useStore((s) => s.simStatus);
  const pressed = useStore((s) => s.pressed);
  const activeExample = useStore((s) => s.activeExample);

  // built-in analysis: uses the live transient state when running, otherwise the DC operating point
  const analysis = useMemo(() => {
    if (status !== 'stopped' && snapshot && runtime.sim) return { mode: 'transient' as const, sim: runtime.sim, snap: snapshot };
    const sim = new Simulator(circuit, new Set(Object.keys(pressed)));
    const r = sim.solveDC();
    return r.ok ? { mode: 'dc' as const, sim, snap: sim.snapshot() } : { mode: 'dc' as const, sim, snap: null, error: r.error };
  }, [circuit, snapshot, status, pressed]);
  const sections = useMemo(
    () => (analysis.snap ? explainCircuit(circuit, analysis.snap, analysis.sim, analysis.mode) : []),
    [analysis, circuit],
  );

  const [apiKey, setApiKey] = useState(readKey());
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const apiHistory = useRef<Anthropic.Beta.BetaMessageParam[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  const context = () => {
    const ex = EXAMPLES.find((e) => e.id === activeExample);
    const results = analysis.snap
      ? circuit.components
          .filter((c) => c.type !== 'ground')
          .map((c) => {
            const r = analysis.snap!.readings[c.id];
            return `${c.label} (${c.type}): V=${r.v.toPrecision(5)} V, I=${r.i.toPrecision(5)} A, P=${r.p.toPrecision(5)} W${r.extra ? ' ' + JSON.stringify(r.extra) : ''}`;
          })
          .join('\n')
      : `Simulation failed: ${'error' in analysis ? analysis.error : 'unknown'}`;
    const nodes = analysis.snap ? analysis.snap.nodeV.map((v, i) => `${analysis.sim.netlist.netNames[i]}=${v.toPrecision(5)} V`).join(', ') : '';
    const auto = sections.map((s) => `## ${s.title}\n${s.paragraphs.join('\n')}`).join('\n\n');
    return `<circuit_context>
Circuit: ${circuit.name}${ex ? ` (example: ${ex.title})` : ''}
Analysis mode: ${analysis.mode === 'dc' ? 'DC operating point' : `transient at t=${analysis.snap?.t.toPrecision(5)} s`}

Netlist:
${exportSpice(circuit)}

Node voltages: ${nodes}

Component results:
${results}

Automatic analysis:
${auto}
</circuit_context>`;
  };

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    if (!apiKey) {
      setErr('Enter an Anthropic API key to use the AI tutor (the built-in analysis on the left works without one).');
      return;
    }
    setErr('');
    setBusy(true);
    setQuestion('');
    const userMsg: Anthropic.Beta.BetaMessageParam = { role: 'user', content: `${context()}\n\nQuestion: ${text}` };
    const messages = [...apiHistory.current, userMsg];
    setChat((c) => [...c, { role: 'user', shown: text }, { role: 'assistant', shown: '' }]);
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        messages,
      } as Anthropic.Beta.Messages.MessageCreateParamsStreaming);
      stream.on('text', (delta) => {
        setChat((c) => {
          const next = [...c];
          next[next.length - 1] = { role: 'assistant', shown: next[next.length - 1].shown + delta };
          return next;
        });
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
      });
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') {
        setChat((c) => {
          const next = [...c];
          next[next.length - 1] = { role: 'assistant', shown: next[next.length - 1].shown + '\n\n[The tutor declined to answer this question.]' };
          return next;
        });
      }
      // keep the full assistant content (including thinking blocks) so history stays append-only
      apiHistory.current = [...messages, { role: 'assistant', content: final.content as Anthropic.Beta.BetaContentBlockParam[] }];
    } catch (e) {
      let msg = (e as Error).message;
      if (e instanceof Anthropic.AuthenticationError) msg = 'Invalid API key.';
      else if (e instanceof Anthropic.RateLimitError) msg = 'Rate limited — wait a moment and try again.';
      else if (e instanceof Anthropic.APIConnectionError) msg = 'Could not reach the Anthropic API (network error).';
      else if (e instanceof Anthropic.APIError) msg = `API error ${e.status}: ${e.message}`;
      setErr(msg);
      setChat((c) => c.slice(0, -2));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = ['Why does the circuit behave this way?', 'Walk me through KCL and KVL for this circuit', 'What would happen if I doubled the resistance?', 'Is anything here overloaded or wired wrong?'];

  return (
    <div className="pad tutor">
      <div className="tutor-col explain">
        <div className="section-title">
          Built-in explanation <span className="muted small">({analysis.mode === 'dc' ? 'DC operating point' : 'live simulation'})</span>
        </div>
        {'error' in analysis && analysis.error && <div className="issue error">{analysis.error}</div>}
        {sections.map((s) => (
          <div key={s.title} className="explain-sec">
            <h4>{s.title}</h4>
            {s.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ))}
      </div>
      <div className="tutor-col chat">
        <div className="section-title">
          Ask the AI tutor <span className="muted small">Claude · {MODEL}</span>
        </div>
        <div className="key-row">
          <input
            type="password"
            placeholder="Anthropic API key (sk-ant-…)"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              try {
                localStorage.setItem(KEY_STORE, e.target.value);
              } catch {
                /* storage unavailable */
              }
            }}
          />
          <span className="muted small">Stored only in this browser; requests go directly to api.anthropic.com.</span>
        </div>
        <div className="chat-log" ref={scroller}>
          {chat.length === 0 && (
            <div className="suggest">
              {suggestions.map((s) => (
                <button key={s} onClick={() => ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.shown || (busy && i === chat.length - 1 ? 'Thinking…' : '')}
            </div>
          ))}
        </div>
        {err && <div className="issue error">{err}</div>}
        <div className="ask-row">
          <input
            placeholder="Ask about your circuit…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask(question)}
            disabled={busy}
          />
          <button className="primary" onClick={() => ask(question)} disabled={busy || !question.trim()}>
            {busy ? '…' : 'Ask'}
          </button>
          <button
            onClick={() => {
              apiHistory.current = [];
              setChat([]);
            }}
            disabled={busy}
            title="Start a new conversation"
          >
            New
          </button>
        </div>
      </div>
    </div>
  );
}
