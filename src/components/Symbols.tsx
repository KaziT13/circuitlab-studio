import { Component } from '../model/types';
import { LED_COLORS } from '../model/library';
import type { Reading } from '../engine/elements';

interface Props {
  c: Pick<Component, 'type' | 'props'>;
  reading?: Reading;
  /** largest |node voltage| in the circuit, used to normalise visual effects */
  vmax?: number;
  pressed?: boolean;
}

export { hitBoxOf as hitBox } from '../model/hitbox';

const Lead = ({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) => (
  <line x1={x1} y1={y1} x2={x2} y2={y2} />
);

export function Symbol({ c, reading, vmax = 1, pressed }: Props) {
  switch (c.type) {
    case 'resistor':
      return (
        <g>
          <Lead x1={-40} y1={0} x2={-24} y2={0} />
          <Lead x1={24} y1={0} x2={40} y2={0} />
          <polyline points="-24,0 -20,-8 -12,8 -4,-8 4,8 12,-8 20,8 24,0" />
          {reading?.extra?.ratingUse !== undefined && Number(reading.extra.ratingUse) > 1 && (
            <rect x={-26} y={-12} width={52} height={24} rx={4} className="sym-hot" />
          )}
        </g>
      );
    case 'capacitor': {
      const frac = reading ? Math.min(Math.abs(reading.v) / Math.max(vmax, 1e-9), 1) : 0;
      const pos = reading ? reading.v >= 0 : true;
      return (
        <g>
          <Lead x1={-40} y1={0} x2={-5} y2={0} />
          <Lead x1={5} y1={0} x2={40} y2={0} />
          {reading && frac > 0.01 && (
            <rect
              x={-4}
              y={14 - 28 * frac}
              width={8}
              height={28 * frac}
              className="cap-charge"
              fill={pos ? 'var(--green)' : 'var(--red)'}
            />
          )}
          <line x1={-5} y1={-15} x2={-5} y2={15} strokeWidth={2.4} />
          <line x1={5} y1={-15} x2={5} y2={15} strokeWidth={2.4} />
          {reading && frac > 0.05 && (
            <g className="sym-text" fontSize={8}>
              <text x={-12} y={-17}>{pos ? '+' : '−'}</text>
              <text x={8} y={-17}>{pos ? '−' : '+'}</text>
            </g>
          )}
        </g>
      );
    }
    case 'inductor': {
      const field = reading ? Math.min(Math.abs(reading.i) * 8, 1) : 0;
      return (
        <g>
          <Lead x1={-40} y1={0} x2={-24} y2={0} />
          <Lead x1={24} y1={0} x2={40} y2={0} />
          <path d="M-24,0 a6,6 0 0 1 12,0 a6,6 0 0 1 12,0 a6,6 0 0 1 12,0 a6,6 0 0 1 12,0" fill="none" />
          {field > 0.02 && (
            <ellipse cx={0} cy={-2} rx={30} ry={14} className="mag-field" style={{ opacity: 0.15 + 0.5 * field }} />
          )}
        </g>
      );
    }
    case 'dcsource':
      return (
        <g>
          <Lead x1={0} y1={-40} x2={0} y2={-18} />
          <Lead x1={0} y1={18} x2={0} y2={40} />
          <circle r={18} />
          <g className="sym-text" fontSize={13} textAnchor="middle">
            <text x={0} y={-3}>+</text>
            <text x={0} y={13}>−</text>
          </g>
        </g>
      );
    case 'acsource':
      return (
        <g>
          <Lead x1={0} y1={-40} x2={0} y2={-18} />
          <Lead x1={0} y1={18} x2={0} y2={40} />
          <circle r={18} />
          <path d="M-11,0 q5.5,-13 11,0 t11,0" fill="none" />
          <text x={7} y={-24} className="sym-text" fontSize={10}>
            +
          </text>
        </g>
      );
    case 'battery':
      return (
        <g>
          <Lead x1={0} y1={-40} x2={0} y2={-10} />
          <Lead x1={0} y1={10} x2={0} y2={40} />
          <line x1={-14} y1={-10} x2={14} y2={-10} strokeWidth={2} />
          <line x1={-7} y1={-4} x2={7} y2={-4} strokeWidth={4} />
          <line x1={-14} y1={4} x2={14} y2={4} strokeWidth={2} />
          <line x1={-7} y1={10} x2={7} y2={10} strokeWidth={4} />
          <text x={12} y={-16} className="sym-text" fontSize={10}>
            +
          </text>
        </g>
      );
    case 'ground':
      return (
        <g>
          <Lead x1={0} y1={-20} x2={0} y2={0} />
          <line x1={-12} y1={0} x2={12} y2={0} />
          <line x1={-7} y1={5} x2={7} y2={5} />
          <line x1={-2.5} y1={10} x2={2.5} y2={10} />
        </g>
      );
    case 'diode':
      return (
        <g>
          <Lead x1={-40} y1={0} x2={-10} y2={0} />
          <Lead x1={10} y1={0} x2={40} y2={0} />
          <path d="M-10,-10 L-10,10 L10,0 Z" className={reading && reading.i > 1e-4 ? 'diode-on' : ''} />
          <line x1={10} y1={-10} x2={10} y2={10} strokeWidth={2} />
        </g>
      );
    case 'led': {
      const col = LED_COLORS[String(c.props.color)]?.color ?? '#ff4d4d';
      const b = reading?.extra?.brightness !== undefined ? Number(reading.extra.brightness) : 0;
      return (
        <g>
          {b > 0.01 && <circle r={10 + 16 * Math.min(b, 1.4)} fill={col} className="glow" style={{ opacity: Math.min(0.15 + 0.6 * b, 0.85) }} />}
          <Lead x1={-40} y1={0} x2={-10} y2={0} />
          <Lead x1={10} y1={0} x2={40} y2={0} />
          <path d="M-10,-10 L-10,10 L10,0 Z" style={{ fill: b > 0.01 ? col : 'none', fillOpacity: Math.min(0.25 + b, 1) }} />
          <line x1={10} y1={-10} x2={10} y2={10} strokeWidth={2} />
          <g style={{ stroke: col }}>
            <path d="M0,-13 l7,-9 M3,-21 l4,-1 l-1,4" fill="none" strokeWidth={1.2} />
            <path d="M7,-11 l7,-9 M10,-19 l4,-1 l-1,4" fill="none" strokeWidth={1.2} />
          </g>
        </g>
      );
    }
    case 'switch': {
      const closed = !!c.props.closed;
      return (
        <g>
          <Lead x1={-40} y1={0} x2={-20} y2={0} />
          <Lead x1={20} y1={0} x2={40} y2={0} />
          <circle cx={-20} cy={0} r={2.5} className="dot" />
          <circle cx={20} cy={0} r={2.5} className="dot" />
          <line x1={-20} y1={0} x2={closed ? 20 : 15} y2={closed ? -1 : -15} strokeWidth={2} className={closed ? 'sw-closed' : 'sw-open'} />
        </g>
      );
    }
    case 'spdt': {
      const a = c.props.position !== 'B';
      return (
        <g>
          <Lead x1={-40} y1={-20} x2={-20} y2={-20} />
          <Lead x1={-40} y1={20} x2={-20} y2={20} />
          <Lead x1={20} y1={0} x2={40} y2={0} />
          <circle cx={-20} cy={-20} r={2.5} className="dot" />
          <circle cx={-20} cy={20} r={2.5} className="dot" />
          <circle cx={20} cy={0} r={2.5} className="dot" />
          <line x1={20} y1={0} x2={-19} y2={a ? -18 : 18} strokeWidth={2} className="sw-closed" />
          <g className="sym-text" fontSize={8}>
            <text x={-36} y={-25}>A</text>
            <text x={-36} y={33}>B</text>
          </g>
        </g>
      );
    }
    case 'pushbutton': {
      const y = pressed ? -2 : -11;
      return (
        <g>
          <Lead x1={-40} y1={0} x2={-20} y2={0} />
          <Lead x1={20} y1={0} x2={40} y2={0} />
          <circle cx={-20} cy={0} r={2.5} className="dot" />
          <circle cx={20} cy={0} r={2.5} className="dot" />
          <line x1={-22} y1={y} x2={22} y2={y} strokeWidth={2} className={pressed ? 'sw-closed' : ''} />
          <line x1={0} y1={y} x2={0} y2={y - 9} />
          <line x1={-6} y1={y - 9} x2={6} y2={y - 9} strokeWidth={2} />
        </g>
      );
    }
    case 'bulb': {
      const b = reading?.extra?.brightness !== undefined ? Number(reading.extra.brightness) : 0;
      return (
        <g>
          {b > 0.01 && <circle r={16 + 18 * Math.min(b, 1.5)} fill="#ffd36b" className="glow" style={{ opacity: Math.min(0.12 + 0.6 * b, 0.85) }} />}
          <Lead x1={-40} y1={0} x2={-16} y2={0} />
          <Lead x1={16} y1={0} x2={40} y2={0} />
          <circle r={16} style={{ fill: b > 0.01 ? `rgba(255,214,110,${Math.min(0.1 + b * 0.5, 0.7)})` : 'none' }} />
          <path d="M-16,0 L-6,0 q2,-10 6,0 q4,-10 6,0 L16,0" fill="none" />
        </g>
      );
    }
    case 'ammeter':
    case 'voltmeter':
      return (
        <g>
          <Lead x1={-40} y1={0} x2={-16} y2={0} />
          <Lead x1={16} y1={0} x2={40} y2={0} />
          <circle r={16} className="meter" />
          <text x={0} y={5} textAnchor="middle" className="sym-text meter-letter" fontSize={15}>
            {c.type === 'ammeter' ? 'A' : 'V'}
          </text>
          <text x={-28} y={-6} className="sym-text" fontSize={9}>
            +
          </text>
        </g>
      );
    case 'npn':
      return (
        <g>
          <circle cx={6} cy={0} r={22} />
          <Lead x1={-40} y1={0} x2={-6} y2={0} />
          <line x1={-6} y1={-14} x2={-6} y2={14} strokeWidth={2.6} />
          <polyline points="-6,-7 20,-24 20,-40" fill="none" />
          <polyline points="-6,7 20,24 20,40" fill="none" />
          <path d="M20,24 l-9.5,-1 l4.5,-7 Z" className="arrow" />
        </g>
      );
  }
}
