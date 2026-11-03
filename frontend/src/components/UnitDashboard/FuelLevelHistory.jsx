import React, { useEffect, useRef, useState } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Filler } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { Card } from './ui';
import { getVehicleFuelSeries, getVehicleSensorSeries } from '../../services/api';
import { formatTrackingTime } from '../../utils/unitData';

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Filler);

// Longest range fetched at once (one request per day)
const MAX_DAYS = 31;

// What the graph can show. `load` fetches one day; `key` picks the value.
// Decimals match the GPS server (litres and volts to 2, °C to 1).
const METRICS = {
  fuel: {
    label: 'Fuel', title: 'Fuel Level', unit: 'L', icon: 'fa-gas-pump', color: '#ea580c', rgb: '234, 88, 12',
    decimals: 2, axisDecimals: 0, minPad: 20,
    load: (id, d) => getVehicleFuelSeries(id, d).then((r) => r?.fuelSeries || []), key: 'fuel',
  },
  temperature: {
    label: 'Temperature', title: 'Temperature', unit: '°C', icon: 'fa-temperature-half', color: '#dc2626', rgb: '220, 38, 38',
    decimals: 1, axisDecimals: 0, minPad: 3,
    load: (id, d) => getVehicleSensorSeries(id, d).then((r) => r?.series || []), key: 'temperature',
  },
  battery: {
    label: 'Battery', title: 'Battery Voltage', unit: 'V', icon: 'fa-car-battery', color: '#2563eb', rgb: '37, 99, 235',
    decimals: 2, axisDecimals: 1, minPad: 0.5,
    load: (id, d) => getVehicleSensorSeries(id, d).then((r) => r?.series || []), key: 'battery',
  },
  gpsBattery: {
    label: 'GPS Battery', title: 'GPS Battery Voltage', unit: 'V', icon: 'fa-battery-three-quarters', color: '#16a34a', rgb: '22, 163, 74',
    decimals: 2, axisDecimals: 2, minPad: 0.1,
    load: (id, d) => getVehicleSensorSeries(id, d).then((r) => r?.series || []), key: 'gpsBattery',
  },
};

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDate(d); };

// Quick ranges beside the date pickers
const RANGES = [
  { id: 'today', label: 'Today', from: () => daysAgo(0), to: () => daysAgo(0) },
  { id: 'yesterday', label: 'Yesterday', from: () => daysAgo(1), to: () => daysAgo(1) },
  { id: 'week', label: 'Last 7 Days', from: () => daysAgo(6), to: () => daysAgo(0) },
];

function datesBetween(from, to) {
  const out = [];
  for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`) && out.length < MAX_DAYS; d.setDate(d.getDate() + 1)) {
    out.push(localDate(d));
  }
  return out;
}

// Chart.js formats axis times in the browser's zone; shift each PKT-as-UTC
// reading so the axis shows the PKT wall-clock time it represents.
const toAxisTime = (ts) => {
  const t = new Date(ts).getTime();
  return t + new Date(t).getTimezoneOffset() * 60000;
};

/**
 * One unit's history graph — fuel, temperature, battery or GPS battery —
 * over a chosen date range, with current / max / min.
 */
const FuelLevelHistory = ({ units, unit, onSelectUnit }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const today = localDate(new Date());
  const [metricId, setMetricId] = useState('fuel');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(false);
  const metric = METRICS[metricId];

  useEffect(() => {
    if (!unit?.id || !from || !to || from > to) return undefined;
    let cancelled = false;
    setLoading(true);
    Promise.allSettled(datesBetween(from, to).map((d) => metric.load(unit.id, d))).then((results) => {
      if (cancelled) return;
      const points = results
        .flatMap((r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []))
        .filter((p) => p && p.timestamp && Number.isFinite(p[metric.key]))
        .map((p) => ({ timestamp: p.timestamp, value: p[metric.key] }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setSeries(points);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [unit?.id, from, to, metric]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    chartRef.current?.destroy();
    if (series.length === 0) return undefined;
    const ctx = canvasRef.current.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, `rgba(${metric.rgb}, 0.22)`);
    gradient.addColorStop(1, `rgba(${metric.rgb}, 0.02)`);
    const values = series.map((p) => p.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = Math.max(metric.minPad, (hi - lo) * 0.5);
    const multiDay = from !== to;

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [{
          data: series.map((p) => ({ x: toAxisTime(p.timestamp), y: p.value, ts: p.timestamp })),
          borderColor: metric.color,
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: (items) => formatTrackingTime(items[0].raw.ts),
              label: (c) => `${metric.label}: ${c.parsed.y.toFixed(metric.decimals)} ${metric.unit}`,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: multiDay ? 'day' : 'hour', stepSize: multiDay ? 1 : 2, displayFormats: { hour: 'HH:mm', day: 'd MMM' } },
            grid: { color: '#f3f4f6' },
            ticks: { color: '#6b7280', font: { family: 'Inter', size: 11 }, maxRotation: 0 },
          },
          y: {
            suggestedMin: metricId === 'fuel' ? Math.max(0, lo - pad) : lo - pad,
            suggestedMax: hi + pad,
            grid: { color: '#f3f4f6' },
            ticks: {
              color: '#6b7280',
              font: { family: 'Inter', size: 11 },
              maxTicksLimit: 8,
              callback: (v) => `${Number(v).toFixed(metric.axisDecimals)} ${metric.unit}`,
            },
          },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [series, from, to, metric, metricId]);

  const values = series.map((p) => p.value);
  const fmt = (v) => (v === null ? '—' : `${v.toFixed(metric.decimals)} ${metric.unit}`);
  const current = values.length ? values[values.length - 1] : null;
  const max = values.length ? Math.max(...values) : null;
  const min = values.length ? Math.min(...values) : null;
  const rangeLabel = from === to ? 'Day' : 'Range';
  const activeRange = RANGES.find((r) => r.from() === from && r.to() === to)?.id;
  const field = 'h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100';

  return (
    <Card className="p-5">
      {/* Title and what to plot */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <i className={`fas ${metric.icon} text-lg`} style={{ color: metric.color }} aria-hidden="true"></i>
          <h3 className="text-[15px] font-bold text-gray-900">{metric.title} History – {unit?.name || '—'}</h3>
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm" role="group" aria-label="Graph data">
          {Object.entries(METRICS).map(([id, m]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMetricId(id)}
              aria-pressed={metricId === id}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                metricId === id ? 'bg-orange-600 text-white shadow' : 'text-gray-700 hover:bg-orange-50'
              }`}
            >
              <i className={`fas ${m.icon} text-xs`} aria-hidden="true"></i>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats, and the range / unit filters */}
      <div className="flex flex-wrap items-end justify-between gap-4 mt-3">
        <div className="flex gap-6">
          <div>
            <p className="text-[11px] text-gray-500">Current ({metric.unit})</p>
            <p className="text-lg font-bold text-gray-900">{fmt(current)}</p>
          </div>
          <div>
            <p className="text-[11px] text-gray-500">Max ({rangeLabel})</p>
            <p className="text-lg font-bold text-gray-900">{fmt(max)}</p>
          </div>
          <div>
            <p className="text-[11px] text-gray-500">Min ({rangeLabel})</p>
            <p className="text-lg font-bold text-gray-900">{fmt(min)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { setFrom(r.from()); setTo(r.to()); }}
                aria-pressed={activeRange === r.id}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                  activeRange === r.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">From
            <input type="date" className={field} value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">To
            <input type="date" className={field} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </label>
          <select className={`${field} font-medium`} value={unit?.id ?? ''} onChange={(e) => onSelectUnit(Number(e.target.value))} aria-label="Unit">
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>

      <div className="relative h-56 mt-3">
        <canvas ref={canvasRef} role="img" aria-label={`${metric.title} over the selected range`}></canvas>
        {!loading && series.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No {metric.label.toLowerCase()} readings for this range</p>
        )}
        {loading && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400 bg-white/60">
            <i className="fas fa-circle-notch fa-spin mr-2" aria-hidden="true"></i>Loading…
          </p>
        )}
      </div>
      {datesBetween(from, to).length >= MAX_DAYS && (
        <p className="text-[11px] text-gray-400 mt-1">Showing the first {MAX_DAYS} days of the range.</p>
      )}
    </Card>
  );
};

export default FuelLevelHistory;
