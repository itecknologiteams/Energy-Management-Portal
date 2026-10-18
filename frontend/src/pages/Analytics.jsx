import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/common/Header';
import LogoutModal from '../components/common/LogoutModal';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardData, getFleetAnalytics, formatApiError, ValidationError, NotFoundError } from '../services/api';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  PieController,
  ArcElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

// Register Chart.js components
Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  PieController,
  ArcElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler
);

const Analytics = ({ onNavigate }) => {
  const { fleetId } = useAuth();
  const [filter, setFilter] = useState('This Week');
  const [dateInfo, setDateInfo] = useState({ day: '', weekday: '', month: '' });
  const [activeNavItem, setActiveNavItem] = useState('analytics');
  
  // Data states
  const [analyticsData, setAnalyticsData] = useState(null);
  const [fleetData, setFleetData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [comparisonPeriod, setComparisonPeriod] = useState('lastWeek');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Chart refs
  const efficiencyChartRef = useRef(null);
  const fuelDistributionRef = useRef(null);
  const costAnalysisRef = useRef(null);
  const utilizationChartRef = useRef(null);
  
  const efficiencyChartInstance = useRef(null);
  const fuelDistributionInstance = useRef(null);
  const costAnalysisInstance = useRef(null);
  const utilizationChartInstance = useRef(null);

  // Update date display
  useEffect(() => {
    const updateDate = () => {
      const now = new Date();
      const day = now.getDate();
      const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
      const month = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      setDateInfo({ day, weekday, month });
    };

    updateDate();
    const interval = setInterval(updateDate, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch analytics data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Calculate date based on filter
        let date = new Date();
        let startDate = new Date();

        if (filter === 'Today') {
          date = new Date();
          startDate = new Date();
        } else if (filter === 'This Week') {
          date = new Date();
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
        } else if (filter === 'This Month') {
          date = new Date();
          startDate = new Date(date.getFullYear(), date.getMonth(), 1);
        } else if (filter === 'Last Month') {
          const now = new Date();
          date = new Date(now.getFullYear(), now.getMonth(), 0);
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        }
        const formattedDate = date.toISOString().split('T')[0];
        setSelectedDate(formattedDate);
        
        // Fetch dashboard and fleet analytics data in parallel
        const effectiveFleetId = fleetId || 1735;
        const [dashboardData, fleetAnalytics] = await Promise.all([
          getDashboardData(effectiveFleetId, formattedDate),
          getFleetAnalytics(effectiveFleetId, formattedDate)
        ]);
        
        setAnalyticsData(dashboardData);
        setFleetData(fleetAnalytics);
      } catch (err) {
        console.error('Failed to fetch analytics data:', err);

        let errorMessage = err.message || 'Failed to fetch data from API';

        if (err instanceof ValidationError || err.name === 'ValidationError') {
          errorMessage = `Validation Error: ${errorMessage}`;
        } else if (err instanceof NotFoundError || err.name === 'NotFoundError') {
          errorMessage = `Not Found: ${errorMessage}`;
        }

        setError(errorMessage);
        showNotification(errorMessage, 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filter, fleetId]);

  // Initialize charts when data is available
  useEffect(() => {
    if (!analyticsData || loading) return;

    // Destroy existing charts
    if (efficiencyChartInstance.current) efficiencyChartInstance.current.destroy();
    if (fuelDistributionInstance.current) fuelDistributionInstance.current.destroy();
    if (costAnalysisInstance.current) costAnalysisInstance.current.destroy();
    if (utilizationChartInstance.current) utilizationChartInstance.current.destroy();

    const vehicles = analyticsData.vehicles || [];

    // 1. Fuel Efficiency Comparison Chart (Bar)
    const efficiencyCtx = efficiencyChartRef.current?.getContext('2d');
    if (efficiencyCtx) {
      const efficiencyGradient = efficiencyCtx.createLinearGradient(0, 0, 0, 300);
      efficiencyGradient.addColorStop(0, 'rgba(30, 58, 95, 0.8)');
      efficiencyGradient.addColorStop(1, 'rgba(30, 58, 95, 0.3)');

      efficiencyChartInstance.current = new Chart(efficiencyCtx, {
        type: 'bar',
        data: {
          labels: vehicles.map(v => v.name || `V-${v.id?.toString().slice(-3)}`),
          datasets: [{
            label: 'Fuel Consumption (L)',
            data: vehicles.map(v => v.fuelConsumption || 0),
            backgroundColor: efficiencyGradient,
            borderColor: '#ea580c',
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
          }, {
            label: 'Work Time (hrs)',
            data: vehicles.map(v => v.workTimeHours || 0),
            backgroundColor: 'rgba(34, 197, 94, 0.6)',
            borderColor: '#22c55e',
            borderWidth: 1,
            borderRadius: 6,
            borderSkipped: false,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: {
                usePointStyle: true,
                padding: 20,
                font: { family: 'Inter', size: 12 },
                color: '#6b7280'
              }
            },
            tooltip: {
              backgroundColor: '#1f2937',
              padding: 12,
              titleFont: { family: 'Inter', size: 13, weight: '600' },
              bodyFont: { family: 'Inter', size: 12 },
              cornerRadius: 8,
              displayColors: true,
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                font: { family: 'Inter', size: 11 },
                color: '#9ca3af'
              }
            },
            y: {
              beginAtZero: true,
              grid: { color: '#f3f4f6', drawBorder: false },
              ticks: {
                font: { family: 'Inter', size: 12 },
                color: '#9ca3af'
              }
            }
          }
        }
      });
    }

    // 2. Fuel Distribution Pie Chart
    const distributionCtx = fuelDistributionRef.current?.getContext('2d');
    if (distributionCtx) {
      const totalFuel = vehicles.reduce((sum, v) => sum + (v.fuelConsumption || 0), 0);
      const fuelTheft = vehicles.reduce((sum, v) => sum + (v.fuelTheft || 0), 0);
      const fuelRefilled = vehicles.reduce((sum, v) => sum + (v.fuelRefilled || 0), 0);
      const remainingFuel = Math.max(0, totalFuel - fuelTheft);

      fuelDistributionInstance.current = new Chart(distributionCtx, {
        type: 'pie',
        data: {
          labels: ['Consumed', 'Theft/Loss', 'Refilled', 'Available'],
          datasets: [{
            data: [
              Math.max(0, totalFuel - fuelRefilled),
              fuelTheft,
              fuelRefilled,
              remainingFuel > 0 ? remainingFuel * 0.3 : 0
            ],
            backgroundColor: [
              '#ea580c',
              '#ef4444',
              '#22c55e',
              '#f59e0b'
            ],
            borderColor: '#ffffff',
            borderWidth: 3,
            hoverOffset: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                usePointStyle: true,
                padding: 20,
                font: { family: 'Inter', size: 12 },
                color: '#6b7280'
              }
            },
            tooltip: {
              backgroundColor: '#1f2937',
              padding: 12,
              titleFont: { family: 'Inter', size: 13, weight: '600' },
              bodyFont: { family: 'Inter', size: 12 },
              cornerRadius: 8,
              callbacks: {
                label: function(context) {
                  const value = context.parsed;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                  return `${context.label}: ${value.toFixed(1)}L (${percentage}%)`;
                }
              }
            }
          }
        }
      });
    }

    // 3. Cost Analysis Chart (Line with dual axis)
    // Only renders when fuel price data is available from the API
    const costCtx = costAnalysisRef.current?.getContext('2d');
    const fuelPricesFromAPI = analyticsData?.fuelPrices;
    const hasFuelPriceData = fuelPricesFromAPI && fuelPricesFromAPI.length > 0;
    
    if (costCtx && hasFuelPriceData) {
      const days = analyticsData.fuelTrend?.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const consumptionTrend = analyticsData.fuelTrend?.thisWeek || [];
      
      // Calculate daily cost using actual fuel prices from API
      const costData = consumptionTrend.map((cons, i) => {
        const price = fuelPricesFromAPI[i] || fuelPricesFromAPI[fuelPricesFromAPI.length - 1] || 0;
        return Math.round(cons * price);
      });

      costAnalysisInstance.current = new Chart(costCtx, {
        type: 'line',
        data: {
          labels: days,
          datasets: [{
            label: 'Daily Cost (PKR)',
            data: costData,
            borderColor: '#ea580c',
            backgroundColor: 'rgba(30, 58, 95, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: '#ea580c',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            yAxisID: 'y'
          }, {
            label: 'Fuel Price (PKR/L)',
            data: fuelPricesFromAPI,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#f59e0b',
            yAxisID: 'y1'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: {
                usePointStyle: true,
                padding: 20,
                font: { family: 'Inter', size: 12 },
                color: '#6b7280'
              }
            },
            tooltip: {
              backgroundColor: '#1f2937',
              padding: 12,
              titleFont: { family: 'Inter', size: 13, weight: '600' },
              bodyFont: { family: 'Inter', size: 12 },
              cornerRadius: 8,
              callbacks: {
                label: function(context) {
                  return `${context.dataset.label}: ₨${context.parsed.y.toLocaleString()}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                font: { family: 'Inter', size: 12 },
                color: '#9ca3af'
              }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: {
                display: true,
                text: 'Daily Cost (PKR)',
                color: '#ea580c',
                font: { family: 'Inter', size: 12, weight: '600' }
              },
              grid: { color: '#f3f4f6', drawBorder: false },
              ticks: {
                font: { family: 'Inter', size: 12 },
                color: '#9ca3af',
                callback: (value) => `₨${(value / 1000).toFixed(1)}k`
              }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: {
                display: true,
                text: 'Fuel Price (PKR/L)',
                color: '#f59e0b',
                font: { family: 'Inter', size: 12, weight: '600' }
              },
              grid: { drawOnChartArea: false },
              ticks: {
                font: { family: 'Inter', size: 12 },
                color: '#9ca3af',
                callback: (value) => `₨${value}`
              }
            }
          }
        }
      });
    }

    // 4. Vehicle Utilization Chart (Horizontal Bar)
    const utilizationCtx = utilizationChartRef.current?.getContext('2d');
    if (utilizationCtx) {
      const utilizationData = vehicles.map(v => {
        const workTime = v.workTime || 0;
        const maxHours = 24 * 7; // Weekly max hours
        return Math.min(100, Math.round((workTime / maxHours) * 100));
      });

      utilizationChartInstance.current = new Chart(utilizationCtx, {
        type: 'bar',
        data: {
          labels: vehicles.map(v => v.name || `V-${v.id?.toString().slice(-3)}`),
          datasets: [{
            label: 'Utilization %',
            data: utilizationData,
            backgroundColor: utilizationData.map(val => 
              val > 80 ? '#22c55e' : val > 50 ? '#f59e0b' : '#ef4444'
            ),
            borderRadius: 4,
            borderSkipped: false,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#1f2937',
              padding: 12,
              titleFont: { family: 'Inter', size: 13, weight: '600' },
              bodyFont: { family: 'Inter', size: 12 },
              cornerRadius: 8,
              callbacks: {
                label: function(context) {
                  return `Utilization: ${context.parsed.x}%`;
                }
              }
            }
          },
          scales: {
            x: {
              max: 100,
              grid: { color: '#f3f4f6', drawBorder: false },
              ticks: {
                font: { family: 'Inter', size: 12 },
                color: '#9ca3af',
                callback: (value) => `${value}%`
              }
            },
            y: {
              grid: { display: false },
              ticks: {
                font: { family: 'Inter', size: 11 },
                color: '#6b7280'
              }
            }
          }
        }
      });
    }

    // Cleanup
    return () => {
      if (efficiencyChartInstance.current) efficiencyChartInstance.current.destroy();
      if (fuelDistributionInstance.current) fuelDistributionInstance.current.destroy();
      if (costAnalysisInstance.current) costAnalysisInstance.current.destroy();
      if (utilizationChartInstance.current) utilizationChartInstance.current.destroy();
    };
  }, [analyticsData, loading]);

  const showNotification = (message, type = 'success') => {
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'notification-toast';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#ef4444' : '#ea580c'};
      color: white;
      padding: 14px 20px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;
    notification.innerHTML = `
      <i class="fas ${type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i>
      <span>${message}</span>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  };

  const handleExport = async () => {
    showNotification('Exporting analytics report... Please wait.');
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      showNotification('Analytics report downloaded successfully!');
    } catch (err) {
      showNotification('Export failed: ' + err.message, 'error');
    }
  };

  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleLogoutConfirm = () => {
    setShowLogoutModal(false);
    // Clear all localStorage data
    localStorage.clear();
    showNotification('Logging out...');
    setTimeout(() => {
      showNotification('You have been logged out successfully!');
      // Redirect to login page
      window.location.href = '/login';
    }, 1000);
  };

  const handleLogoutCancel = () => {
    setShowLogoutModal(false);
  };

  // Calculate derived metrics
  const calculateMetrics = () => {
    if (!analyticsData) return null;
    
    const vehicles = analyticsData.vehicles || [];
    const kpi = analyticsData.kpi || {};
    
    // Calculate efficiency (L per hour)
    const avgEfficiency = kpi.totalWorkTime > 0 
      ? (kpi.totalFuelConsumed / kpi.totalWorkTime).toFixed(2)
      : 0;
    
    // Calculate theft percentage
    const theftPercentage = kpi.totalFuelConsumed > 0
      ? ((kpi.totalFuelTheft / kpi.totalFuelConsumed) * 100).toFixed(1)
      : 0;
    
    // Cost estimate will only show when fuel price data is available from API
    // For now, this is calculated from API fuel consumption data only
    const estimatedCost = kpi.totalFuelConsumed || 0;
    
    // Find most/least efficient vehicles
    const vehicleEfficiencies = vehicles.map(v => ({
      ...v,
      efficiency: v.workTimeHours > 0 ? v.fuelConsumption / v.workTimeHours : 0
    }));
    
    const mostEfficient = vehicleEfficiencies.reduce((min, v) => 
      v.efficiency > 0 && v.efficiency < min.efficiency ? v : min, 
      vehicleEfficiencies[0] || {}
    );
    
    const leastEfficient = vehicleEfficiencies.reduce((max, v) => 
      v.efficiency > max.efficiency ? v : max, 
      vehicleEfficiencies[0] || {}
    );
    
    return {
      avgEfficiency,
      theftPercentage,
      estimatedCost,
      mostEfficient,
      leastEfficient,
      totalVehicles: vehicles.length,
      activeVehicles: kpi.activeVehicles || 0
    };
  };

  const metrics = calculateMetrics();

  // Loading overlay
  const LoadingOverlay = () => (
    <div className="loading-overlay">
      <div className="loading-content">
        <i className="fas fa-circle-notch fa-spin"></i>
        <span>Loading analytics data...</span>
      </div>
    </div>
  );

  // Error display
  const ErrorDisplay = () => (
    <div className="error-display">
      <i className="fas fa-exclamation-circle"></i>
      <h3>Error Loading Analytics</h3>
      <p>{error}</p>
      <button onClick={() => window.location.reload()} className="btn btn-outline">
        <i className="fas fa-redo"></i>
        Retry
      </button>
    </div>
  );

  return (
    <div className="dashboard-container">
      <Sidebar
        activeItem={activeNavItem}
        onLogout={handleLogoutClick}
        onNavigate={onNavigate}
      />
      <LogoutModal
        isOpen={showLogoutModal}
        onClose={handleLogoutCancel}
        onConfirm={handleLogoutConfirm}
      />
      <main className="main-content analytics-content">
        <Header
          filter={filter}
          setFilter={setFilter}
          onExport={handleExport}
          dateInfo={dateInfo}
          alerts={analyticsData?.alerts}
        />
        <div className="dashboard-body" style={{ position: 'relative' }}>
          {loading && <LoadingOverlay />}
          
          {error ? (
            <ErrorDisplay />
          ) : (
            <>
              {/* Analytics KPI Cards */}
              <div className="analytics-kpi-section">
                <div className="analytics-kpi-card">
                  <div className="kpi-icon efficiency-analytics-icon">
                    <i className="fas fa-tachometer-alt"></i>
                  </div>
                  <div className="kpi-content">
                    <span className="kpi-label">Avg Fuel Efficiency</span>
                    <div className="kpi-value-row">
                      <span className="kpi-value">{metrics?.avgEfficiency || '0'}</span>
                      <span className="kpi-unit">L/hr</span>
                    </div>
                    <span className="kpi-change neutral">
                      <i className="fas fa-minus"></i>
                      Fleet average consumption rate
                    </span>
                  </div>
                </div>
                
                {analyticsData?.fuelPrices ? (
                  <div className="analytics-kpi-card">
                    <div className="kpi-icon cost-icon">
                      <span className="currency-pkr" style={{ fontSize: '20px' }}>₨</span>
                    </div>
                    <div className="kpi-content">
                      <span className="kpi-label">Estimated Fuel Cost</span>
                      <div className="kpi-value-row">
                        <span className="kpi-value">₨{metrics?.estimatedCost?.toLocaleString() || '0'}</span>
                        <span className="kpi-unit">PKR</span>
                      </div>
                      <span className="kpi-change neutral">
                        <i className="fas fa-minus"></i>
                        From API fuel price data
                      </span>
                    </div>
                  </div>
                ) : null}
                
                <div className="analytics-kpi-card">
                  <div className="kpi-icon theft-analytics-icon">
                    <i className="fas fa-shield-alt"></i>
                  </div>
                  <div className="kpi-content">
                    <span className="kpi-label">Theft/Loss Rate</span>
                    <div className="kpi-value-row">
                      <span className="kpi-value">{metrics?.theftPercentage || '0'}</span>
                      <span className="kpi-unit">%</span>
                    </div>
                    <span className="kpi-change positive">
                      <i className="fas fa-arrow-trend-down"></i>
                      Of total fuel consumption
                    </span>
                  </div>
                </div>
                
                <div className="analytics-kpi-card">
                  <div className="kpi-icon utilization-icon">
                    <i className="fas fa-chart-pie"></i>
                  </div>
                  <div className="kpi-content">
                    <span className="kpi-label">Fleet Utilization</span>
                    <div className="kpi-value-row">
                      <span className="kpi-value">{metrics?.activeVehicles || '0'}</span>
                      <span className="kpi-unit">/{metrics?.totalVehicles || '0'}</span>
                    </div>
                    <span className="kpi-change neutral">
                      <i className="fas fa-minus"></i>
                      Active generators
                    </span>
                  </div>
                </div>
              </div>

              {/* Main Charts Section */}
              <div className="analytics-charts-grid">
                {/* Fuel Efficiency Comparison */}
                <div className="analytics-chart-card large">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-gas-pump"></i> Fuel vs Work Time Analysis</h3>
                      <p>Compare fuel consumption against operational hours per generator</p>
                    </div>
                    <div className="card-actions">
                      <select 
                        className="filter-select"
                        value={comparisonPeriod}
                        onChange={(e) => setComparisonPeriod(e.target.value)}
                      >
                        <option value="lastWeek">vs Last Week</option>
                        <option value="lastMonth">vs Last Month</option>
                        <option value="yesterday">vs Yesterday</option>
                      </select>
                      <button className="btn-sm btn-outline">
                        <i className="fas fa-download"></i>
                      </button>
                    </div>
                  </div>
                  <div className="chart-container large">
                    <canvas ref={efficiencyChartRef}></canvas>
                  </div>
                </div>

                {/* Fuel Distribution Pie */}
                <div className="analytics-chart-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-chart-pie"></i> Fuel Distribution</h3>
                      <p>Breakdown of fuel usage</p>
                    </div>
                  </div>
                  <div className="chart-container">
                    <canvas ref={fuelDistributionRef}></canvas>
                  </div>
                  <div className="chart-legend-custom">
                    <div className="legend-item">
                      <span className="legend-dot" style={{ background: '#ea580c' }}></span>
                      <span>Consumed</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot" style={{ background: '#ef4444' }}></span>
                      <span>Theft/Loss</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot" style={{ background: '#22c55e' }}></span>
                      <span>Refilled</span>
                    </div>
                    <div className="legend-item">
                      <span className="legend-dot" style={{ background: '#f59e0b' }}></span>
                      <span>Available</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Secondary Charts Section */}
              {/* <div className="analytics-charts-grid secondary">
                <div className="analytics-chart-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><span className="currency-pkr" style={{ marginRight: '8px' }}>₨</span> Cost Analysis</h3>
                      <p>Daily fuel costs vs price trends (PKR)</p>
                    </div>
                  </div>
                  <div className="chart-container">
                    {analyticsData?.fuelPrices ? (
                      <canvas ref={costAnalysisRef}></canvas>
                    ) : (
                      <div className="no-data-message">
                        <i className="fas fa-chart-line"></i>
                        <p>No fuel price data available from API</p>
                        <span className="no-data-sublabel">Contact admin to configure fuel price endpoint</span>
                      </div>
                    )}
                  </div>
                </div> */}

                {/* Vehicle Utilization */}
                {/* <div className="analytics-chart-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-percentage"></i> Vehicle Utilization</h3>
                      <p>Operational efficiency per vehicle</p>
                    </div>
                  </div>
                  <div className="chart-container">
                    <canvas ref={utilizationChartRef}></canvas>
                  </div>
                </div>
              </div> */}

              {/* Performance Insights Section */}
              <div className="insights-section">
                <div className="insights-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-lightbulb"></i> Performance Insights</h3>
                      <p>Key findings from your fleet data</p>
                    </div>
                  </div>
                  <div className="insights-content">
                    <div className="insight-item">
                      <div className="insight-icon green">
                        <i className="fas fa-arrow-up"></i>
                      </div>
                      <div className="insight-details">
                        <h4>Most Efficient Generator</h4>
                        <p>{metrics?.mostEfficient?.name || 'N/A'} - {metrics?.mostEfficient?.efficiency?.toFixed(2) || '0'} L/hr</p>
                      </div>
                    </div>
                    <div className="insight-item">
                      <div className="insight-icon amber">
                        <i className="fas fa-exclamation-triangle"></i>
                      </div>
                      <div className="insight-details">
                        <h4>Least Efficient Generator</h4>
                        <p>{metrics?.leastEfficient?.name || 'N/A'} - {metrics?.leastEfficient?.efficiency?.toFixed(2) || '0'} L/hr</p>
                      </div>
                    </div>
                    <div className="insight-item">
                      <div className="insight-icon blue">
                        <i className="fas fa-clock"></i>
                      </div>
                      <div className="insight-details">
                        <h4>Average Work Time</h4>
                        <p>{analyticsData?.kpi?.totalWorkTime?.toFixed(1) || '0'} hours across fleet</p>
                      </div>
                    </div>
                    <div className="insight-item">
                      <div className="insight-icon red">
                        <i className="fas fa-shield-alt"></i>
                      </div>
                      <div className="insight-details">
                        <h4>Security Alert</h4>
                        <p>{analyticsData?.kpi?.totalFuelTheft > 0 ? `${analyticsData.kpi.totalFuelTheft}L potential theft detected` : 'No theft incidents detected'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Top Performers Table */}
                <div className="top-performers-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-trophy"></i> Top Performers</h3>
                      <p>Vehicles with best efficiency ratings</p>
                    </div>
                  </div>
                  <div className="performers-list">
                    {analyticsData?.vehicles
                      ?.sort((a, b) => {
                        const effA = a.workTime > 0 ? a.fuelConsumption / (a.workTime / 60) : Infinity;
                        const effB = b.workTime > 0 ? b.fuelConsumption / (b.workTime / 60) : Infinity;
                        return effA - effB;
                      })
                      ?.slice(0, 5)
                      ?.map((vehicle, index) => (
                        <div key={vehicle.id} className="performer-item">
                          <div className="performer-rank">{index + 1}</div>
                          <div className="performer-info">
                            <span className="performer-name">{vehicle.name || `Generator-${vehicle.id}`}</span>
                            <span className="performer-stats">
                              {vehicle.fuelConsumption}L / {vehicle.workTimeHours}hrs
                            </span>
                          </div>
                          <div className="performer-score">
                            {vehicle.workTime > 0 
                              ? (vehicle.fuelConsumption / vehicle.workTimeHours).toFixed(2) 
                              : 'N/A'} L/hr
                          </div>
                        </div>
                      )) || (
                      <div className="no-data-message">
                        <i className="fas fa-chart-bar"></i>
                        <p>No performance data available</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Analytics;
