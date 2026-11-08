import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { attachedWireEnds, useStore } from '../state/store';
import { CompType, GRID, pkey, Point, snap } from '@ohmlab/shared/model/types';
import { DEFS, terminalPositions } from '@ohmlab/shared/model/library';
import { buildNetlist, pointOnSegment } from '@ohmlab/shared/engine/netlist';
import { formatEng } from '@ohmlab/shared/model/units';
import { hitBox, Symbol } from './Symbols';
import { runtime } from '../state/runtime';
import { collectObstacles, smartRoute } from '@ohmlab/shared/model/router';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
  | { kind: 'comp'; id: string; ox: number; oy: number; attached: ReturnType<typeof attachedWireEnds>; moved: boolean; sx: number; sy: number }
  | { kind: 'branch'; from: Point; sx: number; sy: number; wireId: string }
  | null;

const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
function voltColor(v: number, vmax: number): string {
  const t = Math.min(Math.abs(v) / Math.max(vmax, 1e-9), 1);
  const base = [143, 160, 181];
  const pos = [61, 220, 132];
  const neg = [255, 107, 107];
  const target = v >= 0 ? pos : neg;
  return `rgb(${lerp(base[0], target[0], t)},${lerp(base[1], target[1], t)},${lerp(base[2], target[2], t)})`;
}

export function Canvas() {
  const circuit = useStore((s) => s.circuit);
  const view = useStore((s) => s.view);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const snapshot = useStore((s) => s.snapshot);
  const simStatus = useStore((s) => s.simStatus);
  const showVoltages = useStore((s) => s.showVoltages);
  const showCurrents = useStore((s) => s.showCurrents);
  const showVoltageColors = useStore((s) => s.showVoltageColors);
  const pressed = useStore((s) => s.pressed);
  const probes = useStore((s) => s.probes);
  const set = useStore((s) => s.set);

  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [draft, setDraft] = useState<Point[] | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [hoverTerm, setHoverTerm] = useState<string | null>(null);
  const spaceDown = useRef(false);
  /** return to the select tool after a wire started from a terminal in select mode */
  const revertTool = useRef(false);

  const netlist = useMemo(() => buildNetlist(circuit), [circuit]);
  const obstacles = useMemo(() => collectObstacles(circuit), [circuit]);
  const route = useCallback((a: Point, b: Point) => smartRoute(a, b, obstacles), [obstacles]);
  const live = simStatus !== 'stopped' && !!snapshot;
  const vmax = useMemo(() => (snapshot ? Math.max(1e-9, ...snapshot.nodeV.map(Math.abs)) : 1), [snapshot]);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
    },
    [view],
  );

  // wheel zoom (non-passive listener so we can preventDefault)
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view } = useStore.getState();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const zoom = Math.min(Math.max(view.zoom * factor, 0.2), 5);
        const mx = e.clientX - r.left;
        const my = e.clientY - r.top;
        useStore.getState().set({ view: { zoom, x: mx - ((mx - view.x) / view.zoom) * zoom, y: my - ((my - view.y) / view.zoom) * zoom } });
      } else {
        useStore.getState().set({ view: { ...view, x: view.x - e.deltaX } });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.code === 'Space') spaceDown.current = true;
      if (e.key === 'Escape') {
        setDraft(null);
        if (revertTool.current) {
          revertTool.current = false;
          useStore.getState().set({ tool: 'select' });
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    if (tool !== 'wire') setDraft(null);
  }, [tool]);

  const isConnectable = useCallback(
    (p: Point) => {
      for (const c of circuit.components) if (terminalPositions(c).some((t) => t.x === p.x && t.y === p.y)) return true;
      for (const w of circuit.wires)
        for (let i = 0; i + 1 < w.points.length; i++) if (pointOnSegment(p, w.points[i], w.points[i + 1])) return true;
      return false;
    },
    [circuit],
  );

  const finishDraft = (pts: Point[]) => {
    if (pts.length >= 2) useStore.getState().addWire(pts);
    setDraft(null);
    if (revertTool.current) {
      revertTool.current = false;
      set({ tool: 'select' });
    }
  };

  const draftClick = (q: Point) => {
    if (!draft) return;
    const last = draft[draft.length - 1];
    if (q.x === last.x && q.y === last.y) {
      finishDraft(draft);
      return;
    }
    const pts = [...draft, ...route(last, q)];
    if (isConnectable(q)) finishDraft(pts);
    else setDraft(pts);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    const sp = { x: snap(w.x), y: snap(w.y) };
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    const kind = target?.dataset.kind;
    const id = target?.dataset.id ?? '';
    (e.currentTarget as Element).setPointerCapture(e.pointerId);

    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: true });
      return;
    }
    if (e.button !== 0) return;

    if (draft) {
      if (kind === 'terminal') draftClick({ x: Number(target!.dataset.x), y: Number(target!.dataset.y) });
      else draftClick(sp);
      return;
    }
    if (tool === 'probe') {
      if (kind === 'probe') {
        useStore.getState().removeProbe(id);
        return;
      }
      const p = kind === 'terminal' ? { x: Number(target!.dataset.x), y: Number(target!.dataset.y) } : sp;
      if (isConnectable(p)) useStore.getState().addProbe(p);
      else useStore.getState().notify('Click on a wire or terminal to attach a scope probe.', 'warning');
      return;
    }
    if (kind === 'terminal') {
      setDraft([{ x: Number(target!.dataset.x), y: Number(target!.dataset.y) }]);
      if (tool === 'select') revertTool.current = true;
      set({ tool: 'wire' });
      return;
    }
    if (kind === 'comp') {
      const comp = circuit.components.find((c) => c.id === id)!;
      set({ selection: { kind: 'comp', id } });
      if (simStatus === 'running' && comp.type === 'pushbutton') useStore.getState().setPressed(id, true);
      setDrag({
        kind: 'comp',
        id,
        ox: w.x - comp.x,
        oy: w.y - comp.y,
        attached: attachedWireEnds(circuit, id),
        moved: false,
        sx: e.clientX,
        sy: e.clientY,
      });
      return;
    }
    if (kind === 'wire') {
      if (tool === 'wire') {
        setDraft([sp]);
        return;
      }
      set({ selection: { kind: 'wire', id } });
      setDrag({ kind: 'branch', from: sp, sx: e.clientX, sy: e.clientY, wireId: id });
      return;
    }
    if (kind === 'probe') return;
    if (tool === 'wire') {
      setDraft([sp]);
      return;
    }
    setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    setCursor({ x: snap(w.x), y: snap(w.y) });
    if (!drag) return;
    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      set({ view: { ...view, x: drag.vx + dx, y: drag.vy + dy } });
    } else if (drag.kind === 'comp') {
      if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 4) return;
      if (!drag.moved) {
        useStore.getState().pushHistory();
        drag.moved = true;
      }
      useStore.getState().moveComponent(drag.id, snap(w.x - drag.ox), snap(w.y - drag.oy), drag.attached);
    } else if (drag.kind === 'branch') {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6) {
        setDraft([drag.from]);
        revertTool.current = true;
        set({ tool: 'wire' });
        setDrag(null);
      }
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === 'pan' && !drag.moved) set({ selection: null });
    if (drag?.kind === 'comp') {
      const comp = circuit.components.find((c) => c.id === drag.id);
      if (comp?.type === 'pushbutton') useStore.getState().setPressed(drag.id, false);
      if (!drag.moved && comp && simStatus === 'running' && (comp.type === 'switch' || comp.type === 'spdt')) {
        useStore.getState().toggleSwitch(comp.id);
      }
    }
    setDrag(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (draft) {
      finishDraft(draft);
      return;
    }
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    if (target?.dataset.kind === 'comp') {
      const comp = circuit.components.find((c) => c.id === target.dataset.id);
      if (comp && (comp.type === 'switch' || comp.type === 'spdt') && simStatus !== 'running') useStore.getState().toggleSwitch(comp.id);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (draft) finishDraft(draft);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-comp') as CompType;
    if (!type || !DEFS[type]) return;
    const w = toWorld(e);
    useStore.getState().addComponent(type, w);
  };

  // ---------------------------------------------------------------- render data
  const segPhase = runtime.segPhase;
  const segCur = runtime.segCurrents;
  const curSegments = live && showCurrents && segCur.length === netlist.segments.length ? netlist.segments : [];

  const draftPreview = draft ? [...draft, ...route(draft[draft.length - 1], cursor)] : null;
  const g = GRID * view.zoom;

  return (
    <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={`canvas tool-${tool} ${drag?.kind === 'pan' && drag.moved ? 'panning' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        <defs>
          <pattern id="grid-minor" width={g} height={g} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <circle cx={0.5} cy={0.5} r={view.zoom > 0.6 ? 0.9 : 0.5} className="grid-dot" />
          </pattern>
          <pattern id="grid-major" width={g * 5} height={g * 5} patternUnits="userSpaceOnUse" x={view.x} y={view.y}>
            <path d={`M ${g * 5} 0 L 0 0 0 ${g * 5}`} className="grid-major" fill="none" />
          </pattern>
          <filter id="sel-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-minor)" />
        <rect width="100%" height="100%" fill="url(#grid-major)" />

        <g transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}>
          {/* wires */}
          {circuit.wires.map((w) => {
            const net = netlist.wireNet.get(w.id) ?? -1;
            const v = live && net >= 0 ? snapshot!.nodeV[net] ?? 0 : 0;
            const sel = selection?.kind === 'wire' && selection.id === w.id;
            const color = sel ? 'var(--accent)' : live && showVoltageColors && net >= 0 ? voltColor(v, vmax) : undefined;
            const pts = w.points.map((p) => `${p.x},${p.y}`).join(' ');
            return (
              <g key={w.id}>
                <polyline points={pts} className="wire-hit" data-kind="wire" data-id={w.id} />
                <polyline points={pts} className={`wire ${sel ? 'selected' : ''}`} style={color ? { stroke: color } : undefined} />
              </g>
            );
          })}

          {/* animated current dots */}
          {curSegments.map((s, i) =>
            Math.abs(segCur[i]) > 1e-7 ? (
              <line
                key={i}
                x1={s.a.x}
                y1={s.a.y}
                x2={s.b.x}
                y2={s.b.y}
                className="current-dots"
                style={{ strokeDashoffset: -segPhase[i] }}
              />
            ) : null,
          )}

          {netlist.junctions.map((p) => (
            <circle key={pkey(p)} cx={p.x} cy={p.y} r={3.2} className="junction" />
          ))}

          {/* components */}
          {circuit.components.map((c) => {
            const sel = selection?.kind === 'comp' && selection.id === c.id;
            const [hx, hy, hw, hh] = hitBox(c.type);
            const reading = live ? snapshot!.readings[c.id] : undefined;
            return (
              <g key={c.id} transform={`translate(${c.x},${c.y}) rotate(${c.rot})`} className={`comp ${sel ? 'selected' : ''}`}>
                {sel && <rect x={hx - 4} y={hy - 4} width={hw + 8} height={hh + 8} rx={6} className="sel-box" />}
                <g className="sym">
                  <Symbol c={c} reading={reading} vmax={vmax} pressed={!!pressed[c.id]} />
                </g>
                <rect x={hx} y={hy} width={hw} height={hh} className="hit" data-kind="comp" data-id={c.id} />
              </g>
            );
          })}

          {/* labels (kept upright) */}
          {circuit.components.map((c) => {
            if (c.type === 'ground') return null;
            const tp = terminalPositions(c);
            const vertical = Math.abs(tp[0].x - tp[tp.length - 1].x) < Math.abs(tp[0].y - tp[tp.length - 1].y);
            const reading = live ? snapshot!.readings[c.id] : undefined;
            const val = DEFS[c.type].valueText(c);
            let meas = '';
            if (reading) {
              if (c.type === 'voltmeter') meas = formatEng(reading.v, 'V');
              else if (c.type === 'ammeter') meas = formatEng(reading.i, 'A');
              else if (showCurrents && c.type !== 'spdt') meas = formatEng(Math.abs(reading.i), 'A');
            }
            const x = vertical ? c.x + 24 : c.x;
            const y = vertical ? c.y - 6 : c.y - 24;
            const anchor = vertical ? 'start' : 'middle';
            const isMeter = c.type === 'voltmeter' || c.type === 'ammeter';
            // horizontal parts: value and measurement share one line to keep dense layouts readable
            const inline = !vertical && !isMeter && !!val && !!meas;
            return (
              <g key={`l-${c.id}`} className="labels" pointerEvents="none">
                <text x={x} y={c.type === 'npn' ? c.y - 34 : y} textAnchor={anchor} className="lbl">
                  {c.label}
                </text>
                {val && (
                  <text x={x} y={vertical ? y + 13 : c.y + 32} textAnchor={anchor} className="val">
                    {val}
                    {inline && <tspan className="meas"> · {meas}</tspan>}
                  </text>
                )}
                {meas && !inline && (
                  <text x={x} y={vertical ? y + (val ? 26 : 13) : c.y + 32} textAnchor={anchor} className={isMeter ? 'meas meter-read' : 'meas'}>
                    {meas}
                  </text>
                )}
              </g>
            );
          })}

          {/* terminals */}
          {circuit.components.map((c) =>
            terminalPositions(c).map((p, k) => {
              const key = pkey(p);
              const connected = netlist.connectedTerminals.has(key);
              const hovered = hoverTerm === `${c.id}:${k}`;
              return (
                <g key={`${c.id}:${k}`}>
                  {(!connected || hovered || tool === 'wire') && (
                    <circle cx={p.x} cy={p.y} r={hovered ? 5.5 : 3.5} className={`terminal ${connected ? 'ok' : 'open'} ${hovered ? 'hover' : ''}`} />
                  )}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={8}
                    className="terminal-hit"
                    data-kind="terminal"
                    data-x={p.x}
                    data-y={p.y}
                    onPointerEnter={() => setHoverTerm(`${c.id}:${k}`)}
                    onPointerLeave={() => setHoverTerm(null)}
                  >
                    <title>{`${c.label} · ${DEFS[c.type].terminalNames[k]}`}</title>
                  </circle>
                </g>
              );
            }),
          )}

          {/* node voltage tags */}
          {live &&
            showVoltages &&
            netlist.netAnchor.map((p, i) =>
              p && i > 0 ? (
                <g key={`nv${i}`} transform={`translate(${p.x},${p.y})`} pointerEvents="none" className="node-tag">
                  {(() => {
                    const t = `${netlist.netNames[i]} ${formatEng(snapshot!.nodeV[i] ?? 0, 'V')}`;
                    return (
                      <>
                        <rect x={4} y={-17} width={t.length * 5.9 + 8} height={13} rx={3} />
                        <text x={8} y={-7}>
                          {t}
                        </text>
                      </>
                    );
                  })()}
                </g>
              ) : null,
            )}

          {/* scope probes */}
          {probes.map((p) => (
            <g key={p.id} transform={`translate(${p.x},${p.y})`} className="probe" data-kind="probe" data-id={p.id}>
              <line x1={0} y1={0} x2={10} y2={-18} stroke={p.color} strokeWidth={2} />
              <rect x={6} y={-32} width={30} height={15} rx={3} fill={p.color} />
              <text x={21} y={-21} textAnchor="middle" className="probe-text">
                {p.name}
              </text>
              <circle r={3.5} fill={p.color} />
            </g>
          ))}

          {/* wire draft */}
          {draftPreview && (
            <>
              <polyline points={draftPreview.map((p) => `${p.x},${p.y}`).join(' ')} className="wire-draft" />
              <circle cx={cursor.x} cy={cursor.y} r={4} className="draft-cursor" />
            </>
          )}
          {tool !== 'select' && !draft && <circle cx={cursor.x} cy={cursor.y} r={3} className="draft-cursor faint" />}
        </g>
      </svg>
      <CanvasHud netlistEmpty={circuit.components.length === 0} drafting={!!draft} />
    </div>
  );
}

function CanvasHud({ netlistEmpty, drafting }: { netlistEmpty: boolean; drafting: boolean }) {
  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const set = useStore((s) => s.set);
  const zoomBy = (f: number) => {
    const el = document.querySelector('.canvas') as SVGSVGElement;
    const r = el.getBoundingClientRect();
    const mx = r.width / 2;
    const my = r.height / 2;
    const zoom = Math.min(Math.max(view.zoom * f, 0.2), 5);
    set({ view: { zoom, x: mx - ((mx - view.x) / view.zoom) * zoom, y: my - ((my - view.y) / view.zoom) * zoom } });
  };
  return (
    <>
      <div className="hud tools">
        <button className={tool === 'select' ? 'on' : ''} onClick={() => set({ tool: 'select' })} title="Select / move (S)">
          <svg viewBox="0 0 16 16"><path d="M3 2 L3 13 L6 10 L8.5 14.5 L10.5 13.5 L8 9 L12 9 Z" /></svg>
        </button>
        <button className={tool === 'wire' ? 'on' : ''} onClick={() => set({ tool: 'wire' })} title="Draw wire (W)">
          <svg viewBox="0 0 16 16"><path d="M2 13 L2 8 L12 8 L12 3" fill="none" strokeWidth="1.6" /><circle cx="2" cy="13" r="1.6" /><circle cx="12" cy="3" r="1.6" /></svg>
        </button>
        <button className={tool === 'probe' ? 'on' : ''} onClick={() => set({ tool: 'probe' })} title="Oscilloscope probe (P)">
          <svg viewBox="0 0 16 16"><path d="M2 14 L6 10 M5 7 L9 11 L14 6 L10 2 Z" fill="none" strokeWidth="1.5" /></svg>
        </button>
      </div>
      <div className="hud zoom">
        <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out">−</button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
        <button onClick={() => fitView()} title="Fit circuit to view (F)">⤢</button>
      </div>
      {drafting && <div className="hud hint">Click to add corners · click a terminal/wire to connect · double-click or right-click to finish · Esc to cancel</div>}
      {!drafting && tool === 'probe' && <div className="hud hint">Click any wire or terminal to attach a scope probe · click a probe to remove it</div>}
      {netlistEmpty && (
        <div className="empty-state">
          <div className="empty-title">Empty workspace</div>
          <div>Drag components from the library, then click a terminal to start a wire.</div>
          <div className="muted">or load a prebuilt circuit from <b>Examples</b></div>
        </div>
      )}
    </>
  );
}

export function fitView() {
  const { circuit, set } = useStore.getState();
  const el = document.querySelector('.canvas') as SVGSVGElement | null;
  if (!el) return;
  const pts: Point[] = [];
  for (const c of circuit.components) pts.push({ x: c.x, y: c.y }, ...terminalPositions(c));
  for (const w of circuit.wires) pts.push(...w.points);
  if (!pts.length) return;
  const minX = Math.min(...pts.map((p) => p.x)) - 60;
  const maxX = Math.max(...pts.map((p) => p.x)) + 80;
  const minY = Math.min(...pts.map((p) => p.y)) - 60;
  const maxY = Math.max(...pts.map((p) => p.y)) + 60;
  const r = el.getBoundingClientRect();
  const zoom = Math.min(Math.max(Math.min(r.width / (maxX - minX), r.height / (maxY - minY)), 0.3), 2.2);
  set({ view: { zoom, x: r.width / 2 - ((minX + maxX) / 2) * zoom, y: r.height / 2 - ((minY + maxY) / 2) * zoom } });
}
