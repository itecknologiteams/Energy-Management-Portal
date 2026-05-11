import React from 'react';

const Sidebar = ({ activeItem, onLogout, onNavigate }) => {
  const menuItems = [
    { id: 'dashboard', icon: 'fa-th-large', label: 'Dashboard' },
    { id: 'analytics', icon: 'fa-chart-line', label: 'Analytics' },
    { id: 'fuel-logs', icon: 'fa-clipboard-list', label: 'Reports' }
  ];

  const handleNavClick = (itemId, e) => {
    e.preventDefault();
    if (onNavigate && (itemId === 'dashboard' || itemId === 'analytics' || itemId === 'fuel-logs')) {
      onNavigate(itemId);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <img src="2.png" alt="iTecknologi" className="logo-img" />
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <span className="nav-label">MENU</span>
          <ul className="nav-list">
            {menuItems.map((item) => (
              <li key={item.id} className={`nav-item ${activeItem === item.id ? 'active' : ''}`}>
                <a href="#" onClick={(e) => handleNavClick(item.id, e)}>
                  <i className={`fas ${item.icon}`}></i>
                  <span>{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>


      </nav>

      <div className="logout-section">
        <button className="logout-btn" onClick={onLogout}>
          <i className="fas fa-right-from-bracket"></i>
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
