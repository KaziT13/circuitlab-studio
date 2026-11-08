import { Circuit, Component, CompType, PropValue, Wire } from './types';
import { DEFS } from './library';

export const MAX_COMPONENTS = 2000;
export const MAX_WIRES = 5000;
const MAX_WIRE_POINTS = 500;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isProp = (v: unknown): v is PropValue => isNum(v) || typeof v === 'string' || typeof v === 'boolean';

/**
 * Check that untrusted JSON (a file, localStorage, or an HTTP body) is a circuit.
 * Returns a clean copy with default props filled in; throws with a readable message.
 */
export function validateCircuit(x: unknown): Circuit {
  if (!isObj(x) || !Array.isArray(x.components) || !Array.isArray(x.wires))
    throw new Error('Not an Ohmlab circuit (missing components/wires).');
  if (x.components.length > MAX_COMPONENTS) throw new Error(`Too many components (max ${MAX_COMPONENTS}).`);
  if (x.wires.length > MAX_WIRES) throw new Error(`Too many wires (max ${MAX_WIRES}).`);

  const components: Component[] = x.components.map((k, i) => {
    if (!isObj(k)) throw new Error(`Component #${i + 1} is not an object.`);
    const type = k.type as CompType;
    if (typeof type !== 'string' || !Object.hasOwn(DEFS, type)) throw new Error(`Unknown component type "${String(k.type)}".`);
    const label = typeof k.label === 'string' ? k.label : `${type}${i + 1}`;
    if (!isNum(k.x) || !isNum(k.y)) throw new Error(`Component ${label} has invalid coordinates.`);
    const props: Record<string, PropValue> = { ...DEFS[type].defaults };
    if (k.props !== undefined) {
      if (!isObj(k.props)) throw new Error(`Component ${label} has invalid props.`);
      for (const [key, v] of Object.entries(k.props)) {
        if (!isProp(v)) throw new Error(`Component ${label} has an invalid value for "${key}".`);
        props[key] = v;
      }
    }
    return {
      id: typeof k.id === 'string' && k.id ? k.id : `c${i + 1}`,
      type,
      x: k.x,
      y: k.y,
      rot: isNum(k.rot) ? k.rot : 0,
      label,
      props,
    };
  });

  const wires: Wire[] = x.wires.map((w, i) => {
    if (!isObj(w) || !Array.isArray(w.points)) throw new Error('A wire has no points.');
    if (w.points.length > MAX_WIRE_POINTS) throw new Error('A wire has too many points.');
    const points = w.points.map((p) => {
      if (!isObj(p) || !isNum(p.x) || !isNum(p.y)) throw new Error('A wire has an invalid point.');
      return { x: p.x, y: p.y };
    });
    return { id: typeof w.id === 'string' && w.id ? w.id : `w${i + 1}`, points };
  });

  const name = typeof x.name === 'string' && x.name.trim() ? x.name : 'Imported circuit';
  return { name, components, wires };
}
