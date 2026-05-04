import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Chart, LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler } from 'chart.js';
import 'chartjs-adapter-date-fns';
import { getVehicleFuelSeries } from '../../services/api';

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend, Filler);

function buildDateList(start, end) {
  const dates = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    dates.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates.reverse(); // most recent first
}

const GeneratorFuelChart = ({ vehicles, selectedDate, filter, startDate, endDate }) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const [selectedGenerator, setSelectedGenerator] = useState(null);
  const [viewDate, setViewDate] = useState(selectedDate);
  const [fuelData, setFuelData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    currentLevel: 0,
    maxLevel: 0,
    minLevel: 0,
    refuelAmount: 0
  });

  // When filter or endDate changes, reset viewDate to the most recent day
  useEffect(() => {
    setViewDate(endDate || selectedDate);
  }, [filter, endDate, selectedDate]);

  // Build list of selectable dates for range filters
  const dateOptions = useMemo(() => {
    if (filter === 'Today' || !startDate || !endDate) return null;
    return buildDateList(startDate, endDate);
  }, [filter, startDate, endDate]);

  // Set default selected generator
  useEffect(() => {
    if (vehicles && vehicles.length > 0 && !selectedGenerator) {
      setSelectedGenerator(vehicles[0]);
    }
  }, [vehicles]);

  // Fetch fuel series data when generator or viewDate changes
  useEffect(() => {
    const fetchFuelSeries = async () => {
      if (!selectedGenerator || !viewDate) return;

      try {
        setLoading(true);
        setError(null);

        console.log('Fetching fuel series for generator:', selectedGenerator.id, 'date:', viewDate);
        const data = await getVehicleFuelSeries(selectedGenerator.id, viewDate);
        console.log('Fuel series API response:', data);

        let readings = [];
        if (data && Array.isArray(data.fuelSeries)) {
          readings = data.fuelSeries;
        } else if (Array.isArray(data)) {
          readings = data;
        }

        console.log('Processed readings:', readings.length, 'items');

        if (readings.length > 0) {
          setFuelData(readings);

          // Calculate statistics
          const fuelLevels = readings.map(r => r.fuel || 0);
          const maxLevel = Math.max(...fuelLevels);
          const minLevel = Math.min(...fuelLevels);
          const currentLevel = fuelLevels[fuelLevels.length - 1] || 0;

          // Detect refuel events (significant increases)
          let refuelAmount = 0;
          for (let i = 1; i < readings.length; i++) {
            const increase = (readings[i].fuel || 0) - (readings[i - 1].fuel || 0);
            if (increase > 5) { // Threshold for refuel detection
              refuelAmount += increase;
            }
          }

          setStats({
            currentLevel,
            maxLevel,
            minLevel,
            refuelAmount: Math.round(refuelAmount * 100) / 100
          });
        } else {
          setFuelData([]);
        }
      } catch (err) {
        console.error('Failed to fetch fuel series:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFuelSeries();
  }, [selectedGenerator, viewDate]);

  // Create/update chart
  useEffect(() => {
    if (!chartRef.current || fuelData.length === 0) return;

    const ctx = chartRef.current.getContext('2d');

    // Destroy previous chart
    if (chartInstance.current) {
      chartInstance.current.destroy();
    }

    // Create gradient for the area fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 350);
    gradient.addColorStop(0, 'rgba(234, 88, 12, 0.3)');
    gradient.addColorStop(1, 'rgba(234, 88, 12, 0.05)');

    // Process data for chart - handle different field names
    const chartData = fuelData
      .filter(reading => reading && (reading.timestamp || reading.time || reading.date))
      .map(reading => {
        const timestamp = reading.timestamp || reading.time || reading.date;
        const fuel = reading.fuel !== undefined ? reading.fuel : (reading.fuelLevel || reading.level || 0);
        return {
          x: new Date(timestamp).getTime(),
          y: fuel
        };
      });

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
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: '#1f2937',
            padding: 12,
            titleFont: {
              family: 'Inter',
              size: 13,
              weight: '600'
            },
            bodyFont: {
              family: 'Inter',
              size: 12
            },
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              title: function(context) {
                const date = new Date(context[0].parsed.x);
                return date.toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                });
              },
              label: function(context) {
                return `Fuel: ${context.parsed.y.toFixed(2)} Liters`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'hour',
              displayFormats: {
                hour: 'HH:mm',
                day: 'MMM dd'
              }
            },
            grid: {
              display: true,
              color: '#e5e7eb',
              drawBorder: false
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11
              },
              color: '#6b7280',
              maxRotation: 0
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: '#e5e7eb',
              drawBorder: false
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11
              },
              color: '#6b7280',
              callback: function(value) {
                return value + ' L';
              }
            },
            title: {
              display: true,
              text: 'Fuel (Liters)',
              font: {
                family: 'Inter',
                size: 12
              },
              color: '#6b7280'
            }
          }
        }
      }
    };

    chartInstance.current = new Chart(ctx, config);

    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [fuelData]);

  const handleGeneratorChange = (e) => {
    const generatorId = parseInt(e.target.value);
    const generator = vehicles.find(v => v.id === generatorId);
    setSelectedGenerator(generator);
  };

  const chartSubtitle = filter === 'Today'
    ? 'Real-time fuel monitoring'
    : `Fuel level for ${viewDate || ''}`;

  const fmtDateOption = (d) => {
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
    } catch { return d; }
  };

  return (
    <div className="chart-card generator-fuel-chart">
      <div className="card-header">
        <div className="card-title-section">
          <h3>Fuel Level History</h3>
          <p>{chartSubtitle}</p>
        </div>
        <div className="generator-selector">
          {dateOptions && (
            <select
              value={viewDate || ''}
              onChange={e => setViewDate(e.target.value)}
              className="generator-select"
              disabled={loading}
              style={{ marginRight: '8px' }}
            >
              {dateOptions.map(d => (
                <option key={d} value={d}>{fmtDateOption(d)}</option>
              ))}
            </select>
          )}
          <select
            value={selectedGenerator?.id || ''}
            onChange={handleGeneratorChange}
            className="generator-select"
            disabled={loading || !vehicles || vehicles.length === 0}
          >
            {vehicles && vehicles.map(vehicle => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.name || `Generator-${vehicle.id}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats Summary */}
      {selectedGenerator && (
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

      <div className="chart-container" style={{ height: '320px' }}>
        {loading ? (
          <div className="chart-loading">
            <i className="fas fa-circle-notch fa-spin"></i>
            <span>Loading fuel data...</span>
          </div>
        ) : error ? (
          <div className="chart-error">
            <i className="fas fa-exclamation-circle"></i>
            <span>{error}</span>
          </div>
        ) : fuelData.length === 0 ? (
          <div className="chart-empty">
            <i className="fas fa-chart-line"></i>
            <span>No fuel data available for this date</span>
            <small style={{ color: '#9ca3af', marginTop: '8px', fontSize: '12px' }}>
              Generator: {selectedGenerator?.id}, Date: {viewDate}
            </small>
          </div>
        ) : (
          <canvas ref={chartRef}></canvas>
        )}
      </div>
    </div>
  );
};

export default GeneratorFuelChart;
