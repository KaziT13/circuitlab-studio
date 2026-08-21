// Engineering-notation parsing and formatting.

const PREFIXES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

const SUFFIX: Record<string, number> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  M: 1e6,
  k: 1e3,
  K: 1e3,
  m: 1e-3,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

/** Parse strings like "4.7k", "10u", "1meg", "2.2 mH", "100nF", "1e-3". Returns NaN when invalid. */
export function parseEng(input: string): number {
  const s = input.trim().replace(/,/g, '');
  if (!s) return NaN;
  const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(meg|[TGMkKmuµμnpf])?\s*([a-zA-ZΩ°%]*)$/);
  if (!m) return NaN;
  const base = parseFloat(m[1]);
  let mult = 1;
  if (m[2]) {
    const key = m[2] === 'meg' ? 'meg' : m[2];
    // Treat a trailing lone "M" as mega, lone "m" as milli (SPICE-like but case sensitive).
    mult = SUFFIX[key] ?? (SUFFIX[key.toLowerCase()] ?? 1);
  }
  return base * mult;
}

export function formatEng(value: number, unit = '', digits = 3): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return (value > 0 ? '∞' : '-∞') + (unit ? ' ' + unit : '');
  if (value === 0) return `0${unit ? ' ' + unit : ''}`;
  const abs = Math.abs(value);
  for (const [scale, prefix] of PREFIXES) {
    if (abs >= scale * 0.9995) {
      const scaled = value / scale;
      return `${trimNum(scaled, digits)} ${prefix}${unit}`.trim();
    }
  }
  const [scale, prefix] = PREFIXES[PREFIXES.length - 1];
  return `${trimNum(value / scale, digits)} ${prefix}${unit}`.trim();
}

function trimNum(v: number, digits: number): string {
  const a = Math.abs(v);
  let d = digits;
  if (a >= 100) d = Math.max(0, digits - 3);
  else if (a >= 10) d = Math.max(0, digits - 2);
  else d = Math.max(0, digits - 1);
  return parseFloat(v.toFixed(d)).toString();
}

/** Compact value text for drawing next to symbols ("4.7kΩ"). */
export function shortEng(value: number, unit = ''): string {
  return formatEng(value, unit, 3).replace(' ', '');
}
