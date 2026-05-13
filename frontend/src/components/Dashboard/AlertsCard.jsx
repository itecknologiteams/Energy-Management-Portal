import React from 'react';

const AlertsCard = ({ alerts: apiAlerts }) => {
  // Use API alerts only - no mock data
  const alerts = apiAlerts || [];

  if (alerts.length === 0) return null;

  return (
    <div className="alerts-card">
      <div className="card-header">
        <div className="card-title-section">
          <h3>
            <i className="fas fa-triangle-exclamation"></i>
            Generator Alerts
          </h3>
          <p>Generators requiring attention</p>
        </div>
      </div>
      <div className="alerts-list">
        {alerts.map((alert) => (
          <div key={alert.id} className="alert-item">
            <div className={`alert-icon ${alert.iconClass}`}>
              <i className={`fas ${alert.icon}`}></i>
            </div>
            <div className="alert-content">
              <div className="alert-header">
                <span className="alert-title">{alert.title}</span>
                <span className="alert-time">{alert.time}</span>
              </div>
              {alert.type === 'fuel' ? (
                <div className="alert-progress">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${alert.progress}%` }}></div>
                  </div>
                  <span className="progress-text">{alert.progressText}</span>
                </div>
              ) : alert.type === 'theft' ? (
                <p className="alert-desc alert-theft">{alert.description}</p>
              ) : (
                <p className="alert-desc">{alert.description}</p>
              )}
            </div>
            <button className="alert-action">
              <i className="fas fa-arrow-right"></i>
            </button>
          </div>
        ))}
      </div>
      <button className="view-all-btn">
        View All Alerts
        <i className="fas fa-arrow-right"></i>
      </button>
    </div>
  );
};

export default AlertsCard;
