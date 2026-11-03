import React, { useState } from 'react';
import { Card, CardTitle, Pill } from './ui';
import { formatTrackingTime, fmt1 } from '../../utils/unitData';
import { describeAlert } from '../../hooks/useTemperatureAlerts';
import { formatDueDate } from './maintenanceStatus';

const COLLAPSED = 4;
const EXPANDED = 25;

const ICON = {
  warning: { icon: 'fa-triangle-exclamation', className: 'text-amber-500' },
  critical: { icon: 'fa-circle-exclamation', className: 'text-red-500' },
  info: { icon: 'fa-circle-info', className: 'text-blue-500' },
  done: { icon: 'fa-check', className: 'text-green-600' },
};
const BADGE = {
  warning: <Pill tone="amber">Warning</Pill>,
  critical: <Pill tone="red">Critical</Pill>,
  info: <Pill tone="blue">Info</Pill>,
  done: <Pill tone="green">Resolved</Pill>,
};

/** Everything worth listing for one unit, newest first. */
function activityFor(unit, temperatureAlerts, maintenance) {
  const items = [];

  temperatureAlerts
    .filter((a) => a.vehicleId === unit.id)
    .forEach((a) => items.push({ kind: 'critical', title: 'High Temperature', detail: describeAlert(a), at: a.at }));

  (unit.fuelEvents || []).forEach((e) => {
    if (e.type === 'theft') items.push({ kind: 'critical', title: `Fuel Theft −${fmt1(e.amount)} L`, at: e.at });
    else if (e.type === 'drop') items.push({ kind: 'warning', title: `Fuel Drop −${fmt1(e.amount)} L`, at: e.at });
    else if (e.type === 'refuel') items.push({ kind: 'done', title: `Refuelled +${fmt1(e.amount)} L`, at: e.at });
  });

  (unit.dailyRuns || []).forEach((r) => {
    if (r.startTime) items.push({ kind: r.isOpen ? 'info' : 'done', title: 'Unit Started', at: r.startTime });
    if (r.stopTime && !r.isOpen) items.push({ kind: 'done', title: 'Unit Stopped', at: r.stopTime });
  });

  if (maintenance?.status === 'overdue' || maintenance?.status === 'due_soon') {
    items.push({
      kind: maintenance.status === 'overdue' ? 'warning' : 'info',
      title: maintenance.status === 'overdue' ? 'Service Overdue' : 'Maintenance Reminder',
      detail: `Due ${formatDueDate(maintenance.dueDate)}`,
      // Keep it at the top: it is about now, not a past event
      at: null,
    });
  }

  return items
    .map((it) => ({ ...it, unitName: unit.name }))
    .sort((a, b) => (a.at === null ? -1 : b.at === null ? 1 : new Date(b.at) - new Date(a.at)));
}

/**
 * Recent alerts and activity — the selected unit's by default, every
 * unit's with "View All".
 */
const RecentActivity = ({ unit, units, temperatureAlerts = [], maintenance }) => {
  const [showAll, setShowAll] = useState(false);
  const source = showAll ? units : unit ? [unit] : [];
  const items = source
    .flatMap((u) => activityFor(u, temperatureAlerts, u.id === unit?.id ? maintenance : null))
    .sort((a, b) => (a.at === null ? -1 : b.at === null ? 1 : new Date(b.at) - new Date(a.at)))
    .slice(0, showAll ? EXPANDED : COLLAPSED);

  return (
    <Card className="p-5 h-full flex flex-col">
      <CardTitle
        icon="fa-bell"
        title="Recent Alerts / Activity"
        right={(
          <button type="button" className="text-xs font-semibold text-orange-600 hover:underline whitespace-nowrap" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show Less' : 'View All'} <i className={`fas ${showAll ? 'fa-arrow-up' : 'fa-arrow-right'} ml-0.5`} aria-hidden="true"></i>
          </button>
        )}
      />
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 mt-6 text-center">No alerts or activity in this period</p>
      ) : (
        <ul className={`mt-3 divide-y divide-gray-100 ${showAll ? 'overflow-y-auto max-h-80 pr-1' : ''}`}>
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-3 py-2.5">
              <i className={`fas ${ICON[it.kind].icon} ${ICON[it.kind].className} mt-1 w-4 text-center`} aria-hidden="true"></i>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{it.title}</p>
                <p className="text-[11px] text-gray-500 truncate">
                  {it.unitName}
                  {it.detail && ` · ${it.detail}`}
                  {it.at && ` · ${formatTrackingTime(it.at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                </p>
              </div>
              {BADGE[it.kind]}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

export default RecentActivity;
