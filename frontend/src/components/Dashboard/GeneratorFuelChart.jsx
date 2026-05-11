import React, { useRef, useEffect, useState } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { getVehicleFuelSeries } from '../../services/api';

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler);

// Returns chronological array of YYYY-MM-DD strings between start and end (inclusive)
function datesInRange(start, end) {
  const dates = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    dates.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    );
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Returns true only for vehicles with a working fuel sensor:
//   - not using default fallback keys (no VehicleSensors rows)
//   - not in the backend exclusion list (configured but no physical probe)
//   - has at least one fuel key with a valid calibration curve
function hasCalibratedFuelSensor(v) {
  if (v.sensors?.isDefault) return false;
  if (v.sensors?.fuelChartExcluded) return false;
  const fuelKeys = new Set(v.sensors?.fuelKeys || []);
  if (fuelKeys.size === 0) return false;
  return Object.values(v.sensors?.byParam || {}).some(
    info => fuelKeys.has(info.sensorKey) &&
            Array.isArray(info.calibration) &&
            info.calibration.length >= 2
  );
}

const GeneratorFuelChart = ({ vehicles, selectedDate, filter, startDate, endDate }) => {
  const chartRef      = useRef(null);
  const chartInstance = useRef(null);

  const vehiclesWithFuel = (vehicles || []).filter(hasCalibratedFuelSensor);

  const [selectedGenerator, setSelectedGenerator] = useState(null);
  const [rangeStart, setRangeStart] = useState(selectedDate || endDate || '');
  const [rangeEnd,   setRangeEnd]   = useState(endDate || selectedDate || '');
  const [fuelData,   setFuelData]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [stats, setStats] = useState({ currentLevel: 0, maxLevel: 0, minLevel: 0, refuelAmount: 0 });

  // When filter / bound dates change, reset the picker to the full filter window
  useEffect(() => {
    const s = startDate || endDate || selectedDate || '';
    const e = endDate || selectedDate || '';
    setRangeStart(s);
    setRangeEnd(e);
  }, [filter, startDate, endDate, selectedDate]);

  // Default selected generator — pick first one with calibrated sensor
  useEffect(() => {
    if (vehiclesWithFuel.length > 0 && !selectedGenerator) {
      setSelectedGenerator(vehiclesWithFuel[0]);
    }
  }, [vehiclesWithFuel.length]);

  // Fetch fuel series for every day in [rangeStart, rangeEnd] in parallel
  useEffect(() => {
    const fetchSeries = async () => {
      if (!selectedGenerator || !rangeStart || !rangeEnd) return;

      try {
        setLoading(true);
        setError(null);
        setFuelData([]);

        const dates = datesInRange(rangeStart, rangeEnd);

        const results = await Promise.allSettled(
          dates.map(d => getVehicleFuelSeries(selectedGenerator.id, d))
        );

        const combined = results.flatMap(r => {
          if (r.status !== 'fulfilled') return [];
          return Array.isArray(r.value?.fuelSeries) ? r.value.fuelSeries : [];
        });

        // Sort chronologically
        combined.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        // Sum refuels from the backend's multi-layer detection (summary.totalRefueled),
        // not from raw rises — the backend already filters noise, recovery artefacts, etc.
        const refuelAmount = results.reduce((sum, r) => {
          if (r.status !== 'fulfilled') return sum;
          return sum + (r.value?.summary?.totalRefueled || 0);
        }, 0);

        if (combined.length > 0) {
          setFuelData(combined);

          const levels = combined.map(r => r.fuel || 0);
          const maxLevel = Math.max(...levels);
          const minLevel = Math.min(...levels);
          const currentLevel = levels[levels.length - 1] || 0;

          setStats({
            currentLevel,
            maxLevel,
            minLevel,
            refuelAmount: Math.round(refuelAmount * 100) / 100,
          });
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSeries();
  }, [selectedGenerator, rangeStart, rangeEnd]);

  // Build / rebuild chart whenever fuelData changes
  useEffect(() => {
    if (!chartRef.current) return;

    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }

    if (fuelData.length === 0) return;

    const ctx = chartRef.current.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 0, 350);
    gradient.addColorStop(0, 'rgba(234, 88, 12, 0.3)');
    gradient.addColorStop(1, 'rgba(234, 88, 12, 0.05)');

    const chartData = fuelData
      .filter(r => r && r.timestamp)
      .map(r => ({ x: new Date(r.timestamp).getTime(), y: r.fuel ?? 0 }));

    // Use 'hour' ticks for single-day view, 'day' ticks for multi-day
    const dayCount = datesInRange(rangeStart, rangeEnd).length;
    const timeUnit = dayCount <= 1 ? 'hour' : 'day';

    const config = {
      type: 'line',
      data: {
        datasets: [{
          label: 'Fuel Level (Liters)',
          data: chartData,
          borderColor: '#ea580c',
          backgroundColor: gradient,
          borderWidth: 2,
          fill: true,
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ea580c',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1f2937',
            padding: 12,
            titleFont: { family: 'Inter', size: 13, weight: '600' },
            bodyFont:  { family: 'Inter', size: 12 },
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: (ctx) => new Date(ctx[0].parsed.x).toLocaleString('en-US', {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
                timeZone: 'UTC',
              }),
              label: (ctx) => `Fuel: ${ctx.parsed.y.toFixed(2)} L`,
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: timeUnit,
              displayFormats: { hour: 'HH:mm', day: 'MMM d' },
            },
            grid:  { display: true, color: '#e5e7eb', drawBorder: false },
            ticks: { font: { family: 'Inter', size: 11 }, color: '#6b7280', maxRotation: 0 },
          },
          y: {
            beginAtZero: true,
            grid:  { color: '#e5e7eb', drawBorder: false },
            ticks: {
              font: { family: 'Inter', size: 11 },
              color: '#6b7280',
              callback: v => v + ' L',
            },
            title: {
              display: true,
              text: 'Fuel (Liters)',
              font: { family: 'Inter', size: 12 },
              color: '#6b7280',
            },
          },
        },
      },
    };

    chartInstance.current = new Chart(ctx, config);

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
        chartInstance.current = null;
      }
    };
  }, [fuelData]);

  const handleGeneratorChange = (e) => {
    const gen = vehiclesWithFuel.find(v => v.id === parseInt(e.target.value));
    setSelectedGenerator(gen || null);
  };

  // If no vehicle in this fleet has a fuel sensor, hide the chart entirely
  if (vehiclesWithFuel.length === 0) return null;

  // Subtitle: show date range
  const fmtShort = d => {
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return d; }
  };

  const subtitle = rangeStart && rangeEnd && rangeStart !== rangeEnd
    ? `${fmtShort(rangeStart)} – ${fmtShort(rangeEnd)}`
    : rangeStart ? fmtShort(rangeStart) : 'Fuel monitoring';

  // Constraint bounds from the active filter window
  const minDate = startDate || '';
  const maxDate = endDate   || selectedDate || '';

  return (
    <div className="chart-card generator-fuel-chart">
      {/* ── Header ── */}
      <div className="card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <div className="card-title-section">
          <h3>Fuel Level History</h3>
          <p>{subtitle}</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {/* Date range pickers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>From</label>
            <input
              type="date"
              value={rangeStart}
              min={minDate}
              max={rangeEnd || maxDate}
              onChange={e => setRangeStart(e.target.value)}
              disabled={loading}
              className="generator-select"
              style={{ padding: '6px 10px', fontSize: '13px', cursor: 'pointer' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, whiteSpace: 'nowrap' }}>To</label>
            <input
              type="date"
              value={rangeEnd}
              min={rangeStart || minDate}
              max={maxDate}
              onChange={e => setRangeEnd(e.target.value)}
              disabled={loading}
              className="generator-select"
              style={{ padding: '6px 10px', fontSize: '13px', cursor: 'pointer' }}
            />
          </div>

          {/* Generator selector — only fuel-sensor generators */}
          <select
            value={selectedGenerator?.id || ''}
            onChange={handleGeneratorChange}
            className="generator-select"
            disabled={loading}
          >
            {vehiclesWithFuel.map(v => (
              <option key={v.id} value={v.id}>{v.name || `Generator-${v.id}`}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Stats bar ── */}
      {selectedGenerator && fuelData.length > 0 && (
        <div className="fuel-stats-bar">
          <div className="stat-item">
            <span className="stat-label">Current</span>
            <span className="stat-value">{stats.currentLevel.toFixed(2)} L</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Peak</span>
            <span className="stat-value">{stats.maxLevel.toFixed(2)} L</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Low</span>
            <span className="stat-value">{stats.minLevel.toFixed(2)} L</span>
          </div>
          {stats.refuelAmount > 0 && (
            <div className="stat-item refuel">
              <span className="stat-label">Refueled</span>
              <span className="stat-value">+{stats.refuelAmount.toFixed(2)} L</span>
            </div>
          )}
        </div>
      )}

      {/* ── Chart area ── */}
      <div className="chart-container" style={{ height: '320px' }}>
        {loading ? (
          <div className="chart-loading">
            <i className="fas fa-circle-notch fa-spin"></i>
            <span>Loading fuel data…</span>
          </div>
        ) : error ? (
          <div className="chart-error">
            <i className="fas fa-exclamation-circle"></i>
            <span>{error}</span>
          </div>
        ) : fuelData.length === 0 ? (
          <div className="chart-empty">
            <i className="fas fa-chart-line"></i>
            <span>No fuel data for selected range</span>
            <small style={{ color: '#9ca3af', marginTop: '8px', fontSize: '12px' }}>
              {rangeStart} – {rangeEnd}
            </small>
          </div>
        ) : (
          <canvas ref={chartRef} />
        )}
      </div>
    </div>
  );
};

export default GeneratorFuelChart;
