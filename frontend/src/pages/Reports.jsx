import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/common/Header';
import LogoutModal from '../components/common/LogoutModal';
import { useAuth } from '../contexts/AuthContext';
import { getDashboardData, getFleetAnalytics, formatApiError, ValidationError, NotFoundError } from '../services/api';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
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
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler
);

const Reports = ({ onNavigate }) => {
  const { fleetId } = useAuth();
  const [filter, setFilter] = useState('This Week');
  const [dateInfo, setDateInfo] = useState({ day: '', weekday: '', month: '' });
  const [activeNavItem, setActiveNavItem] = useState('fuel-logs');
  
  // Data states
  const [reportsData, setReportsData] = useState(null);
  const [fleetData, setFleetData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [sortColumn, setSortColumn] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [selectedVehicles, setSelectedVehicles] = useState([]);
  const [reportType, setReportType] = useState('summary');

  // Chart refs
  const historicalChartRef = useRef(null);
  const theftTrendRef = useRef(null);
  const historicalChartInstance = useRef(null);
  const theftTrendInstance = useRef(null);

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

  // Fetch reports data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Calculate date based on filter
        let date = new Date();
        let startDate = new Date();

        if (filter === 'Today') {
          // Today: just today
          date = new Date();
          startDate = new Date();
        } else if (filter === 'This Week') {
          // This Week: last 7 days
          date = new Date();
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
        } else if (filter === 'This Month') {
          // This Month: from start of month to today
          date = new Date();
          startDate = new Date(date.getFullYear(), date.getMonth(), 1);
        } else if (filter === 'Last Month') {
          // Last Month: previous full month
          const now = new Date();
          date = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of prev month
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); // First day of prev month
        } else if (filter === 'Custom' && dateRange.start) {
          startDate = new Date(dateRange.start);
          date = new Date(dateRange.end || dateRange.start);
        }
        
        const formattedDate = date.toISOString().split('T')[0];
        setSelectedDate(formattedDate);
        
        setDateRange({
          start: startDate.toISOString().split('T')[0],
          end: formattedDate
        });
        
        // Fetch dashboard and fleet data in parallel
        const effectiveFleetId = fleetId || 1735;
        const [dashboardData, fleetAnalytics] = await Promise.all([
          getDashboardData(effectiveFleetId, formattedDate),
          getFleetAnalytics(effectiveFleetId, formattedDate)
        ]);
        
        setReportsData(dashboardData);
        setFleetData(fleetAnalytics);
      } catch (err) {
        console.error('Failed to fetch reports data:', err);

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
    if (!reportsData || loading) return;

    // Destroy existing charts
    if (historicalChartInstance.current) historicalChartInstance.current.destroy();
    if (theftTrendInstance.current) theftTrendInstance.current.destroy();

    const vehicles = reportsData.vehicles || [];

    // 1. Historical Fuel Consumption Chart
    // Only renders when fuel trend data is available from API
    const historicalCtx = historicalChartRef.current?.getContext('2d');
    const fuelTrendData = reportsData?.fuelTrend;
    const hasFuelTrendData = fuelTrendData?.thisWeek && fuelTrendData.thisWeek.length > 0;
    
    if (historicalCtx && hasFuelTrendData) {
      const labels = fuelTrendData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const fuelData = fuelTrendData.thisWeek;

      const gradient1 = historicalCtx.createLinearGradient(0, 0, 0, 300);
      gradient1.addColorStop(0, 'rgba(234, 88, 12, 0.4)');
      gradient1.addColorStop(1, 'rgba(234, 88, 12, 0.05)');

      historicalChartInstance.current = new Chart(historicalCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Fuel Level (L)',
            data: fuelData,
            borderColor: '#ea580c',
            backgroundColor: gradient1,
            borderWidth: 2,
            fill: true,
            tension: 0,
            stepped: 'before',
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#ea580c',
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
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
              backgroundColor: '#9a3412',
              padding: 12,
              titleFont: { family: 'Inter', size: 13, weight: '600' },
              bodyFont: { family: 'Inter', size: 12 },
              cornerRadius: 6,
              displayColors: false,
              callbacks: {
                label: (context) => `${context.parsed.y.toFixed(2)} Liters`
              }
            }
          },
          scales: {
            x: {
              grid: {
                display: true,
                color: '#e2e8f0',
                drawBorder: false
              },
              ticks: {
                font: { family: 'Inter', size: 11 },
                color: '#718096'
              }
            },
            y: {
              beginAtZero: true,
              grid: {
                color: '#e2e8f0',
                drawBorder: false
              },
              ticks: {
                font: { family: 'Inter', size: 11 },
                color: '#718096',
                callback: (value) => `${value} Liters`
              }
            }
          }
        }
      });
    }

    // 2. Fuel Theft Trend Chart
    // Only renders when historical theft data is available from API
    const theftCtx = theftTrendRef.current?.getContext('2d');
    const theftHistoryData = reportsData?.theftHistory;
    const hasTheftData = theftHistoryData && (theftHistoryData.theftVolumes?.length > 0 || theftHistoryData.alertCounts?.length > 0);
    
    if (theftCtx && hasTheftData) {
      const days = theftHistoryData.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const theftData = theftHistoryData.theftVolumes || new Array(days.length).fill(0);
      const alertsData = theftHistoryData.alertCounts || new Array(days.length).fill(0);

      theftTrendInstance.current = new Chart(theftCtx, {
        type: 'bar',
        data: {
          labels: days,
          datasets: [{
            label: 'Fuel Theft (L)',
            data: theftData,
            backgroundColor: 'rgba(239, 68, 68, 0.7)',
            borderColor: '#ef4444',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y'
          }, {
            label: 'Security Alerts',
            data: alertsData,
            backgroundColor: 'rgba(245, 158, 11, 0.7)',
            borderColor: '#f59e0b',
            borderWidth: 1,
            borderRadius: 4,
            yAxisID: 'y1'
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
                padding: 15,
                font: { family: 'Inter', size: 11 },
                color: '#6b7280'
              }
            },
            tooltip: {
              backgroundColor: '#1f2937',
              padding: 10,
              titleFont: { family: 'Inter', size: 12, weight: '600' },
              bodyFont: { family: 'Inter', size: 11 },
              cornerRadius: 8
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
              type: 'linear',
              display: true,
              position: 'left',
              title: {
                display: true,
                text: 'Theft (L)',
                color: '#ef4444',
                font: { family: 'Inter', size: 11 }
              },
              grid: { color: '#f3f4f6', drawBorder: false },
              ticks: {
                font: { family: 'Inter', size: 11 },
                color: '#9ca3af'
              }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: {
                display: true,
                text: 'Alerts',
                color: '#f59e0b',
                font: { family: 'Inter', size: 11 }
              },
              grid: { drawOnChartArea: false },
              ticks: {
                font: { family: 'Inter', size: 11 },
                color: '#9ca3af',
                stepSize: 1
              }
            }
          }
        }
      });
    }

    return () => {
      if (historicalChartInstance.current) historicalChartInstance.current.destroy();
      if (theftTrendInstance.current) theftTrendInstance.current.destroy();
    };
  }, [reportsData, loading]);

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

  const handleExport = async (format) => {
    if (!filteredData || filteredData.length === 0) {
      showNotification('No data available to export', 'error');
      return;
    }

    showNotification(`Generating ${format.toUpperCase()} report... Please wait.`);
    
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `fleet-report-${timestamp}`;
      
      switch (format.toLowerCase()) {
        case 'csv':
          exportToCSV(filteredData, filename);
          break;
        case 'excel':
          exportToExcel(filteredData, filename);
          break;
        case 'pdf':
          exportToPDF(filteredData, filename);
          break;
        default:
          showNotification('Unsupported export format', 'error');
          return;
      }
      
      showNotification(`${format.toUpperCase()} report downloaded successfully!`);
    } catch (err) {
      console.error('Export error:', err);
      showNotification('Export failed: ' + err.message, 'error');
    }
  };

  // Export data to CSV
  const exportToCSV = (data, filename) => {
    const headers = ['Generator ID', 'Generator Name', 'Work Time (hrs)', 'Fuel Used (L)', 'Fuel Level (L)', 'Battery (mV)', 'Theft (L)', 'Status'];
    
    const csvRows = [
      headers.join(','),
      ...data.map(row => [
        row.id,
        row.name || `Generator-${row.id}`,
        row.workTimeHours || 0,
        row.fuelConsumption || 0,
        row.fuelLevel || 0,
        row.batteryHealth || '-',
        row.fuelTheft || 0,
        row.status || 'Normal'
      ].map(field => `"${field}"`).join(','))
    ];
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export data to Excel
  const exportToExcel = (data, filename) => {
    const worksheetData = data.map(row => ({
      'Generator ID': row.id,
      'Generator Name': row.name || `Generator-${row.id}`,
      'Work Time (hrs)': row.workTimeHours || 0,
      'Fuel Used (L)': row.fuelConsumption || 0,
      'Fuel Level (L)': row.fuelLevel || 0,
      'Battery (mV)': row.batteryHealth || '-',
      'Theft (L)': row.fuelTheft || 0,
      'Status': row.status || 'Normal'
    }));
    
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Fleet Report');
    
    // Set column widths
    const colWidths = [
      { wch: 12 },  // Generator ID
      { wch: 20 },  // Generator Name
      { wch: 15 },  // Work Time
      { wch: 12 },  // Fuel Used
      { wch: 12 },  // Fuel Level
      { wch: 12 },  // Battery
      { wch: 10 },  // Theft
      { wch: 12 }   // Status
    ];
    worksheet['!cols'] = colWidths;
    
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };

  // Export data to PDF
  const exportToPDF = (data, filename) => {
    const doc = new jsPDF('landscape');
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Add title
    doc.setFontSize(20);
    doc.setTextColor(30, 58, 95);
    doc.text('Fleet Fuel Report', pageWidth / 2, 20, { align: 'center' });
    
    // Add date
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 30, { align: 'center' });
    
    // Add summary section
    doc.setFontSize(14);
    doc.setTextColor(30, 58, 95);
    doc.text('Summary', 14, 50);
    
    const summary = calculateSummary();
    const summaryData = [
      ['Total Records:', summary?.totalRecords || 0],
      ['Total Fuel Consumed:', `${summary?.totalFuel || 0} L`],
      ['Fuel Theft:', `${summary?.totalTheft || 0} L`],
      ['Active Units:', summary?.activeGenerators || 0],
      ['Avg Efficiency:', `${summary?.avgConsumption || 0} L/hr`]
    ];
    
    doc.autoTable({
      startY: 55,
      head: [['Metric', 'Value']],
      body: summaryData,
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      styles: { fontSize: 11 },
      margin: { left: 14, right: 14 }
    });
    
    // Add table title
    doc.setFontSize(14);
    doc.setTextColor(30, 58, 95);
    doc.text('Generator Details', 14, doc.lastAutoTable.finalY + 15);
    
    // Add generator data table
    const tableData = data.map(row => [
      row.id,
      row.name || `Generator-${row.id}`,
      `${row.workTimeHours || 0} hrs`,
      `${row.fuelConsumption || 0} L`,
      `${row.fuelLevel || 0} L`,
      row.batteryHealth || '-',
      `${row.fuelTheft || 0} L`,
      row.status || 'Normal'
    ]);
    
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 20,
      head: [['ID', 'Generator', 'Work Time', 'Fuel Used', 'Fuel Level', 'Battery', 'Theft', 'Status']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      styles: { fontSize: 10, cellPadding: 3 },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 },
      didDrawPage: (data) => {
        // Add page number at bottom
        doc.setFontSize(10);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `Page ${data.pageNumber} of ${doc.internal.getNumberOfPages()}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: 'center' }
        );
      }
    });
    
    // Add footer
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text('Fleet Fuel Tracker - Confidential', pageWidth / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
    }
    
    doc.save(`${filename}.pdf`);
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

  // Filter and sort table data
  const getFilteredAndSortedData = () => {
    if (!reportsData?.vehicles) return [];
    
    let data = [...reportsData.vehicles];
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      data = data.filter(v => 
        (v.name || '').toLowerCase().includes(query) ||
        (v.id || '').toString().includes(query)
      );
    }
    
    // Status filter
    if (statusFilter !== 'All') {
      data = data.filter(v => v.status === statusFilter);
    }
    
    // Sorting
    data.sort((a, b) => {
      let aValue = a[sortColumn];
      let bValue = b[sortColumn];
      
      // Handle nested values
      if (sortColumn === 'fuelConsumption') {
        aValue = a.fuelConsumption || 0;
        bValue = b.fuelConsumption || 0;
      } else if (sortColumn === 'workTime') {
        aValue = a.workTimeHours || 0;
        bValue = b.workTimeHours || 0;
      }
      
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
      }
      
      return sortDirection === 'asc'
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    });
    
    return data;
  };

  const filteredData = getFilteredAndSortedData();
  
  // Pagination
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
    setCurrentPage(1);
  };

  const toggleVehicleSelection = (vehicleId) => {
    setSelectedVehicles(prev => 
      prev.includes(vehicleId)
        ? prev.filter(id => id !== vehicleId)
        : [...prev, vehicleId]
    );
  };

  const selectAllVehicles = () => {
    if (selectedVehicles.length === paginatedData.length) {
      setSelectedVehicles([]);
    } else {
      setSelectedVehicles(paginatedData.map(v => v.id));
    }
  };

  // Calculate summary metrics
  const calculateSummary = () => {
    if (!reportsData?.kpi) return null;
    
    const kpi = reportsData.kpi;
    const vehicles = reportsData.vehicles || [];
    
    return {
      totalRecords: vehicles.length,
      totalFuel: kpi.totalFuelConsumed || 0,
      totalTheft: kpi.totalFuelTheft || 0,
      activeGenerators: kpi.activeVehicles || 0,
      avgConsumption: kpi.totalWorkTime > 0 
        ? (kpi.totalFuelConsumed / kpi.totalWorkTime).toFixed(2)
        : '0'
    };
  };

  const summary = calculateSummary();

  // Loading overlay
  const LoadingOverlay = () => (
    <div className="loading-overlay">
      <div className="loading-content">
        <i className="fas fa-circle-notch fa-spin"></i>
        <span>Loading reports data...</span>
      </div>
    </div>
  );

  // Error display
  const ErrorDisplay = () => (
    <div className="error-display">
      <i className="fas fa-exclamation-circle"></i>
      <h3>Error Loading Reports</h3>
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
      <main className="main-content reports-content">
        <Header
          filter={filter}
          setFilter={setFilter}
          onExport={() => handleExport('pdf')}
          dateInfo={dateInfo}
          alerts={reportsData?.alerts}
        />
        <div className="dashboard-body" style={{ position: 'relative' }}>
          {loading && <LoadingOverlay />}
          
          {error ? (
            <ErrorDisplay />
          ) : (
            <>
              {/* Report Type Selector */}
              <div className="report-type-bar">
                <div className="report-type-tabs">
                  <button 
                    className={`report-tab ${reportType === 'summary' ? 'active' : ''}`}
                    onClick={() => setReportType('summary')}
                  >
                    <i className="fas fa-chart-bar"></i>
                    Summary Report
                  </button>
                  <button 
                    className={`report-tab ${reportType === 'detailed' ? 'active' : ''}`}
                    onClick={() => setReportType('detailed')}
                  >
                    <i className="fas fa-list-alt"></i>
                    Detailed Report
                  </button>
                  <button 
                    className={`report-tab ${reportType === 'theft' ? 'active' : ''}`}
                    onClick={() => setReportType('theft')}
                  >
                    <i className="fas fa-shield-alt"></i>
                    Security Report
                  </button>
                </div>
                <div className="report-actions">
                  <button className="btn btn-outline" onClick={() => handleExport('csv')}>
                    <i className="fas fa-file-csv"></i>
                    CSV
                  </button>
                  <button className="btn btn-outline" onClick={() => handleExport('excel')}>
                    <i className="fas fa-file-excel"></i>
                    Excel
                  </button>
                  <button className="btn btn-primary" onClick={() => handleExport('pdf')}>
                    <i className="fas fa-file-pdf"></i>
                    PDF Report
                  </button>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="reports-summary-section">
                <div className="summary-card">
                  <div className="summary-icon blue">
                    <i className="fas fa-clipboard-list"></i>
                  </div>
                  <div className="summary-content">
                    <span className="summary-label">Total Records</span>
                    <span className="summary-value">{summary?.totalRecords || 0}</span>
                    <span className="summary-sublabel">Generators in report</span>
                  </div>
                </div>
                
                <div className="summary-card">
                  <div className="summary-icon fuel">
                    <i className="fas fa-gas-pump"></i>
                  </div>
                  <div className="summary-content">
                    <span className="summary-label">Total Fuel</span>
                    <span className="summary-value">{summary?.totalFuel?.toLocaleString() || 0}</span>
                    <span className="summary-sublabel">Liters consumed</span>
                  </div>
                </div>
                
                <div className="summary-card">
                  <div className="summary-icon theft">
                    <i className="fas fa-exclamation-triangle"></i>
                  </div>
                  <div className="summary-content">
                    <span className="summary-label">Fuel Theft</span>
                    <span className="summary-value">{summary?.totalTheft?.toLocaleString() || 0}</span>
                    <span className="summary-sublabel">Liters lost</span>
                  </div>
                </div>
                
                <div className="summary-card">
                  <div className="summary-icon active">
                    <i className="fas fa-bolt"></i>
                  </div>
                  <div className="summary-content">
                    <span className="summary-label">Active Units</span>
                    <span className="summary-value">{summary?.activeGenerators || 0}</span>
                    <span className="summary-sublabel">Currently running</span>
                  </div>
                </div>
                
                <div className="summary-card">
                  <div className="summary-icon efficiency">
                    <i className="fas fa-tachometer-alt"></i>
                  </div>
                  <div className="summary-content">
                    <span className="summary-label">Avg Efficiency</span>
                    <span className="summary-value">{summary?.avgConsumption || 0}</span>
                    <span className="summary-sublabel">L per hour</span>
                  </div>
                </div>
              </div>

              {/* Charts Section */}
              <div className="reports-charts-grid">
                <div className="reports-chart-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-chart-line"></i> Fuel Consumption History</h3>
                      <p>
                        {filter === 'Today' ? 'Today\'s consumption' :
                         filter === 'This Week' ? '7-day consumption trend' :
                         filter === 'This Month' ? 'Month consumption trend' :
                         filter === 'Last Month' ? 'Last month consumption' :
                         'Consumption trend'}
                      </p>
                    </div>
                  </div>
                  <div className="chart-container">
                    {reportsData?.fuelTrend?.thisWeek?.length > 0 ? (
                      <canvas ref={historicalChartRef}></canvas>
                    ) : (
                      <div className="no-data-message">
                        <i className="fas fa-chart-line"></i>
                        <p>No historical fuel data available</p>
                        <span className="no-data-sublabel">Data will appear when available from API</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="reports-chart-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-shield-alt"></i> Security Incidents</h3>
                      <p>Theft and alert trends</p>
                    </div>
                  </div>
                  <div className="chart-container">
                    {reportsData?.theftHistory ? (
                      <canvas ref={theftTrendRef}></canvas>
                    ) : (
                      <div className="no-data-message">
                        <i className="fas fa-shield-alt"></i>
                        <p>No security incident data available</p>
                        <span className="no-data-sublabel">Theft history will appear when available</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Data Table Section */}
              <div className="reports-table-section">
                <div className="reports-table-card">
                  <div className="card-header">
                    <div className="card-title-section">
                      <h3><i className="fas fa-database"></i> Detailed Records</h3>
                      <p>Complete fleet activity log</p>
                    </div>
                    <div className="table-controls">
                      <div className="search-box reports-search">
                        <i className="fas fa-search"></i>
                        <input 
                          type="text" 
                          placeholder="Search generators..."
                          value={searchQuery}
                          onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setCurrentPage(1);
                          }}
                        />
                      </div>
                      <select 
                        className="filter-select"
                        value={statusFilter}
                        onChange={(e) => {
                          setStatusFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                      >
                        <option value="All">All Status</option>
                        <option value="Normal">Normal</option>
                        <option value="Running">Running</option>
                        <option value="Alert">Alert</option>
                        <option value="Low Fuel">Low Fuel</option>
                      </select>
                      <button className="btn-sm btn-outline">
                        <i className="fas fa-filter"></i>
                        Filters
                      </button>
                    </div>
                  </div>

                  <div className="table-selection-bar">
                    <label className="selection-checkbox">
                      <input 
                        type="checkbox" 
                        checked={selectedVehicles.length === paginatedData.length && paginatedData.length > 0}
                        onChange={selectAllVehicles}
                      />
                      <span>Select All ({selectedVehicles.length} selected)</span>
                    </label>
                    {selectedVehicles.length > 0 && (
                      <div className="selection-actions">
                        <button className="btn-sm btn-outline">
                          <i className="fas fa-download"></i>
                          Export Selected
                        </button>
                        <button className="btn-sm btn-outline danger">
                          <i className="fas fa-trash"></i>
                          Clear Selection
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="table-container reports-table">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="checkbox-col">
                            <input 
                              type="checkbox" 
                              checked={selectedVehicles.length === paginatedData.length && paginatedData.length > 0}
                              onChange={selectAllVehicles}
                            />
                          </th>
                          <th onClick={() => handleSort('name')} className="sortable">
                            Generator <i className={`fas fa-sort${sortColumn === 'name' ? (sortDirection === 'asc' ? '-up' : '-down') : ''}`}></i>
                          </th>
                          <th onClick={() => handleSort('workTime')} className="sortable">
                            Work Time <i className={`fas fa-sort${sortColumn === 'workTime' ? (sortDirection === 'asc' ? '-up' : '-down') : ''}`}></i>
                          </th>
                          <th onClick={() => handleSort('fuelConsumption')} className="sortable">
                            Fuel Used <i className={`fas fa-sort${sortColumn === 'fuelConsumption' ? (sortDirection === 'asc' ? '-up' : '-down') : ''}`}></i>
                          </th>
                          <th>Fuel Level</th>
                          <th>Battery</th>
                          <th>Theft</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedData.map((vehicle) => (
                          <tr key={vehicle.id} className={selectedVehicles.includes(vehicle.id) ? 'selected' : ''}>
                            <td className="checkbox-col">
                              <input 
                                type="checkbox" 
                                checked={selectedVehicles.includes(vehicle.id)}
                                onChange={() => toggleVehicleSelection(vehicle.id)}
                              />
                            </td>
                            <td>
                              <div className="gen-info">
                                <div className={`gen-icon ${vehicle.iconClass}`}>
                                  <i className="fas fa-bolt"></i>
                                </div>
                                <div className="gen-details">
                                  <span className="gen-name">{vehicle.name || `Generator-${vehicle.id}`}</span>
                                  <span className="gen-id">ID: {vehicle.id}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="hours">{vehicle.workTimeHours || 0} hrs</span>
                            </td>
                            <td>
                              <span className="fuel-used">{vehicle.fuelConsumption || 0} L</span>
                            </td>
                            <td>
                              <div className="fuel-level-bar">
                                <div 
                                  className="fuel-level-fill" 
                                  style={{ 
                                    width: `${Math.min(100, (vehicle.fuelLevel || 0) / 250 * 100)}%`,
                                    background: (vehicle.fuelLevel || 0) < 30 ? '#ef4444' : (vehicle.fuelLevel || 0) < 60 ? '#f59e0b' : '#22c55e'
                                  }}
                                ></div>
                                <span>{vehicle.fuelLevel || 0}L</span>
                              </div>
                            </td>
                            <td>
                              <span className={`battery-status ${(vehicle.batteryHealth || 0) < 4000 ? 'low' : 'good'}`}>
                                {vehicle.batteryHealth || '-'} mV
                              </span>
                            </td>
                            <td>
                              <span className={`theft-badge ${vehicle.fuelTheft > 0 ? 'alert' : ''}`}>
                                {vehicle.fuelTheft > 0 ? `${vehicle.fuelTheft} L` : '-'}
                              </span>
                            </td>
                            <td>
                              <span className={`status-pill ${vehicle.statusClass}`}>
                                {vehicle.status}
                              </span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button className="action-btn" title="View Details">
                                  <i className="fas fa-eye"></i>
                                </button>
                                <button className="action-btn" title="Export">
                                  <i className="fas fa-download"></i>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Table Footer */}
                  <div className="table-footer">
                    <span>
                      Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length} records
                    </span>
                    <div className="pagination">
                      <button 
                        className="page-btn" 
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage(prev => prev - 1)}
                      >
                        <i className="fas fa-chevron-left"></i>
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                        <button
                          key={page}
                          className={`page-btn ${currentPage === page ? 'active' : ''}`}
                          onClick={() => setCurrentPage(page)}
                        >
                          {page}
                        </button>
                      ))}
                      <button 
                        className="page-btn" 
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage(prev => prev + 1)}
                      >
                        <i className="fas fa-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Report Metadata */}
              <div className="report-metadata">
                <div className="metadata-card">
                  <h4><i className="fas fa-info-circle"></i> Report Information</h4>
                  <div className="metadata-grid">
                    <div className="metadata-item">
                      <span className="metadata-label">Report Type</span>
                      <span className="metadata-value">{reportType === 'summary' ? 'Summary Report' : reportType === 'detailed' ? 'Detailed Report' : 'Security Report'}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Date Range</span>
                      <span className="metadata-value">{dateRange.start} to {dateRange.end}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Generated At</span>
                      <span className="metadata-value">{new Date().toLocaleString()}</span>
                    </div>
                    <div className="metadata-item">
                      <span className="metadata-label">Fleet ID</span>
                      <span className="metadata-value">1735</span>
                    </div>
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

export default Reports;
