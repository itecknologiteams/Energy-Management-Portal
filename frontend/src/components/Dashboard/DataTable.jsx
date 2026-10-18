import React, { useState, useEffect } from 'react';

const formatGeneratorTime = (isoString, showDate) => {
  if (!isoString) return null;
  const date = new Date(isoString);
  if (showDate) {
    return date.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const DataTable = ({ vehicles, rawVehicles, filter: dateFilter }) => {
  const showDate = dateFilter && dateFilter !== 'Today';
  const [filter, setFilter] = useState('All');
  const [sortColumn, setSortColumn] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [tableData, setTableData] = useState([]);

  // Transform API data to table format
  useEffect(() => {
    if (rawVehicles && rawVehicles.length > 0) {
      const transformed = rawVehicles.map(v => {
        const analytics = v.analytics || {};
        // Calculate metrics from analytics data
        const workTimeHours = analytics.workTime ? Math.round((analytics.workTime / 60) * 10) / 10 : 0;
        const fuelConsumed = analytics.fuelConsumption || 0;
        const fuelTheft = analytics.fuelTheft || 0;
        const fuelLevel = analytics.fuel || 0;
        const batteryHealth = analytics.batteryHealth || 0;

        // Format start/stop times — include date when viewing a week/month range
        const startTime = formatGeneratorTime(analytics.generatorStartTime, showDate);
        const stopTime = formatGeneratorTime(analytics.generatorStopTime, showDate);

        // Determine status based on fuel theft and work time
        let status = 'Normal';
        let statusClass = 'normal';
        let iconClass = '';

        if (fuelTheft > 0) {
          status = 'Alert';
          statusClass = 'alert';
          iconClass = 'red';
        } else if (workTimeHours > 0) {
          status = 'Running';
          statusClass = 'running';
          iconClass = 'green';
        } else if (fuelLevel > 0 && fuelLevel < 30) {
          status = 'Low Fuel';
          statusClass = 'warning';
          iconClass = 'amber';
        }

        return {
          id: v?.vehicleId,
          name: v?.vehicleName,
          capacity: 'Generator',
          // Core metrics
          hours: `${workTimeHours} hrs`,
          hoursRaw: workTimeHours,
          fuelUsed: `${fuelConsumed} L`,
          fuelUsedRaw: fuelConsumed,
          fuelTheft: fuelTheft > 0 ? `${fuelTheft} L` : '-',
          fuelTheftRaw: fuelTheft,
          fuelLevel: fuelLevel > 0 ? `${fuelLevel} L` : '-',
          fuelLevelRaw: fuelLevel,
          batteryHealth: batteryHealth > 0 ? `${batteryHealth} mV` : '-',
          batteryHealthRaw: batteryHealth,
          // Time info
          generatorStartTime: startTime,
          generatorStopTime: stopTime,
          dailyRuns: analytics.dailyRuns || [],
          runningTime: analytics.totalEngineHours || 0,
          // Status
          status: status,
          statusClass: statusClass,
          iconClass: iconClass,
          // Refill date based on fuel refilled
          refillDate: analytics.fuelRefilled > 0
            ? new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            : 'No refill today',
        };
      });
      setTableData(transformed);
    } else if (vehicles && vehicles.length > 0) {
      // Use pre-transformed vehicles data from getDashboardData
      const fallback = vehicles.map(v => ({
        id: v.id,
        name: v.name || `Vehicle-${v.id}`,
        capacity: v.type || 'Generator',
        hours: v.workTimeHours ? `${v.workTimeHours} hrs` : (v.hours || '0 hrs'),
        hoursRaw: v.workTimeHours || 0,
        fuelUsed: v.fuelConsumption ? `${v.fuelConsumption} L` : '0 L',
        fuelUsedRaw: v.fuelConsumption || 0,
        fuelTheft: v.fuelTheft > 0 ? `${v.fuelTheft} L` : '-',
        fuelTheftRaw: v.fuelTheft || 0,
        fuelLevel: v.fuelLevel ? `${v.fuelLevel} L` : '-',
        fuelLevelRaw: v.fuelLevel || 0,
        batteryHealth: v.batteryHealth && v.batteryHealth !== '-' ? `${v.batteryHealth} mV` : '-',
        batteryHealthRaw: v.batteryHealth || 0,
        generatorStartTime: formatGeneratorTime(v.generatorStartTimeRaw || v.generatorStartTime, showDate),
        generatorStopTime: formatGeneratorTime(v.generatorStopTimeRaw || v.generatorStopTime, showDate),
        dailyRuns: v.dailyRuns || [],
        refillDate: v.refillDate || 'No refill today',
        status: v.status || 'Normal',
        statusClass: v.statusClass || 'normal',
        iconClass: v.iconClass || ''
      }));
      setTableData(fallback);
    } else {
      // No data available - set empty array
      setTableData([]);
    }
  }, [vehicles, rawVehicles, showDate]);

  const columns = [
    { key: 'name', label: 'Generator', sortable: true },
    { key: 'hoursRaw', label: 'Work Time', sortable: true, displayKey: 'hours' },
    { key: 'fuelUsedRaw', label: 'Fuel Used (L)', sortable: true, displayKey: 'fuelUsed' },
    { key: 'fuelLevelRaw', label: 'Fuel Level (L)', sortable: true, displayKey: 'fuelLevel' },
    { key: 'batteryHealthRaw', label: 'Battery (mV)', sortable: true, displayKey: 'batteryHealth' },
    { key: 'fuelTheftRaw', label: 'Fuel Theft (L)', sortable: true, displayKey: 'fuelTheft' },
    { key: 'refillDate', label: 'Last Activity', sortable: true },
    { key: 'status', label: 'Status', sortable: true }
  ];

  const filterOptions = ['All', 'Normal', 'Running', 'Alert', 'Low Fuel'];

  const handleSort = (columnKey) => {
    const isSortable = columns.find(c => c.key === columnKey)?.sortable;
    if (!isSortable) return;

    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (columnKey) => {
    if (sortColumn !== columnKey) return 'fa-sort';
    return sortDirection === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  };

  const sortedAndFilteredData = () => {
    let result = [...tableData];

    // Filter
    if (filter !== 'All') {
      result = result.filter(row => row.status === filter);
    }

    // Sort
    if (sortColumn) {
      result.sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];

        // Numeric sort for raw values
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
        }

        // String sort
        return sortDirection === 'asc'
          ? aValue?.toString().localeCompare(bValue?.toString())
          : bValue?.toString().localeCompare(aValue?.toString());
      });
    }

    return result;
  };

  const filteredData = sortedAndFilteredData();
  return (
    <div className="table-card">
      <div className="card-header">
        <div className="card-title-section">
          <h3>Fleet Performance Overview</h3>
          <p>Real-time monitoring of all fleet vehicles</p>
        </div>
        <div className="table-filters">
          {filterOptions.map((f) => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
          <button className="filter-btn">
            <i className="fas fa-filter"></i>
          </button>
        </div>
      </div>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{ cursor: col.sortable ? 'pointer' : 'default' }}
                >
                  <span>{col.label}</span>
                  {col.sortable && <i className={`fas ${getSortIcon(col.key)}`}></i>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredData.map((row) => (
              <tr key={row.id}>
                <td>
                  <div className="gen-info">
                    <div className={`gen-icon ${row.iconClass}`}>
                      <i className="fas fa-bolt"></i>
                    </div>
                    <div className="gen-details">
                      <span className="gen-name">{row.name}</span>
                      <span className="gen-id">{row.capacity}</span>
                      {showDate && row.dailyRuns && row.dailyRuns.length > 0
                        ? row.dailyRuns.map((run, idx) => {
                            const dateLabel = new Date(run.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            const start = run.startTime ? new Date(run.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-';
                            const stop  = run.stopTime  ? new Date(run.stopTime).toLocaleTimeString('en-US',  { hour: '2-digit', minute: '2-digit' }) : 'Running';
                            const dur   = run.workTime >= 60
                              ? `${Math.round(run.workTime / 60 * 10) / 10} hrs`
                              : `${Math.round(run.workTime)} min`;
                            return (
                              <span key={idx} className="gen-time">
                                {dateLabel}: {start} – {stop} ({dur})
                              </span>
                            );
                          })
                        : row.generatorStartTime
                          ? <span className="gen-time">{row.generatorStartTime} - {row.generatorStopTime || 'Running'}</span>
                          : null
                      }
                    </div>
                  </div>
                </td>
                <td>
                  <span className="hours">{row.hours}</span>
                </td>
                <td>
                  <span className="fuel-used">{row.fuelUsed}</span>
                </td>
                <td>
                  <span className={`fuel-level ${row.fuelLevelRaw < 30 ? 'low' : ''}`}>
                    {row.fuelLevel}
                  </span>
                </td>
                <td>
                  <span className="battery-health">{row.batteryHealth}</span>
                </td>
                <td>
                  <span className={`fuel-theft ${row.fuelTheftRaw > 0 ? 'alert' : ''}`}>
                    {row.fuelTheft}
                  </span>
                </td>
                <td>
                  <span className="refill-date">{row.refillDate}</span>
                </td>
                <td>
                  <span className={`status-pill ${row.statusClass}`}>{row.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>Showing 1-{filteredData.length} of {tableData.length} vehicles</span>
        <div className="pagination">
          <button className="page-btn" disabled>
            <i className="fas fa-chevron-left"></i>
          </button>
          <button className="page-btn" disabled>
            <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataTable;
