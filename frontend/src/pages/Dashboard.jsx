import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/common/Header';
import LogoutModal from '../components/common/LogoutModal';
import AlertRulesModal from '../components/Alerts/AlertRulesModal';
import UnitSummaryBar from '../components/UnitDashboard/UnitSummaryBar';
import LiveFuelTank from '../components/UnitDashboard/LiveFuelTank';
import UnitDetailPanel from '../components/UnitDashboard/UnitDetailPanel';
import FuelTrendCard from '../components/UnitDashboard/FuelTrendCard';
import GeneratorFuelList from '../components/UnitDashboard/GeneratorFuelList';
import RecentActivity from '../components/UnitDashboard/RecentActivity';
import FuelLevelHistory from '../components/UnitDashboard/FuelLevelHistory';
import MaintenanceSettingsModal from '../components/UnitDashboard/MaintenanceSettingsModal';
import { useAuth } from '../contexts/AuthContext';
import useTemperatureAlerts, { alertKey, describeAlert } from '../hooks/useTemperatureAlerts';
import {
  getDashboardData,
  getDashboardDataRange,
  getMaintenance,
  saveMaintenance,
  formatApiError,
  ValidationError,
  NotFoundError,
} from '../services/api';
import { fuelCapacity } from '../utils/unitData';

const UNIT_TABS = [
  { id: 'overview', label: 'Overview', icon: 'fa-chart-simple' },
  { id: 'fuel', label: 'Fuel Status', icon: 'fa-gas-pump' },
  { id: 'maintenance', label: 'Maintenance', icon: 'fa-wrench' },
];

// Build a YYYY-MM-DD string from a Date using the local timezone,
// preventing the UTC-offset shift that toISOString() introduces.
function toLocalDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const Dashboard = ({ onNavigate }) => {
  const { fleetId } = useAuth();
  const [filter, setFilter] = useState('Today');
  const [dateInfo, setDateInfo] = useState({ day: '', weekday: '', month: '' });
  const [activeNavItem, setActiveNavItem] = useState('dashboard');
  
  // Data states
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterDateRange, setFilterDateRange] = useState({ start: toLocalDateStr(new Date()), end: toLocalDateStr(new Date()) }); // updated on each fetchData run
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showAlertRules, setShowAlertRules] = useState(false);

  // Temperature alert rules: announce each new breach once — as a toast and,
  // when the user has allowed it, a browser notification
  const { triggered: temperatureAlerts, refresh: refreshTemperatureAlerts } = useTemperatureAlerts(
    fleetId,
    (alert) => {
      const message = `${alert.vehicleName}: ${describeAlert(alert)}`;
      showNotification(message, 'error');
      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Temperature alert', { body: message, tag: alertKey(alert) });
        } catch {
          // Some browsers only allow notifications from a service worker
        }
      }
    }
  );

  // Active breaches, shaped for the header bell and the alerts card
  const temperatureAlertItems = temperatureAlerts.map((a) => ({
    id: `temperature-${alertKey(a)}`,
    type: 'alert',
    icon: 'fa-temperature-high',
    iconClass: 'red',
    title: a.vehicleName,
    message: describeAlert(a),
    description: describeAlert(a),
    // Tracking times are PKT wall-clock values read back as UTC
    time: new Date(a.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }),
  }));
  const allAlerts = [...temperatureAlertItems, ...(dashboardData?.alerts || [])];

  // ── Selected unit and its maintenance status ────────────────────────────
  const units = dashboardData?.vehicles || [];
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [tab, setTab] = useState('maintenance');
  const [maintenance, setMaintenance] = useState(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [showMaintenanceSettings, setShowMaintenanceSettings] = useState(false);

  // Default to the first unit that can show litres, else the first unit
  const selectedUnit = units.find((u) => u.id === selectedUnitId)
    || units.find((u) => fuelCapacity(u))
    || units[0]
    || null;
  const selectedId = selectedUnit?.id ?? null;

  useEffect(() => {
    if (!fleetId || !selectedId) return undefined;
    let cancelled = false;
    setMaintenanceLoading(true);
    setMaintenance(null);
    getMaintenance(fleetId, selectedId)
      .then((m) => { if (!cancelled) setMaintenance(m); })
      .catch((err) => console.error('Maintenance load failed:', err))
      .finally(() => { if (!cancelled) setMaintenanceLoading(false); });
    return () => { cancelled = true; };
  }, [fleetId, selectedId]);

  const handleSaveMaintenance = async (settings) => {
    const saved = await saveMaintenance(fleetId, selectedId, settings);
    setMaintenance(saved);
  };

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

  // Fetch dashboard data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const today = new Date();
        const todayStr = toLocalDateStr(today);

        let data;
        let filterStart = todayStr;
        let filterEnd = todayStr;

        if (filter === 'Today') {
          filterStart = filterEnd = todayStr;
          data = await getDashboardData(fleetId || 1735, todayStr);
        } else if (filter === 'This Week') {
          const weekStart = new Date(today);
          // Start from Monday of the current calendar week
          const day = weekStart.getDay(); // 0=Sun, 1=Mon … 6=Sat
          const daysToMonday = day === 0 ? 6 : day - 1;
          weekStart.setDate(weekStart.getDate() - daysToMonday);
          filterStart = toLocalDateStr(weekStart);
          filterEnd = todayStr;
          data = await getDashboardDataRange(fleetId || 1735, filterStart, filterEnd);
        } else if (filter === 'This Month') {
          const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
          filterStart = toLocalDateStr(monthStart);
          filterEnd = todayStr;
          data = await getDashboardDataRange(fleetId || 1735, filterStart, filterEnd);
        } else if (filter === 'Last Month') {
          const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
          const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0); // last day of prev month
          filterStart = toLocalDateStr(lastMonthStart);
          filterEnd = toLocalDateStr(lastMonthEnd);
          data = await getDashboardDataRange(fleetId || 1735, filterStart, filterEnd);
        }

        setFilterDateRange({ start: filterStart, end: filterEnd });
        setDashboardData(data);
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);

        // Format error message based on error type
        let errorMessage = err.message || 'Failed to fetch data from API';

        // Add user-friendly prefix based on error type
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

  // Refetch when filter changes
  useEffect(() => {
    if (dashboardData) {
      // Data already fetched by the previous effect
    }
  }, [filter]);

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

  const handleExport = () => {
    try {
      if (!dashboardData) {
        showNotification('No data to export', 'error');
        return;
      }

      const kpi    = dashboardData.kpi    || {};
      const vehicles = dashboardData.vehicles || [];

      const periodLabel = filter === 'This Week'  ? 'This Week'
                        : filter === 'This Month' ? 'This Month'
                        : filter === 'Last Month' ? 'Last Month'
                        : 'Today';

      const rows = [];

      // ── Summary section ──────────────────────────────────────────────────────
      rows.push(['FLEET FUEL CONSUMPTION REPORT']);
      rows.push([`Period: ${periodLabel}`, `Date Range: ${filterDateRange.start} to ${filterDateRange.end}`]);
      rows.push([]);
      rows.push(['SUMMARY']);
      rows.push(['Total Fuel Consumed (L)', 'Total Work Time (hrs)', 'Active Generators', 'Total Generators', 'Avg Battery Health (V)']);
      rows.push([
        kpi.totalFuelConsumed?.toFixed(2)  ?? '0.00',
        kpi.totalWorkTime?.toFixed(1)       ?? '0.0',
        kpi.activeVehicles                  ?? 0,
        kpi.totalVehicles                   ?? 0,
        kpi.batteryHealth != null ? (kpi.batteryHealth / 1000).toFixed(2) : '—',
      ]);
      rows.push([]);

      // ── Per-generator section ─────────────────────────────────────────────────
      rows.push(['GENERATOR BREAKDOWN']);
      rows.push(['Generator Name', 'Status', 'Fuel Consumed (L)', 'Work Time (hrs)', 'Fuel Level (L)', 'Battery (V)', 'Temperature (°C)', 'Fuel Refilled (L)', 'Fuel Theft (L)']);

      vehicles.forEach(v => {
        rows.push([
          v.name,
          v.status,
          v.fuelConsumption != null ? Number(v.fuelConsumption).toFixed(2) : '—',
          v.workTimeHours   != null ? Number(v.workTimeHours).toFixed(1)   : '0.0',
          v.fuelLevel != null && v.fuelLevel !== '-' ? Number(v.fuelLevel).toFixed(1) : '—',
          v.batteryHealth   != null ? (v.batteryHealth / 1000).toFixed(2)  : '—',
          v.temperature     != null ? Number(v.temperature).toFixed(1)     : '—',
          v.fuelRefilled    != null ? Number(v.fuelRefilled).toFixed(2)    : '—',
          v.fuelTheft       != null ? Number(v.fuelTheft).toFixed(2)       : '—',
        ]);
      });

      // ── Convert to CSV ────────────────────────────────────────────────────────
      const csv = rows.map(row =>
        row.map(cell => {
          const s = String(cell ?? '');
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        }).join(',')
      ).join('\r\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `fleet-report-${periodLabel.replace(/\s+/g, '-').toLowerCase()}-${filterDateRange.start}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      showNotification('Report downloaded successfully!');
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

  // Loading overlay component
  const LoadingOverlay = () => (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(245, 243, 239, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      borderRadius: '16px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '20px 30px',
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
      }}>
        <i className="fas fa-circle-notch fa-spin" style={{ color: '#ea580c', fontSize: '24px' }}></i>
        <span style={{ fontWeight: 500, color: '#374151' }}>Loading data...</span>
      </div>
    </div>
  );

  // Error display component with improved error handling
  const ErrorDisplay = () => {
    const errorDetails = formatApiError({ message: error });

    // Determine error styling based on error type
    let icon = errorDetails.icon;
    let iconColor = errorDetails.iconColor;
    let title = errorDetails.title;
    let showRetry = true;
    let troubleshootingTips = null;

    // Check for specific error types from our custom errors
    if (error.includes && error.includes('Invalid fleet ID')) {
      icon = 'fa-exclamation-circle';
      iconColor = '#f59e0b';
      title = 'Invalid Fleet ID';
    } else if (error.includes && error.includes('Invalid date format')) {
      icon = 'fa-calendar-times';
      iconColor = '#f59e0b';
      title = 'Invalid Date Format';
    } else if (error.includes && error.includes('Future date')) {
      icon = 'fa-calendar-alt';
      iconColor = '#6b7280';
      title = 'Future Date Not Available';
    } else if (error.includes && error.includes('not found')) {
      icon = 'fa-search';
      iconColor = '#6b7280';
      title = 'Data Not Found';
    } else if (error.includes && (error.includes('DOCTYPE') || error.includes('HTML') || error.includes('non-JSON'))) {
      // API returning HTML error
      icon = 'fa-server';
      iconColor = '#ef4444';
      title = 'API Connection Error';
      troubleshootingTips = (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          padding: '16px',
          marginTop: '16px',
          marginBottom: '24px',
          maxWidth: '500px',
          textAlign: 'left'
        }}>
          <p style={{ color: '#991b1b', fontWeight: 600, marginBottom: '8px' }}>
            <i className="fas fa-lightbulb" style={{ marginRight: '8px' }}></i>
            Troubleshooting Tips:
          </p>
          <ul style={{ color: '#7f1d1d', fontSize: '14px', margin: 0, paddingLeft: '20px' }}>
            <li>Check if the backend API server is running on <code>http://localhost:3000</code></li>
            <li>Verify the API base URL in your environment variables (REACT_APP_API_URL)</li>
            <li>Ensure CORS is enabled on the backend for <code>http://localhost:3001</code></li>
            <li>Check that the API endpoint paths match the Postman collection</li>
          </ul>
        </div>
      );
    }

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 20px',
        textAlign: 'center'
      }}>
        <i className={`fas ${icon}`} style={{
          fontSize: '48px',
          color: iconColor,
          marginBottom: '16px'
        }}></i>
        <h3 style={{ color: '#1f2937', marginBottom: '8px' }}>{title}</h3>
        <p style={{ color: '#6b7280', marginBottom: troubleshootingTips ? '0' : '24px', maxWidth: '500px' }}>{error}</p>
        {troubleshootingTips}
        {showRetry && (
          <button
            onClick={() => window.location.reload()}
            className="btn btn-outline"
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <i className="fas fa-redo"></i>
            Retry
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="dashboard-container ems-ui">
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
      <AlertRulesModal
        isOpen={showAlertRules}
        onClose={() => setShowAlertRules(false)}
        fleetId={fleetId}
        triggered={temperatureAlerts}
        onRulesChanged={refreshTemperatureAlerts}
      />
      <main className="main-content">
        <Header
          filter={filter}
          setFilter={setFilter}
          onExport={handleExport}
          dateInfo={dateInfo}
          alerts={allAlerts}
          onManageAlerts={() => setShowAlertRules(true)}
        />
        <MaintenanceSettingsModal
          isOpen={showMaintenanceSettings}
          onClose={() => setShowMaintenanceSettings(false)}
          unitName={selectedUnit?.name}
          settings={maintenance?.settings}
          onSave={handleSaveMaintenance}
        />
        <div className="relative space-y-5">
          {loading && <LoadingOverlay />}

          {error ? (
            <ErrorDisplay />
          ) : !loading && units.length === 0 ? (
            <p className="rounded-2xl bg-white p-10 text-center text-gray-500">No generators found for this fleet.</p>
          ) : (
            <>
              <UnitSummaryBar
                units={units}
                unit={selectedUnit}
                onSelectUnit={setSelectedUnitId}
                maintenance={maintenance}
                onSetUpMaintenance={() => setShowMaintenanceSettings(true)}
              />

              <nav className="flex flex-wrap items-center gap-2" aria-label="Unit details">
                {UNIT_TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    aria-pressed={tab === t.id}
                    className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors ${
                      tab === t.id ? 'bg-orange-600 text-white shadow' : 'text-gray-700 hover:bg-white'
                    }`}
                  >
                    <i className={`fas ${t.icon}`} aria-hidden="true"></i>
                    {t.label}
                  </button>
                ))}
              </nav>

              <div className="grid grid-cols-1 min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] gap-5">
                <LiveFuelTank unit={selectedUnit} />
                <UnitDetailPanel
                  tab={tab}
                  unit={selectedUnit}
                  maintenance={maintenance}
                  maintenanceLoading={maintenanceLoading}
                  onEditMaintenance={() => setShowMaintenanceSettings(true)}
                  temperatureAlert={temperatureAlerts.some((a) => a.vehicleId === selectedUnit?.id)}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.95fr)] gap-5">
                <FuelTrendCard unit={selectedUnit} />
                <GeneratorFuelList units={units} selectedId={selectedUnit?.id} onSelectUnit={setSelectedUnitId} />
                <RecentActivity unit={selectedUnit} units={units} temperatureAlerts={temperatureAlerts} maintenance={maintenance} />
                {/* Full width, so no empty cell is left beside it */}
                <div className="lg:col-span-2 xl:col-span-3">
                  <FuelLevelHistory units={units} unit={selectedUnit} onSelectUnit={setSelectedUnitId} />
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
