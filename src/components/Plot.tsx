import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatEng } from '../model/units';

export interface PlotSeries {
  label: string;
  color: string;
  unit: string;
  dash?: number[];
}

interface Props {
  x: ArrayLike<number>;
  ys: ArrayLike<number>[];
  series: PlotSeries[];
  xUnit: string;
  yUnit: string;
  height: number;
  logX?: boolean;
  yRange?: [number, number] | null;
  xRange?: [number, number] | null;
  syncKey?: string;
  title?: string;
}

const AXIS = '#8b93a1';
const GRID = 'rgba(255,255,255,0.06)';

export function Plot({ x, ys, series, xUnit, yUnit, height, logX, yRange, xRange, syncKey, title }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const ranges = useRef({ yRange, xRange });
  ranges.current = { yRange, xRange };
  const sig = series.map((s) => s.label + s.color).join('|') + `|${logX}|${yUnit}|${xUnit}|${height}|${title}`;

  useEffect(() => {
    const el = host.current!;
    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 200),
      height,
      title,
      legend: { show: true, live: true },
      cursor: syncKey ? { sync: { key: syncKey } } : {},
      scales: {
        x: {
          time: false,
          distr: logX ? 3 : 1,
          range: (_u, min, max) => (ranges.current.xRange ? ranges.current.xRange : [min, max === min ? min + 1e-9 : max]),
        },
        y: {
          range: (_u, min, max) => {
            if (ranges.current.yRange) return ranges.current.yRange;
            if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
            if (max - min < 1e-12) {
              const pad = Math.max(Math.abs(max) * 0.1, 1e-9);
              return [min - pad, max + pad];
            }
            const pad = (max - min) * 0.08;
            return [min - pad, max + pad];
          },
        },
      },
      axes: [
        {
          stroke: AXIS,
          grid: { stroke: GRID, width: 1 },
          ticks: { stroke: GRID },
          font: '11px JetBrains Mono, monospace',
          values: (_u, vals) => vals.map((v) => (v == null ? '' : formatEng(v, xUnit, 3))),
        },
        {
          stroke: AXIS,
          grid: { stroke: GRID, width: 1 },
          ticks: { stroke: GRID },
          size: 64,
          font: '11px JetBrains Mono, monospace',
          values: (_u, vals) => vals.map((v) => (v == null ? '' : formatEng(v, yUnit, 3))),
        },
      ],
      series: [
        { label: xUnit === 's' ? 'time' : 'f', value: (_u, v) => (v == null ? '—' : formatEng(v, xUnit, 4)) },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 1.6,
          dash: s.dash,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? '—' : formatEng(v, s.unit, 4)),
        })),
      ],
    };
    const data = [Array.from(x), ...ys.map((y) => Array.from(y))] as uPlot.AlignedData;
    plot.current = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() => {
      plot.current?.setSize({ width: Math.max(el.clientWidth, 200), height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => {
    if (!plot.current) return;
    plot.current.setData([Array.from(x), ...ys.map((y) => Array.from(y))] as uPlot.AlignedData);
  }, [x, ys, yRange, xRange]);

  return <div ref={host} className="plot-host" />;
}
