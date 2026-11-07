import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { autoPlace, boardSize, CELL_MM, FOOTPRINTS, padPositions, Placement, routeBoard, RouteResult } from '../model/pcb';
import { buildNetlist } from '../engine/netlist';
import { DEFS } from '../model/library';
import { rotatePoint } from '../model/types';
import { download } from './Toolbar';

const S = 14; // px per cell
let cache: Map<string, Placement> = new Map();

export function PcbView() {
  const circuit = useStore((s) => s.circuit);
  const notify = useStore((s) => s.notify);
  const netlist = useMemo(() => buildNetlist(circuit), [circuit]);
  const [place, setPlace] = useState<Map<string, Placement>>(() => cache);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [autoRoute, setAutoRoute] = useState(true);
  const [showTop, setShowTop] = useState(true);
  const [showBottom, setShowBottom] = useState(true);
  const [showRats, setShowRats] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // keep placement in sync with the schematic's component set
  useEffect(() => {
    const ids = new Set(circuit.components.filter((c) => FOOTPRINTS[c.type]).map((c) => c.id));
    const missing = [...ids].some((id) => !place.has(id));
    const stale = [...place.keys()].some((id) => !ids.has(id));
    if (missing || stale) {
      if (place.size === 0 || [...ids].every((id) => !place.has(id))) setPlace(autoPlace(circuit));
      else {
        const auto = autoPlace(circuit);
        const next = new Map<string, Placement>();
        for (const id of ids) next.set(id, place.get(id) ?? auto.get(id)!);
        setPlace(next);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuit]);

  useEffect(() => {
    cache = place;
    if (autoRoute && !drag) setRoute(routeBoard(circuit, place));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, circuit, autoRoute]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      if (e.key.toLowerCase() === 'r' && sel) {
        e.stopPropagation();
        const p = place.get(sel);
        if (p) setPlace(new Map(place).set(sel, { ...p, rot: (p.rot + 90) % 360 }));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, place]);

  const pads = useMemo(() => padPositions(circuit, place), [circuit, place]);
  const { w, h } = boardSize(circuit, place);
  const placed = circuit.components.filter((c) => FOOTPRINTS[c.type] && place.has(c.id));

  // ratsnest: MST-ish chain per net for unrouted display
  const rats = useMemo(() => {
    if (route) return route.unrouted;
    const byNet = new Map<number, typeof pads>();
    for (const p of pads) byNet.set(p.net, [...(byNet.get(p.net) ?? []), p]);
    const lines: [{ x: number; y: number }, { x: number; y: number }, number][] = [];
    for (const [net, ps] of byNet) for (let i = 1; i < ps.length; i++) lines.push([ps[i - 1], ps[i], net]);
    return lines;
  }, [pads, route]);

  const toCell = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / S, y: (e.clientY - r.top) / S };
  };

  const traceLen = route ? route.traces.reduce((a, t) => a + t.points.slice(1).reduce((s, p, i) => s + Math.abs(p.x - t.points[i].x) + Math.abs(p.y - t.points[i].y), 0), 0) * CELL_MM : 0;
  const netCount = new Set(pads.map((p) => p.net)).size;

  const exportSvg = () => {
    if (!svgRef.current) return;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${svgRef.current.outerHTML.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')}`;
    download(`${circuit.name.replace(/[^\w-]+/g, '_')}_pcb.svg`, xml, 'image/svg+xml');
  };
  const exportBom = () => {
    const groups = new Map<string, string[]>();
    for (const c of placed) {
      const key = `${DEFS[c.type].name}|${DEFS[c.type].valueText(c)}|${FOOTPRINTS[c.type]!.name}`;
      groups.set(key, [...(groups.get(key) ?? []), c.label]);
    }
    const rows = ['Qty,References,Part,Value,Footprint'];
    for (const [k, refs] of groups) {
      const [part, value, fp] = k.split('|');
      rows.push(`${refs.length},"${refs.join(' ')}",${part},"${value}",${fp}`);
    }
    download(`${circuit.name.replace(/[^\w-]+/g, '_')}_bom.csv`, rows.join('\n'), 'text/csv');
  };

  return (
    <div className="pcb-wrap">
      <div className="pcb-toolbar">
        <button onClick={() => (setPlace(autoPlace(circuit)), notify('Footprints auto-placed from the schematic.', 'success'))}>Auto-place</button>
        <button onClick={() => setRoute(routeBoard(circuit, place))}>Route all</button>
        <button onClick={() => setRoute(null)}>Clear traces</button>
        <label>
          <input type="checkbox" checked={autoRoute} onChange={(e) => setAutoRoute(e.target.checked)} /> auto-route
        </label>
        <label>
          <input type="checkbox" checked={showTop} onChange={(e) => setShowTop(e.target.checked)} /> <span className="layer top">F.Cu</span>
        </label>
        <label>
          <input type="checkbox" checked={showBottom} onChange={(e) => setShowBottom(e.target.checked)} /> <span className="layer bottom">B.Cu</span>
        </label>
        <label>
          <input type="checkbox" checked={showRats} onChange={(e) => setShowRats(e.target.checked)} /> ratsnest
        </label>
        <span className="sep" />
        <button onClick={exportSvg}>Export SVG</button>
        <button onClick={exportBom}>Export BOM</button>
        <div className="tb-spacer" />
        <span className="mono small pcb-stats">
          {(w * CELL_MM).toFixed(1)} × {(h * CELL_MM).toFixed(1)} mm · {placed.length} parts · {netCount} nets
          {route && ` · ${traceLen.toFixed(0)} mm copper · ${route.vias.length} vias · `}
          {route && <b className={route.unrouted.length ? 'warn' : 'ok'}>{route.unrouted.length ? `${route.unrouted.length} unrouted` : 'fully routed'}</b>}
        </span>
      </div>
      {placed.length === 0 ? (
        <div className="empty-state static">
          <div className="empty-title">No footprints yet</div>
          <div>Build or load a circuit in the schematic view; each part gets a through-hole footprint here.</div>
        </div>
      ) : (
        <div className="pcb-scroll">
          <svg
            ref={svgRef}
            width={(w + 1) * S}
            height={(h + 1) * S}
            className="pcb"
            onPointerMove={(e) => {
              if (!drag) return;
              const c = toCell(e);
              const p = place.get(drag.id)!;
              const nx = Math.round(c.x - drag.ox);
              const ny = Math.round(c.y - drag.oy);
              if (nx !== p.x || ny !== p.y) setPlace(new Map(place).set(drag.id, { ...p, x: Math.max(2, nx), y: Math.max(2, ny) }));
            }}
            onPointerUp={() => {
              if (drag && autoRoute) setRoute(routeBoard(circuit, place));
              setDrag(null);
            }}
            onPointerDown={(e) => {
              if (!(e.target as Element).closest('[data-fp]')) setSel(null);
            }}
          >
            <rect x={S * 0.5} y={S * 0.5} width={w * S} height={h * S} rx={S * 0.6} className="board" />
            {[...Array(4)].map((_, i) => {
              const cx = i % 2 ? w - 1 : 2;
              const cy = i < 2 ? 2 : h - 1;
              return <circle key={i} cx={cx * S} cy={cy * S} r={S * 0.7} className="mount" />;
            })}
            {showBottom &&
              route?.traces
                .filter((t) => t.layer === 1)
                .map((t, i) => <polyline key={`b${i}`} points={t.points.map((p) => `${p.x * S},${p.y * S}`).join(' ')} className="trace bottom" />)}
            {showTop &&
              route?.traces
                .filter((t) => t.layer === 0)
                .map((t, i) => <polyline key={`t${i}`} points={t.points.map((p) => `${p.x * S},${p.y * S}`).join(' ')} className="trace top" />)}
            {route?.vias.map((v, i) => (
              <g key={`v${i}`}>
                <circle cx={v.x * S} cy={v.y * S} r={S * 0.36} className="via" />
                <circle cx={v.x * S} cy={v.y * S} r={S * 0.15} className="drill" />
              </g>
            ))}
            {placed.map((c) => {
              const fp = FOOTPRINTS[c.type]!;
              const p = place.get(c.id)!;
              const [bx, by, bw, bh] = fp.box;
              const r = rotatePoint({ x: 0, y: -1 }, p.rot);
              void r;
              return (
                <g
                  key={c.id}
                  data-fp={c.id}
                  transform={`translate(${p.x * S},${p.y * S}) rotate(${p.rot})`}
                  className={`fp ${sel === c.id ? 'sel' : ''}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                    const cc = toCell(e);
                    setSel(c.id);
                    setDrag({ id: c.id, ox: cc.x - p.x, oy: cc.y - p.y });
                  }}
                >
                  <rect x={bx * S} y={by * S} width={bw * S} height={bh * S} className="courtyard" />
                  {fp.shape === 'axial' && <rect x={(bx + 0.4) * S} y={(by + 0.3) * S} width={(bw - 0.8) * S} height={(bh - 0.6) * S} rx={S * 0.4} className="silk" />}
                  {fp.shape === 'radial' && <circle r={Math.min(bw, bh) * 0.48 * S} className="silk" />}
                  {fp.shape === 'to92' && <path d={`M ${-2.6 * S} ${0.9 * S} A ${2.8 * S} ${2.8 * S} 0 1 1 ${2.6 * S} ${0.9 * S} Z`} className="silk" />}
                  {(fp.shape === 'header' || fp.shape === 'switch' || fp.shape === 'box') && (
                    <rect x={(bx + 0.2) * S} y={(by + 0.2) * S} width={(bw - 0.4) * S} height={(bh - 0.4) * S} className="silk" />
                  )}
                  {(c.type === 'capacitor' || c.type === 'dcsource' || c.type === 'acsource' || c.type === 'battery') && (
                    <text x={(fp.pads[0].x - (p.rot ? 0 : 0.9)) * S} y={(fp.pads[0].y - 0.7) * S} className="silk-text" fontSize={S * 0.8}>
                      +
                    </text>
                  )}
                </g>
              );
            })}
            {pads.map((pd) => (
              <g key={`${pd.compId}:${pd.k}`} pointerEvents="none">
                {pd.k === 0 ? (
                  <rect x={(pd.x - 0.42) * S} y={(pd.y - 0.42) * S} width={0.84 * S} height={0.84 * S} className="pad" />
                ) : (
                  <circle cx={pd.x * S} cy={pd.y * S} r={0.44 * S} className="pad" />
                )}
                <circle cx={pd.x * S} cy={pd.y * S} r={0.17 * S} className="drill" />
                <title>{`${circuit.components.find((c) => c.id === pd.compId)?.label} pin ${pd.k + 1} · net ${netlist.netNames[pd.net]}`}</title>
              </g>
            ))}
            {placed.map((c) => {
              const p = place.get(c.id)!;
              const fp = FOOTPRINTS[c.type]!;
              const top = rotatePoint({ x: 0, y: fp.box[1] }, p.rot);
              return (
                <text key={`ref${c.id}`} x={(p.x + (p.rot % 180 ? fp.box[1] - 0.4 : 0)) * S} y={(p.y + (p.rot % 180 ? 0.3 : top.y - 0.35)) * S} className="ref" textAnchor="middle" fontSize={S * 0.75}>
                  {c.label}
                </text>
              );
            })}
            {showRats &&
              rats.map(([a, b], i) => <line key={`r${i}`} x1={a.x * S} y1={a.y * S} x2={b.x * S} y2={b.y * S} className="rats" />)}
          </svg>
        </div>
      )}
      <div className="pcb-hint muted small">
        Drag footprints to rearrange · select + <kbd>R</kbd> to rotate · red = top copper (F.Cu), blue = bottom copper (B.Cu) · 50 mil routing grid,
        through-hole parts.
      </div>
    </div>
  );
}
