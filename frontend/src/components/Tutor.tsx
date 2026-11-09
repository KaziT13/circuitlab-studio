import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Simulator } from '@ohmlab/shared/engine/simulator';
import { explainCircuit } from '@ohmlab/shared/engine/explain';
import { exportSpice } from '@ohmlab/shared/model/spice';
import { EXAMPLES } from '@ohmlab/shared/model/examples';
import { runtime } from '../state/runtime';
import { api, streamTutor, TutorMessage } from '../api';

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

  const [tutor, setTutor] = useState<{ enabled: boolean; model: string } | null>(null);
  useEffect(() => {
    api.tutorStatus().then(setTutor, () => setTutor({ enabled: false, model: '' }));
  }, []);
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const apiHistory = useRef<TutorMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
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
    if (!tutor?.enabled) {
      setErr('The AI tutor is not available: the server has no Anthropic API key (the built-in analysis on the left still works).');
      return;
    }
    setErr('');
    setBusy(true);
    setQuestion('');
    const userMsg: TutorMessage = { role: 'user', content: `${context()}\n\nQuestion: ${text}` };
    const messages = [...apiHistory.current, userMsg];
    setChat((c) => [...c, { role: 'user', shown: text }, { role: 'assistant', shown: '' }]);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const final = await streamTutor(messages, {
        signal: ctl.signal,
        onText: (delta) => {
          setChat((c) => {
            const next = [...c];
            next[next.length - 1] = { role: 'assistant', shown: next[next.length - 1].shown + delta };
            return next;
          });
          scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
        },
      });
      if (final.stopReason === 'refusal') {
        setChat((c) => {
          const next = [...c];
          next[next.length - 1] = { role: 'assistant', shown: next[next.length - 1].shown + '\n\n[The tutor declined to answer this question.]' };
          return next;
        });
      }
      // keep the full assistant content (including thinking blocks) so history stays append-only
      apiHistory.current = [...messages, { role: 'assistant', content: final.content }];
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
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
          Ask the AI tutor <span className="muted small">Claude{tutor?.model ? ` · ${tutor.model}` : ''}</span>
        </div>
        {tutor && !tutor.enabled && (
          <div className="muted small">The AI tutor is off: start the server with ANTHROPIC_API_KEY set to enable it.</div>
        )}
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
              abort.current?.abort();
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
