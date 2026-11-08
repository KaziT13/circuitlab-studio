# Ohmlab

A circuit simulator that runs entirely in the browser. You draw a schematic, and a Modified Nodal Analysis (MNA) solver computes DC, transient and AC results in real time.

Built with React 18, TypeScript, Vite, Zustand and uPlot.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Architecture](#architecture)
- [Simulation engine](#simulation-engine)
- [AI tutor](#ai-tutor)
- [Testing](#testing)
- [License](#license)

## Features

**Schematic editor**
- SVG canvas with pan, zoom, grid snapping and obstacle-aware orthogonal wire routing
- Undo/redo, duplicate, rotate, autosave to `localStorage`, and named saves
- Live visualisation: node voltages as wire colour, and animated dots showing the current flow

**Components**

| Category | Parts |
|---|---|
| Passive | Resistor, capacitor, inductor, light bulb |
| Sources | DC source, AC source, battery, ground |
| Semiconductors | Diode, LED (red, yellow, green, blue, white), NPN transistor |
| Switches | SPST switch, SPDT switch, push button |
| Instruments | Ammeter, voltmeter |

**Analysis panels**

| Panel | What it does |
|---|---|
| Oscilloscope / Graphs | Multi-channel probe traces with cursors and min/max/RMS stats |
| DC Operating Point | Node voltages and branch currents/power at the DC solution |
| AC Analysis | Single-frequency phasors and frequency sweeps (Bode magnitude/phase) |
| Ohm's Law Calculator | Ohm's law solver and RC/RL time-constant calculator |
| AI Tutor | Offline circuit explanation plus optional Claude-powered Q&A |
| SPICE Netlist | Export to SPICE, or import a SPICE netlist with automatic schematic layout |

**PCB view**: automatic footprint placement and a two-layer grid router.

**Topology checks**: shorted sources, voltage-source loops, floating components and unconnected pins are flagged before simulation.

**Examples**: series and parallel resistors, voltage divider, LED with current-limiting resistor, RC charging, RL circuit, series RLC resonance, bridge rectifier, transistor switch.

## Getting started

Requirements: Node.js 18 or newer.

```bash
npm install
npm run dev        # start the dev server at http://localhost:5173
```

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build the production bundle into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the test suite once (Vitest) |
| `npm run typecheck` | Type-check without building |

## Usage

1. Drag components from the library onto the canvas, or load one of the examples.
2. Switch to the wire tool (`W`) and connect the terminals.
3. Press **Run** (`Ctrl/Cmd + Enter`) to start the real-time simulation.
4. Place probes (`P`) to plot signals on the oscilloscope, and select a component to edit its values in the properties panel.

### Keyboard shortcuts

| Key | Action |
|---|---|
| `S` / `W` / `P` | Select, wire and probe tools |
| `R` | Rotate selection |
| `Delete` / `Backspace` | Delete selection |
| `F` | Fit circuit to view |
| `Esc` | Return to select tool, or clear the selection |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z`, `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + D` | Duplicate selection |
| `Ctrl/Cmd + Enter` | Run / pause simulation |

## Architecture

```
src/
├── model/        Data model: types, component library, units, examples, SPICE, PCB, routing
├── engine/       Netlist builder, device models, MNA simulator, linear algebra, explanations
├── state/        Zustand editor store, undo history, real-time simulation runtime
├── components/   React UI: canvas, symbols, panels, scope, PCB view, tutor
├── App.tsx       Layout, autosave, keyboard shortcuts
└── main.tsx      Entry point
```

| Layer | Files | Responsibility |
|---|---|---|
| Model | `model/types.ts`, `library.ts`, `units.ts` | Components, wires, parameters and terminal geometry. No rendering or physics. |
| Netlist | `engine/netlist.ts` | Merges connected terminals into nodes (union-find) and runs the topology checks. |
| Solver | `engine/elements.ts`, `simulator.ts`, `linalg.ts` | MNA stamping, nonlinear solving, transient integration and AC analysis. |
| Runtime | `state/runtime.ts` | Real-time stepping with `requestAnimationFrame`, waveform history, and per-segment wire currents. |
| UI | `components/*` | Schematic canvas, library, properties, oscilloscope, analysis panels, PCB view. |
| Interchange | `model/spice.ts`, `pcb.ts`, `router.ts` | SPICE import/export, PCB placement and routing, schematic wire routing. |

## Simulation engine

- **Formulation**: Modified Nodal Analysis, solved by dense Gaussian elimination with partial pivoting.
- **Nonlinear devices**: Newton–Raphson iteration with junction voltage limiting (`pnjlim`), and GMIN stepping as a fallback. Diodes and LEDs use the Shockley equation. The NPN transistor uses the Ebers–Moll model.
- **Transient**: capacitors and inductors use companion models with trapezoidal integration (backward Euler on the first step and after discontinuities).
- **AC**: complex phasor analysis, with nonlinear devices linearised at the DC operating point. Frequency sweeps are logarithmic.
- **Thevenin resistance**: computed from the terminals of any selected component.
- **Diagnostics**: a singular matrix is traced back to the node or component that caused it, and reported in plain language.

## AI tutor

- **Built-in explanation (offline).** Reads the solved circuit and describes the series/parallel structure, Ohm's-law checks, time constants, resonance and power conservation.
- **Ask the AI tutor (optional).** Sends the netlist and the simulation results to Claude (`claude-opus-5-5`) via the Anthropic SDK. You must supply your own API key. It is stored only in your browser's `localStorage`, and requests go directly from the browser to `api.anthropic.com`.

## Testing

```bash
npm test
```

The suite has 37 Vitest tests across `src/engine/engine.test.ts` and `src/model/model.test.ts`. They cover:

- DC solutions for resistor networks, the LED and the saturated transistor
- Transient behaviour: RC and RL time constants, RLC resonance, the bridge rectifier
- AC phasors and Thevenin resistance
- Clean topology for every bundled example
- Unit parsing, SPICE round-trips, PCB routing and wire routing

## License

MIT. See [LICENSE](LICENSE).
