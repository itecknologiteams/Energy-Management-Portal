import React, { useRef, useEffect } from 'react';
import { Chart, BarController, BarElement, LinearScale, CategoryScale, Tooltip } from 'chart.js';

// Register Chart.js components
Chart.register(BarController, BarElement, LinearScale, CategoryScale, Tooltip);

const GeneratorBarChart = ({ data, filter }) => {
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    if (chartInstance.current) {
      chartInstance.current.destroy();
      chartInstance.current = null;
    }

    const ctx = chartRef.current.getContext('2d');

    // Use API data only - no mock data
    const chartData = data || [];

    // Transform data for Chart.js
    const labels = chartData.map(d => d.name || d.vehicleName || 'Unknown');
    const values = chartData.map(d => d.fuelConsumed || d.fuelUsed || 0);

    // Generate colors based on values (higher = more concerning = amber)
    const colors = values.map(value => {
      const max = Math.max(...values);
      const ratio = value / max;
      // If using more than 70% of max fuel, show amber warning
      return ratio > 0.7 ? '#f59e0b' : '#ea580c';
    });

    const config = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Fuel Consumed (L)',
          data: values,
          backgroundColor: colors,
          borderRadius: 8,
          borderSkipped: false,
          barThickness: 32,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
              label: function(context) {
                return 'Fuel Used: ' + context.parsed.y.toLocaleString() + ' L';
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              display: false,
              drawBorder: false,
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11,
              },
              color: '#6b7280'
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: '#f3f4f6',
              drawBorder: false,
            },
            ticks: {
              font: {
                family: 'Inter',
                size: 11,
              },
              color: '#9ca3af',
              callback: function(value) {
                return value >= 1000 ? (value/1000).toFixed(1) + 'k' : value;
              }
            }
          }
        }
      }
    };

    chartInstance.current = new Chart(ctx, config);

    // Cleanup on unmount
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy();
      }
    };
  }, [data]); // Re-run when data changes

  const subtitle = filter === 'This Week' ? 'Consumption This Week'
    : filter === 'This Month' ? 'Consumption This Month'
    : 'Consumption Today';

  return (
    <div className="chart-card side-chart">
      <div className="card-header">
        <div className="card-title-section">
          <h3>Generator-wise Fuel</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="chart-container">
        <canvas ref={chartRef}></canvas>
      </div>
    </div>
  );
};

export default GeneratorBarChart;
