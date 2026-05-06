import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
const Header = ({ filter, setFilter, onExport, dateInfo, alerts }) => {
  const filters = ['Today', 'This Week', 'This Month'];
  const { user, fleetId } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef(null);

  // Debug: Log user data to see available fields
  useEffect(() => {
    if (user) {
      console.log('User data from auth:', user);
      console.log('Available user fields:', Object.keys(user));
    }
  }, [user]);

  // Get user details from auth context or fallback
  const userName = user?.name || user?.username || user?.fullName || 'User';

  const getCompanyName = () => {
    if (user?.fleetName) return user.fleetName;
    if (user?.company) return user.company;
    if (user?.companyName) return user.companyName;
    if (user?.organization) return user.organization;
    if (user?.orgName) return user.orgName;
    if (user?.fleet?.name) return user.fleet.name;
    if (user?.fleet?.fleetName) return user.fleet.fleetName;

    // Use fleetId as fallback
    if (fleetId) return `Fleet ${fleetId}`;

    return 'Company';
  };

  const companyName = getCompanyName();

  // Generate avatar URL with orange background
  const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=ea580c&color=fff&size=128`;

  // Notification click handler
  const handleNotificationClick = () => {
    setShowNotifications(!showNotifications);
  };

  // Close notifications when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };

    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  // Sample notifications - in real app, these would come from props or API
  const notifications = alerts || [
    { id: 1, title: 'Fuel theft detected', message: 'MUL13320263: 248L theft detected', type: 'alert', time: 'Just now' },
    { id: 2, title: 'Low fuel level', message: 'KHAN VILLAGE D/S: 14% remaining', type: 'warning', time: '2 hours ago' },
  ];

  return (
    <header className="dashboard-header">
      <div className="header-left">
        <div className="header-title">
          <h1>Energy Management Portal</h1>
          <p>Track Every Drop, Power Every Moment</p>
        </div>
        <div className="date-display">
          <div className="date-circle">
            <span className="date-day">{dateInfo.day}</span>
          </div>
          <div className="date-info">
            <span className="date-weekday">{dateInfo.weekday}</span>
            <span className="date-month">{dateInfo.month}</span>
          </div>
        </div>
      </div>

      <div className="header-actions">
        <div className="filter-pills">
          {filters.map((f) => (
            <button
              key={f}
              className={`pill ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <button className="btn btn-outline" onClick={onExport}>
          <i className="fas fa-download"></i>
          Export Report
        </button>
      </div>

      <div className="header-right">
        <div className="search-box">
          <i className="fas fa-search"></i>
          <input type="text" placeholder="Search..." />
        </div>
        <div className="notification-wrapper" ref={notificationRef}>
          <button className="icon-btn" onClick={handleNotificationClick}>
            <i className="fas fa-bell"></i>
            {notifications.length > 0 && <span className="badge">{notifications.length}</span>}
          </button>

          {showNotifications && (
            <div className="notification-panel">
              <div className="notification-header">
                <h4>Notifications</h4>
                {notifications.length > 0 && (
                  <button className="mark-all-read" onClick={() => setShowNotifications(false)}>
                    Mark all as read
                  </button>
                )}
              </div>
              <div className="notification-list">
                {notifications.length === 0 ? (
                  <div className="no-notifications">
                    <i className="fas fa-bell-slash"></i>
                    <p>No new notifications</p>
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div key={notification.id} className={`notification-item ${notification.type}`}>
                      <div className="notification-icon">
                        <i className={`fas ${notification.type === 'alert' ? 'fa-exclamation-triangle' : notification.type === 'warning' ? 'fa-gas-pump' : 'fa-info-circle'}`}></i>
                      </div>
                      <div className="notification-content">
                        <h5>{notification.title}</h5>
                        <p>{notification.message}</p>
                        <span className="notification-time">{notification.time}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {notifications.length > 0 && (
                <div className="notification-footer">
                  <button className="view-all-btn" onClick={() => setShowNotifications(false)}>
                    View All Alerts <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="user-profile">
          <img src={avatarUrl} alt={userName} />
          <div className="user-info">
            <span className="user-name">{userName}</span>
            <span className="user-company">{companyName}</span>
          </div>
          <i className="fas fa-chevron-down"></i>
        </div>
      </div>
    </header>
  );
};

export default Header;
