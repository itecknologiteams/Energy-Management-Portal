import React, { useEffect, useRef, useState } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler } from 'chart.js';
import { Card, CardTitle } from './ui';
import { getVehicleAnalytics } from '../../services/api';
import { fmt1, fmt2 } from '../../utils/unitData';

// Writes each point's value above it; the latest one as a filled orange tag
const pointLabelsPlugin = {
  id: 'trendPointLabels',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0]?.data || [];
    const { ctx } = chart;
    ctx.save();
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    meta.data.forEach((pt, i) => {
      const v = data[i];
      if (v === null || v === undefined) return;
      const text = `${fmt1(v)} L`;
      const last = i === data.length - 1;
      if (last) {
        const w = ctx.measureText(text).width + 12;
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.roundRect(pt.x - w / 2, pt.y - 30, w, 20, 5);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, pt.x, pt.y - 16);
      } else {
        ctx.fillStyle = '#1f2937';
        ctx.fillText(text, pt.x, pt.y - 10);
      }
    });
    ctx.restore();
  },
};

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

const DAYS = 7;

function lastDays(n) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}

/**
 * The selected unit over the last 7 days: each day's closing fuel level,
 * with that day's consumption in the tooltip.
 */
const FuelTrendCard = ({ unit }) => {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [days, setDays] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!unit?.id) return undefined;
    let cancelled = false;
    setLoading(true);
    const dates = lastDays(DAYS);
    Promise.allSettled(dates.map((d) => getVehicleAnalytics(unit.id, d))).then((results) => {
      if (cancelled) return;
      setDays(dates.map((date, i) => {
        const a = results[i].status === 'fulfilled' ? results[i].value?.analytics : null;
        return { date, fuel: a?.fuel ?? null, used: a?.fuelConsumption ?? null };
      }));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [unit?.id]);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    chartRef.current?.destroy();
    const ctx = canvasRef.current.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, 'rgba(234, 88, 12, 0.28)');
    gradient.addColorStop(1, 'rgba(234, 88, 12, 0.02)');
    const values = days.map((d) => d.fuel);
    const known = values.filter((v) => v !== null);
    const lo = known.length ? Math.min(...known) : 0;
    const hi = known.length ? Math.max(...known) : 100;
    const pad = Math.max(20, (hi - lo) * 0.4);

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels: days.map((d) => new Date(`${d.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{
          data: values,
          borderColor: '#ea580c',
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.25,
          spanGaps: true,
          pointRadius: 4,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#ea580c',
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Room for the value tags, including the wider last one on the right edge
        layout: { padding: { top: 30, right: 34, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              label: (c) => {
                const d = days[c.dataIndex];
                return [`Fuel: ${fmt2(d.fuel)} L`, `Used: ${fmt1(d.used ?? 0)} L`];
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#374151', font: { family: 'Inter', size: 11 } } },
          y: {
            suggestedMin: Math.max(0, lo - pad),
            suggestedMax: hi + pad / 2,
            grid: { color: '#f3f4f6' },
            ticks: { color: '#6b7280', font: { family: 'Inter', size: 11 }, maxTicksLimit: 5, callback: (v) => `${Math.round(v)} L` },
          },
        },
      },
      plugins: [pointLabelsPlugin],
    });
    return () => chartRef.current?.destroy();
  }, [days]);

  const hasData = days.some((d) => d.fuel !== null);

  return (
    <Card className="p-5 h-full flex flex-col">
      <CardTitle icon="fa-gas-pump" title="Fuel Consumption Trend" subtitle={`Last ${DAYS} Days – ${unit?.name || '—'}`} />
      <div className="relative flex-1 min-h-[200px] mt-2">
        <canvas ref={canvasRef} aria-label="Daily closing fuel level, last 7 days" role="img"></canvas>
        {!loading && !hasData && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No fuel readings in the last {DAYS} days</p>
        )}
        {loading && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            <i className="fas fa-circle-notch fa-spin mr-2" aria-hidden="true"></i>Loading…
          </p>
        )}
      </div>
    </Card>
  );
};

export default FuelTrendCard;
