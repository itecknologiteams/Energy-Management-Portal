import React from 'react';

const KPICards = ({ data, filter }) => {
  const periodLabel = filter === 'This Week' ? 'This week' : filter === 'This Month' ? 'This month' : 'Today';

  const kpiData = [
    {
      id: 1,
      icon: 'fa-gas-pump',
      iconClass: 'fuel-icon',
      label: 'Total Fuel Consumed',
      value: data?.totalFuelConsumed?.toLocaleString() || '0',
      unit: 'Ltrs',
      change: `${periodLabel}'s total`,
      changeType: 'neutral',
      changeIcon: 'fa-minus'
    },
    {
      id: 2,
      icon: 'fa-clock',
      iconClass: 'efficiency-icon',
      label: 'Total Work Time',
      value: data?.totalWorkTime?.toFixed(1) || '0',
      unit: 'hrs',
      change: `All generators — ${periodLabel}`,
      changeType: 'neutral',
      changeIcon: 'fa-minus'
    },
    {
      id: 3,
      icon: 'fa-bolt',
      iconClass: 'active-icon',
      label: 'Active Generators',
      value: data?.activeVehicles?.toString() || '0',
      unit: '',
      change: `of ${data?.totalVehicles || 0} total`,
      changeType: 'neutral',
      changeIcon: 'fa-minus'
    },
    {
      id: 4,
      icon: 'fa-battery-full',
      iconClass: 'cost-icon',
      label: 'Avg Battery Health',
      value: data?.batteryHealth?.toLocaleString() || '0',
      unit: 'mV',
      change: 'Fleet average',
      changeType: 'neutral',
      changeIcon: 'fa-minus',
      isCustom: true
    }
  ];

  return (
    <div className="kpi-section">
      {kpiData.map((kpi) => (
        <div key={kpi.id} className="kpi-card">
          <div className={`kpi-icon ${kpi.iconClass}`}>
            {kpi.isCustom ? (
              <i className={`fas ${kpi.icon}`}></i>
            ) : (
              <i className={`fas ${kpi.icon}`}></i>
            )}
          </div>
          <div className="kpi-content">
            <span className="kpi-label">{kpi.label}</span>
            <div className="kpi-value-row">
              <span className="kpi-value">{kpi.value}</span>
              {kpi.unit && <span className="kpi-unit">{kpi.unit}</span>}
            </div>
            <span className={`kpi-change ${kpi.changeType}`}>
              <i className={`fas ${kpi.changeIcon}`}></i>
              {kpi.change}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default KPICards;
