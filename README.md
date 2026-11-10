# Ohmlab

A circuit simulator for the browser. You draw a schematic, and a Modified Nodal Analysis (MNA) solver computes DC, transient and AC results in real time.

The project has three parts:

- **frontend:** the React app.
- **backend:** an Express API server that stores saved circuits, proxies the AI tutor and exposes the simulation engine over HTTP.
- **shared:** the circuit model and simulation engine, used by both.

Built with TypeScript, React 18, Vite, Zustand, uPlot, Express and the Anthropic SDK.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Architecture](#architecture)
- [Backend API](#backend-api)
- [Configuration](#configuration)
- [Simulation engine](#simulation-engine)
- [AI tutor](#ai-tutor)
- [Testing](#testing)
- [License](#license)

## Features

**Schematic editor**
- SVG canvas with pan, zoom, grid snapping and obstacle-aware orthogonal wire routing
- Undo/redo, duplicate, rotate, autosave to `localStorage`, and named saves stored on the server
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

Requirements: Node.js 20 or newer.

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional, enables the AI tutor
npm run dev                           # backend on :8787, frontend on http://localhost:5173
```

In development, Vite forwards `/api` requests to the backend, so the browser only talks to one origin.

To run it in production, build the frontend and start the backend. The backend serves the built app and the API from one port:

```bash
npm run build
npm start                             # http://localhost:8787
```

Root scripts (npm workspaces):

| Script | Purpose |
|---|---|
| `npm run dev` | Run the backend (with reload) and the Vite dev server together |
| `npm run build` | Type-check and build the frontend into `frontend/dist/` |
| `npm start` | Start the backend; it also serves `frontend/dist/` if that folder exists |
| `npm test` | Run the shared and backend test suites |
| `npm run typecheck` | Type-check all three packages |

To target one package, use `-w`, for example `npm run dev -w frontend` or `npm test -w backend`.

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
shared/                 @ohmlab/shared: pure TypeScript, no DOM or Node APIs
└── src/
    ├── model/          Types, component library, units, validation, examples, SPICE, PCB, routing
    └── engine/         Netlist builder, device models, MNA simulator, wire currents, explanations

backend/                @ohmlab/backend: Express API server
├── src/
│   ├── server.ts       Entry point: reads the environment, checks tutor credentials, listens
│   ├── app.ts          Express app: /api routes, and serves the built frontend
│   ├── storage.ts      Saved circuits in a JSON file (atomic, serialised writes)
│   └── routes/         circuits, simulate (DC/AC/transient/SPICE), tutor (Claude proxy over SSE)
└── test/               API tests

frontend/               @ohmlab/frontend: React + Vite app
└── src/
    ├── api.ts          Client for /api, including the tutor's SSE stream
    ├── state/          Zustand editor store, undo history, real-time simulation runtime
    ├── components/     Canvas, symbols, panels, oscilloscope, PCB view, tutor
    └── App.tsx         Layout, autosave, keyboard shortcuts
```

**What runs where:** the interactive simulation stays in the browser. The simulator steps every animation frame to drive the oscilloscope and current animation, so a network round trip per step would make it lag. The server handles what needs a server: persistent storage, the tutor's API key, and headless access to the same engine.

The frontend and backend import the shared package by subpath, for example `@ohmlab/shared/engine/simulator`. Vite compiles it for the browser, and `tsx` runs it on the server, so `shared/` has no separate build step.

| Layer | Files | Responsibility |
|---|---|---|
| Model | `shared/src/model/types.ts`, `library.ts`, `units.ts`, `validate.ts` | Components, wires, parameters, terminal geometry, and validation of untrusted circuit JSON |
| Netlist | `shared/src/engine/netlist.ts` | Merges connected terminals into nodes (union-find) and runs the topology checks |
| Solver | `shared/src/engine/elements.ts`, `simulator.ts`, `linalg.ts` | MNA stamping, nonlinear solving, transient integration and AC analysis |
| Interchange | `shared/src/model/spice.ts`, `pcb.ts`, `router.ts` | SPICE import/export, PCB placement and routing, schematic wire routing |
| API | `backend/src/routes/*` | Saved circuits, headless analysis and the tutor proxy |
| Runtime | `frontend/src/state/runtime.ts` | Real-time stepping with `requestAnimationFrame` and waveform history |
| UI | `frontend/src/components/*` | Schematic canvas, library, properties, oscilloscope, analysis panels, PCB view |

## Backend API

All endpoints are under `/api` and exchange JSON. Every circuit sent to the server is validated: unknown component types, non-numeric coordinates or props, and oversized circuits (more than 2,000 parts or 5,000 wires) are rejected with `400`.

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/health` | — | `{ ok: true }` |
| `GET` | `/circuits` | — | Saved circuits: `[{ name, parts, savedAt }]`, newest first |
| `GET` | `/circuits/:name` | — | `{ circuit, savedAt }`, or `404` |
| `PUT` | `/circuits/:name` | `{ circuit }` | Saves or overwrites the circuit; returns `{ circuit, savedAt }` |
| `DELETE` | `/circuits/:name` | — | `204`, or `404` |
| `POST` | `/simulate/dc` | `{ circuit, pressed? }` | `{ ok, netNames, nodeV, readings, issues }` |
| `POST` | `/simulate/ac` | `{ circuit, f0, f1, points?, probes }` | `{ ok, f, data: { [probe]: { mag, phase } } }` |
| `POST` | `/simulate/transient` | `{ circuit, tStop, h, pressed? }` | `{ ok, steps, netNames, t, nodeV }`, downsampled to about 2,000 points |
| `POST` | `/spice/export` | `{ circuit, tstop?, tstep? }` | SPICE netlist as `text/plain` |
| `POST` | `/spice/import` | `{ text }` | `{ circuit, warnings }` |
| `GET` | `/tutor` | — | `{ enabled, model }` |
| `POST` | `/tutor` | `{ messages }` | Server-Sent Events: `text` events with `{ text }`, then a `done` event with `{ content, stopReason }`, or an `error` event |

Notes:

- `pressed` lists the ids of push buttons held down.
- AC probes are `n:<netIndex>`, `v:<componentId>` or `i:<componentId>`.
- A transient run is limited to 100,000 steps (`tStop / h`).
- A circuit that cannot be solved returns `422` with `{ ok: false, error }`.

Example:

```bash
curl -s localhost:8787/api/simulate/dc -H 'Content-Type: application/json' \
  -d @my-circuit.json   # {"circuit": {...}}, e.g. from File → Export JSON
```

## Configuration

The backend reads these environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Port the backend listens on |
| `HOST` | `127.0.0.1` | Interface to bind. Set it to `0.0.0.0` to accept outside connections. |
| `OHMLAB_DATA_DIR` | `backend/data` | Directory for `circuits.json` |
| `ANTHROPIC_API_KEY` | — | Enables the AI tutor. An `ant auth login` profile also works. |
| `OHMLAB_TUTOR` | — | Set to `off` to disable the tutor even when credentials are present |
| `OHMLAB_BACKEND_URL` | `http://localhost:8787` | Frontend dev server only: where to proxy `/api` |

The API has no authentication. Anyone who can reach the server can read and change saved circuits, and use the tutor at your expense. The tutor is rate-limited to 20 requests per minute per IP. Bind to `127.0.0.1` (the default), or put the server behind an authenticating proxy before exposing it.

## Simulation engine

- **Formulation**: Modified Nodal Analysis, solved by dense Gaussian elimination with partial pivoting.
- **Nonlinear devices**: Newton–Raphson iteration with junction voltage limiting (`pnjlim`), and GMIN stepping as a fallback. Diodes and LEDs use the Shockley equation. The NPN transistor uses the Ebers–Moll model.
- **Transient**: capacitors and inductors use companion models with trapezoidal integration (backward Euler on the first step and after discontinuities).
- **AC**: complex phasor analysis, with nonlinear devices linearised at the DC operating point. Frequency sweeps are logarithmic.
- **Thevenin resistance**: computed from the terminals of any selected component.
- **Diagnostics**: a singular matrix is traced back to the node or component that caused it, and reported in plain language.

## AI tutor

- **Built-in explanation (offline).** Reads the solved circuit and describes the series/parallel structure, Ohm's-law checks, time constants, resonance and power conservation.
- **Ask the AI tutor (optional).** The browser sends your question, the netlist and the simulation results to the backend. The backend forwards them to Claude (`claude-opus-5-5`) using the server's credentials and streams the answer back. The API key never reaches the browser.
  - On startup the backend checks the credentials with a free Models API lookup. If none are found, the tutor is shown as disabled.
  - The server keeps no conversation state. The browser holds the history and resends it each turn, including Claude's thinking blocks unchanged.
  - Refusals fall back to another model automatically through the API's server-side `fallbacks` option.

## Testing

```bash
npm test
```

There are 51 Vitest tests.

**`shared`:** 37 tests in `src/engine/engine.test.ts` and `src/model/model.test.ts`, covering:

- DC solutions for resistor networks, the LED and the saturated transistor
- Transient behaviour: RC and RL time constants, RLC resonance, the bridge rectifier
- AC phasors and Thevenin resistance
- Clean topology for every bundled example
- Unit parsing, SPICE round-trips, PCB routing and wire routing

**`backend`:** 14 tests in `test/api.test.ts`. They start the real app on a random port with a temporary data directory and cover:

- Saving, listing, loading and deleting circuits
- Rejecting invalid input
- DC, AC and transient endpoints, including the step limit
- SPICE export and import
- The tutor's SSE stream format, using a stub client so no real API calls are made

## License

MIT. See [LICENSE](LICENSE).
