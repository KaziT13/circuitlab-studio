import { useState } from 'react';
import { DEFS, LIBRARY_ORDER } from '../model/library';
import { CompType } from '../model/types';
import { useStore } from '../state/store';
import { Symbol } from './Symbols';

export function SymbolIcon({ type, size = 44 }: { type: CompType; size?: number }) {
  const def = DEFS[type];
  const vertical = type === 'dcsource' || type === 'acsource' || type === 'battery';
  return (
    <svg width={size} height={size} viewBox="-46 -46 92 92" className="sym-icon">
      <g className="sym" transform={vertical ? 'rotate(90)' : type === 'ground' ? 'translate(0,8) scale(1.6)' : undefined}>
        <Symbol c={{ type, props: def.defaults }} />
      </g>
    </svg>
  );
}

export function Library() {
  const [q, setQ] = useState('');
  const view = useStore((s) => s.view);
  const addAtCenter = (type: CompType) => {
    const el = document.querySelector('.canvas') as SVGSVGElement | null;
    const r = el?.getBoundingClientRect();
    const cx = r ? r.width / 2 : 400;
    const cy = r ? r.height / 2 : 300;
    const jitter = (Math.random() - 0.5) * 80;
    useStore.getState().addComponent(type, { x: (cx - view.x) / view.zoom + jitter, y: (cy - view.y) / view.zoom + jitter });
  };
  const items = LIBRARY_ORDER.filter((t) => DEFS[t].name.toLowerCase().includes(q.toLowerCase()));
  const cats = [...new Set(items.map((t) => DEFS[t].category))];
  return (
    <aside className="panel library">
      <div className="panel-head">
        <span>Component Library</span>
      </div>
      <div className="lib-search">
        <input placeholder="Search components…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="lib-scroll">
        {cats.map((cat) => (
          <div key={cat} className="lib-cat">
            <div className="lib-cat-title">{cat}</div>
            <div className="lib-grid">
              {items
                .filter((t) => DEFS[t].category === cat)
                .map((t) => (
                  <button
                    key={t}
                    className="lib-item"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-comp', t);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => addAtCenter(t)}
                    title={`${DEFS[t].name} — drag onto the canvas or click to add`}
                  >
                    <SymbolIcon type={t} />
                    <span>{DEFS[t].name}</span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className="lib-help">
        <div><kbd>R</kbd> rotate · <kbd>Del</kbd> delete · <kbd>⌘/Ctrl D</kbd> duplicate</div>
        <div><kbd>W</kbd> wire · <kbd>P</kbd> probe · <kbd>S</kbd> select · <kbd>F</kbd> fit</div>
        <div><kbd>⌘/Ctrl Z</kbd> undo · <kbd>Space</kbd>+drag pan · wheel zoom</div>
      </div>
    </aside>
  );
}
