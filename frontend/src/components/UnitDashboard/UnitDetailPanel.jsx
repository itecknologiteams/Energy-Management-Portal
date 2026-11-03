import React from 'react';
import { Card, CardTitle, StatBox, Pill } from './ui';
import OperatingConditions from './OperatingConditions';
import { maintenanceStatus, formatDueDate, daysLeftText } from './maintenanceStatus';
import { currentFuel, fuelCapacity, unitStatus, fmt1, fmt2, fmtHours, formatTrackingTime, formatAgo } from '../../utils/unitData';

const EVENT_LABEL = { refuel: 'Refuel', theft: 'Fuel theft', drop: 'Fuel drop', consumption: 'Consumed while running' };

const MaintenanceView = ({ unit, maintenance, loading, onEdit }) => {
  const ms = maintenanceStatus(maintenance);
  const configured = maintenance && maintenance.status !== 'not_configured';
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <StatBox
          icon="fa-clock"
          label="Total Running Hours"
          value={maintenance?.totalHours != null ? fmtHours(maintenance.totalHours) : '—'}
          unit={maintenance?.totalHours != null ? 'hrs' : null}
          sub={`↑ +${fmt1(maintenance?.hoursToday ?? 0)} hrs (Today)`}
          subTone="green"
        />
        <StatBox
          icon="fa-calendar-days"
          label="Maintenance Due Date"
          value={formatDueDate(maintenance?.dueDate)}
          pill={maintenance?.daysLeft != null && (
            <Pill tone={maintenance.daysLeft < 0 ? 'red' : maintenance.daysLeft <= 7 ? 'amber' : 'orange'}>{daysLeftText(maintenance.daysLeft)}</Pill>
          )}
        />
        <StatBox
          icon="fa-gear"
          label="Next Service"
          value={maintenance?.nextServiceHours != null ? fmtHours(maintenance.nextServiceHours) : '—'}
          unit={maintenance?.nextServiceHours != null ? 'hrs' : null}
          sub={maintenance?.hoursLeft != null ? `(${fmtHours(Math.abs(maintenance.hoursLeft))} hrs ${maintenance.hoursLeft < 0 ? 'over' : 'left'})` : null}
          pill={configured && <Pill tone={ms.tone} icon="fa-circle-check">{ms.short}</Pill>}
        />
      </div>
      {!configured && !loading && (
        <p className="text-xs text-gray-500 mt-2">
          No service schedule yet.{' '}
          <button type="button" className="font-semibold text-orange-600 hover:underline" onClick={onEdit}>Set it up</button>{' '}
          to track running hours and due dates.
        </p>
      )}
    </>
  );
};

const OverviewView = ({ unit }) => {
  const status = unitStatus(unit);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
      <StatBox icon="fa-power-off" label="Status" value={status.label} sub={unit?.dailyRuns?.length ? `${unit.dailyRuns.length} run(s) in period` : 'No runs in period'} />
      <StatBox icon="fa-satellite-dish" label="Last Reading" value={formatAgo(unit?.lastReadingAt)} sub={formatTrackingTime(unit?.lastReadingAt)} />
      <StatBox icon="fa-hourglass-half" label="Work Time (period)" value={fmt1(unit?.workTimeHours ?? 0)} unit="hrs" />
    </div>
  );
};

const FuelView = ({ unit }) => {
  const fuel = currentFuel(unit);
  const capacity = fuelCapacity(unit);
  const events = [...(unit?.fuelEvents || [])].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 3);
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <StatBox label="Current Level" value={fuel === null ? '—' : fmt2(fuel)} unit={fuel === null ? null : 'L'} sub={capacity ? `of ${fmt2(capacity)} L` : null} />
        <StatBox label="Used (period)" value={fmt1(unit?.fuelConsumption ?? 0)} unit="L" />
        <StatBox label="Refuelled (period)" value={fmt1(unit?.fuelRefilled ?? 0)} unit="L" />
        <StatBox label="Theft (period)" value={fmt1(unit?.fuelTheft ?? 0)} unit="L" />
      </div>
      <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100">
        {events.length === 0 ? (
          <li className="px-3.5 py-2.5 text-xs text-gray-500">No fuel events in this period.</li>
        ) : events.map((e, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
            <span className="font-medium text-gray-800">
              {EVENT_LABEL[e.type] || e.type} <span className={e.type === 'refuel' ? 'text-green-600' : 'text-red-600'}>{e.type === 'refuel' ? '+' : '−'}{fmt1(e.amount)} L</span>
            </span>
            <span className="text-xs text-gray-500">{formatTrackingTime(e.at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
};

const TITLES = { overview: 'Overview', fuel: 'Fuel Status', maintenance: 'Maintenance' };
const SUBTITLES = {
  overview: 'Live status and readings for this unit.',
  fuel: 'Fuel level, usage and events for the selected period.',
  maintenance: 'Service status, schedules, and key operational alerts.',
};
const ICONS = { overview: 'fa-chart-simple', fuel: 'fa-gas-pump', maintenance: 'fa-wrench' };

/**
 * The card beside the fuel tank. Its upper part follows the selected tab;
 * the live operating conditions are always shown below.
 */
const UnitDetailPanel = ({ tab, unit, maintenance, maintenanceLoading, onEditMaintenance, temperatureAlert }) => (
  <Card className="p-5 h-full">
    <CardTitle
      icon={ICONS[tab]}
      title={`${TITLES[tab]} – ${unit?.name || '—'}`}
      subtitle={SUBTITLES[tab]}
      right={tab === 'maintenance' && (
        <button type="button" className="btn btn-outline btn-sm whitespace-nowrap" onClick={onEditMaintenance}>
          <i className="fas fa-pen" aria-hidden="true"></i> Edit schedule
        </button>
      )}
    />

    {tab === 'maintenance' && <MaintenanceView unit={unit} maintenance={maintenance} loading={maintenanceLoading} onEdit={onEditMaintenance} />}
    {tab === 'overview' && <OverviewView unit={unit} />}
    {tab === 'fuel' && <FuelView unit={unit} />}

    <h4 className="text-sm font-bold text-gray-900 mt-5 mb-3">Operating Conditions (Live)</h4>
    <OperatingConditions unit={unit} hoursToday={maintenance?.hoursToday} temperatureAlert={temperatureAlert} />
  </Card>
);

export default UnitDetailPanel;
