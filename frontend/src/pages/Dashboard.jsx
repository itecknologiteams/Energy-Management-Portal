import React, { useState, useEffect } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/common/Header';
import LogoutModal from '../components/common/LogoutModal';
import KPICards from '../components/Dashboard/KPICards';
import FuelTrendChart from '../components/Dashboard/FuelTrendChart';
import GeneratorFuelChart from '../components/Dashboard/GeneratorFuelChart';
import GeneratorBarChart from '../components/Dashboard/GeneratorBarChart';
import GeneratorAccordion from '../components/Dashboard/GeneratorAccordion';
import AlertsCard from '../components/Dashboard/AlertsCard';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardData, getDashboardDataRange, formatApiError, ValidationError, NotFoundError } from '../services/api';

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
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterDateRange, setFilterDateRange] = useState({ start: toLocalDateStr(new Date()), end: toLocalDateStr(new Date()) }); // updated on each fetchData run
  const [showLogoutModal, setShowLogoutModal] = useState(false);

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
          setSelectedDate(todayStr);
          data = await getDashboardData(fleetId || 1735, todayStr);
        } else if (filter === 'This Week') {
          const weekStart = new Date(today);
          // Start from Monday of the current calendar week
          const day = weekStart.getDay(); // 0=Sun, 1=Mon … 6=Sat
          const daysToMonday = day === 0 ? 6 : day - 1;
          weekStart.setDate(weekStart.getDate() - daysToMonday);
          filterStart = toLocalDateStr(weekStart);
          filterEnd = todayStr;
          setSelectedDate(todayStr);
          data = await getDashboardDataRange(fleetId || 1735, filterStart, filterEnd);
        } else if (filter === 'This Month') {
          const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
          filterStart = toLocalDateStr(monthStart);
          filterEnd = todayStr;
          setSelectedDate(todayStr);
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

  const handleExport = async () => {
    showNotification('Exporting report... Please wait.');
    
    try {
      // In a real app, this would generate and download a CSV/Excel file
      await new Promise(resolve => setTimeout(resolve, 1500));
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
      <main className="main-content">
        <Header
          filter={filter}
          setFilter={setFilter}
          onExport={handleExport}
          dateInfo={dateInfo}
          alerts={dashboardData?.alerts}
        />
        <div className="dashboard-body" style={{ position: 'relative' }}>
          {loading && <LoadingOverlay />}
          
          {error ? (
            <ErrorDisplay />
          ) : (
            <>
              <KPICards data={dashboardData?.kpi} filter={filter} />
              <div className="charts-section">
                <FuelTrendChart data={dashboardData?.fuelTrend} filter={filter} />
                <GeneratorBarChart data={dashboardData?.vehicleFuelData} filter={filter} />
              </div>
              <GeneratorFuelChart
                vehicles={dashboardData?.vehicles}
                selectedDate={selectedDate}
                filter={filter}
                startDate={filterDateRange.start}
                endDate={filterDateRange.end}
              />
              <div className="bottom-section">
                <div className="table-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3>Fleet Performance Overview</h3>
                      <p>Real-time monitoring of all fleet vehicles</p>
                    </div>
                  </div>
                  <div style={{ padding: '16px' }}>
                    <GeneratorAccordion
                      data={dashboardData?.vehicles}
                      filter={filter}
                    />
                  </div>
                </div>
                <AlertsCard alerts={dashboardData?.alerts} />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
