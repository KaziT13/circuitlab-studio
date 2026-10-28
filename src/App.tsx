import { useEffect } from 'react';
import { useStore } from './state/store';
import { Toolbar, validateCircuit } from './components/Toolbar';
import { Library } from './components/Library';
import { Canvas, fitView } from './components/Canvas';
import { Properties } from './components/Properties';
import { BottomPanel } from './components/Analysis';
import { PcbView } from './components/Pcb';
import { pauseSim, runSim } from './state/runtime';

const AUTOSAVE = 'ohmlab.autosave.v1';

export function App() {
  const centerView = useStore((s) => s.centerView);
  const leftOpen = useStore((s) => s.leftOpen);
  const rightOpen = useStore((s) => s.rightOpen);
  const toast = useStore((s) => s.toast);
  const set = useStore((s) => s.set);

  // restore the last session, then autosave on change
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE);
      if (raw) {
        const c = validateCircuit(JSON.parse(raw));
        if (c.components.length) {
          useStore.setState({ circuit: c });
          requestAnimationFrame(fitView);
        }
      }
    } catch {
      /* ignore corrupt or unavailable storage */
    }
    if (window.innerWidth < 1000) set({ leftOpen: false, rightOpen: false });
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.circuit === prev.circuit) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(AUTOSAVE, JSON.stringify(s.circuit));
        } catch {
          /* storage unavailable */
        }
      }, 400);
    });
    return unsub;
  }, [set]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return;
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (s.simStatus === 'running') pauseSim();
        else runSim();
        return;
      }
      if (mod || e.altKey || s.centerView !== 'schematic') return;
      switch (e.key.toLowerCase()) {
        case 'r':
          s.rotateSelected();
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          s.deleteSelected();
          break;
        case 'w':
          s.set({ tool: 'wire' });
          break;
        case 's':
          s.set({ tool: 'select' });
          break;
        case 'p':
          s.set({ tool: 'probe' });
          break;
        case 'f':
          fitView();
          break;
        case 'escape':
          if (s.tool !== 'select') s.set({ tool: 'select' });
          else s.set({ selection: null });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className={`workspace ${leftOpen ? 'left-open' : ''} ${rightOpen ? 'right-open' : ''}`}>
        {leftOpen && <Library />}
        <main className="center">
          <div className="view-area">
            <button className="edge-toggle left" onClick={() => set({ leftOpen: !leftOpen })} title="Toggle component library">
              {leftOpen ? '‹' : '›'}
            </button>
            {centerView === 'schematic' ? <Canvas /> : <PcbView />}
            <button className="edge-toggle right" onClick={() => set({ rightOpen: !rightOpen })} title="Toggle properties panel">
              {rightOpen ? '›' : '‹'}
            </button>
          </div>
          <BottomPanel />
        </main>
        {rightOpen && <Properties />}
      </div>
      {toast && <div className={`toast ${toast.level}`}>{toast.text}</div>}
    </div>
  );
}
