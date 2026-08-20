# Ohmlab

A browser-based circuit simulator built with React + TypeScript. You draw a schematic, and a real Modified Nodal Analysis (MNA) solver computes the results.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 37 engine/model tests (DC, transient, AC, SPICE, PCB, routing)
npm run build    # production bundle in dist/
```

## Architecture

| Layer | Files | Role |
|---|---|---|
| Data model | `src/model/types.ts`, `library.ts` | Components, wires and terminal geometry. No rendering or physics in here. |
| Netlist | `src/engine/netlist.ts` | Turns the geometry into nodes using union-find, then checks the topology: shorted sources, KVL loops, floating parts, unconnected pins. |
| Solver | `src/engine/elements.ts`, `simulator.ts`, `linalg.ts` | MNA stamps; Newton–Raphson with junction limiting for diodes, LEDs and the BJT (Ebers–Moll); trapezoidal and backward-Euler companion models for C and L; complex phasor AC; Thevenin resistance. |
| Runtime | `src/state/runtime.ts` | Real-time stepping in `requestAnimationFrame`, waveform history, and wire-segment current flow (spanning-tree KCL) for the animated dots. |
| UI | `src/components/*` | SVG schematic canvas, library, properties, oscilloscope (uPlot), DC/AC panels, calculator, tutor, SPICE, PCB. |
| Extras | `src/model/spice.ts`, `pcb.ts`, `router.ts` | SPICE import/export, PCB auto-place plus a 2-layer maze router, obstacle-aware wire routing. |

## AI tutor

The **built-in explanation** works offline. It reads the solved circuit and covers series/parallel structure, Ohm's-law checks, time constants, resonance and conservation checks.
**Ask the AI tutor** sends the netlist and results to Claude (`claude-opus-5-5`) through the Anthropic SDK. It uses an API key that you enter yourself. The key is stored only in your browser's localStorage, and requests go straight from the browser to api.anthropic.com.

## License

MIT. See [LICENSE](LICENSE).
