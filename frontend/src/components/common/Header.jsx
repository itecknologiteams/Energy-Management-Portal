import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';

// Closes a popover when the user clicks anywhere outside it
function useClickOutside(ref, open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [ref, open, onClose]);
}

const Header = ({ filter, setFilter, onExport, dateInfo, alerts, onManageAlerts }) => {
  const filters = ['Today', 'This Week', 'This Month', 'Last Month'];
  const { user, fleetId } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const notificationRef = useRef(null);
  const helpRef = useRef(null);

  useClickOutside(notificationRef, showNotifications, () => setShowNotifications(false));
  useClickOutside(helpRef, showHelp, () => setShowHelp(false));

  const userName = user?.name || user?.username || user?.fullName || 'User';
  const companyName = user?.fleetName || user?.company || user?.companyName || user?.organization ||
    user?.orgName || user?.fleet?.name || user?.fleet?.fleetName || (fleetId ? `Fleet ${fleetId}` : 'Company');
  const initials = userName.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'U';

  const notifications = alerts || [];
  const dateText = dateInfo?.weekday ? `${dateInfo.weekday}, ${dateInfo.day} ${dateInfo.month}` : '';
  // Narrower screens get "2 Nov 2026" so the header stays on one line
  const shortDateText = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <header className="ems-ui flex flex-wrap min-[1600px]:flex-nowrap items-center justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 leading-tight whitespace-nowrap">Energy Management Portal</h1>
        <p className="text-sm text-gray-600">by iTecknologi</p>
      </div>

      <div className="flex flex-wrap min-[1600px]:flex-nowrap items-center gap-3">
        {dateText && (
          <span className="inline-flex items-center gap-2 h-12 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-800 shadow-sm whitespace-nowrap">
            <i className="far fa-calendar text-gray-600" aria-hidden="true"></i>
            <span className="hidden min-[1750px]:inline">{dateText}</span>
            <span className="min-[1750px]:hidden">{shortDateText}</span>
          </span>
        )}

        {filter && setFilter && (
          <div className="inline-flex items-center gap-1 h-12 rounded-xl border border-gray-200 bg-white p-1 shadow-sm" role="group" aria-label="Period">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                className={`h-full rounded-lg px-3.5 text-sm font-semibold whitespace-nowrap transition-colors ${filter === f ? 'bg-orange-600 text-white shadow' : 'text-gray-700 hover:bg-orange-50'}`}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {onExport && (
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 h-12 min-w-[3rem] rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 whitespace-nowrap"
            onClick={onExport}
            title="Export Report"
            aria-label="Export Report"
          >
            <i className="fas fa-download" aria-hidden="true"></i>
            <span className="hidden min-[1750px]:inline">Export Report</span>
          </button>
        )}

        <div className="relative" ref={notificationRef}>
          <button
            type="button"
            className="relative w-12 h-12 rounded-full border border-gray-200 bg-white text-lg text-gray-700 shadow-sm hover:bg-gray-50"
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label={`Notifications (${notifications.length})`}
            aria-expanded={showNotifications}
          >
            <i className="fas fa-bell" aria-hidden="true"></i>
            {notifications.length > 0 && (
              <span className="absolute top-1.5 right-2 w-2.5 h-2.5 rounded-full bg-orange-500 ring-2 ring-white"></span>
            )}
          </button>
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-gray-100 bg-white shadow-xl z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <h4 className="text-sm font-bold text-gray-900">Notifications</h4>
                {onManageAlerts && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-orange-600 hover:underline"
                    onClick={() => { setShowNotifications(false); onManageAlerts(); }}
                  >
                    <i className="fas fa-sliders mr-1" aria-hidden="true"></i>Alert settings
                  </button>
                )}
              </div>
              <ul className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {notifications.length === 0 ? (
                  <li className="px-4 py-8 text-center text-sm text-gray-400">
                    <i className="fas fa-bell-slash block text-2xl mb-2" aria-hidden="true"></i>
                    No new notifications
                  </li>
                ) : notifications.map((n) => (
                  <li key={n.id} className="flex gap-3 px-4 py-3">
                    <i className={`fas ${n.icon || 'fa-circle-info'} ${n.iconClass === 'red' ? 'text-red-500' : n.iconClass === 'amber' ? 'text-amber-500' : 'text-orange-500'} mt-0.5`} aria-hidden="true"></i>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{n.title}</p>
                      <p className="text-xs text-gray-600">{n.message || n.description}</p>
                      {n.time && <p className="text-[11px] text-gray-400 mt-0.5">{n.time}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="relative" ref={helpRef}>
          <button
            type="button"
            className="w-12 h-12 rounded-full border border-gray-200 bg-white text-lg text-gray-700 shadow-sm hover:bg-gray-50"
            onClick={() => setShowHelp(!showHelp)}
            aria-label="Help"
            aria-expanded={showHelp}
          >
            <i className="fas fa-question" aria-hidden="true"></i>
          </button>
          {showHelp && (
            <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-gray-100 bg-white p-4 shadow-xl z-50 text-xs text-gray-600 space-y-2">
              <p className="text-sm font-bold text-gray-900">Using the dashboard</p>
              <p><strong>Select Unit</strong> picks the generator every card shows.</p>
              <p><strong>Today / This Week / …</strong> set the period for fuel usage, events and activity.</p>
              <p><strong>Maintenance → Edit schedule</strong> sets the last service and interval, so running hours and due dates can be tracked.</p>
              <p><strong>Bell → Alert settings</strong> sets temperature alerts, by dashboard and email.</p>
              <p>Times are Pakistan time (PKT).</p>
            </div>
          )}
        </div>

        {/* Same rounded box as the date and filter controls */}
        <div className="flex items-center gap-3 h-12 rounded-xl border border-gray-200 bg-white pl-1.5 pr-3.5 shadow-sm flex-shrink-0">
          <span className="w-9 h-9 rounded-lg bg-orange-600 text-white text-sm font-bold flex items-center justify-center" aria-hidden="true">{initials}</span>
          <span className="leading-tight whitespace-nowrap">
            <span className="block text-sm font-bold text-gray-900">{userName}</span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-orange-600">{companyName}</span>
          </span>
          <i className="fas fa-chevron-down text-xs text-gray-500" aria-hidden="true"></i>
        </div>
      </div>
    </header>
  );
};

export default Header;
