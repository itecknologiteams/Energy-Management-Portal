import React from 'react';
import GeneratorIllustration from './GeneratorIllustration';
import { Card, IconTile, Pill } from './ui';
import { maintenanceStatus, formatDueDate } from './maintenanceStatus';
import { currentFuel, fuelCapacity, unitStatus, fmt1, fmt2, fmtHours } from '../../utils/unitData';

/**
 * Top strip: unit picker, the selected unit's name/model/status, and the
 * Fuel Status, Total Running Hours and Maintenance Status cards.
 */
const UnitSummaryBar = ({ units, unit, onSelectUnit, maintenance, onSetUpMaintenance }) => {
  const fuel = currentFuel(unit);
  const capacity = fuelCapacity(unit);
  const percent = fuel !== null && capacity ? Math.min(100, (fuel / capacity) * 100) : null;
  const status = unitStatus(unit);
  const ms = maintenanceStatus(maintenance);

  return (
    <Card className="p-4 lg:p-5">
      {/* Below 1440px the KPI cards get their own row so nothing truncates */}
      <div className="grid grid-cols-1 min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 items-center">
        {/* Picker + unit identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          <label className="block">
            <span className="block text-sm font-bold text-gray-900 mb-2">Select Unit</span>
            <span className="relative block">
              <i className="fas fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none" aria-hidden="true"></i>
              <select
                className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-9 text-sm font-semibold text-gray-900 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100"
                value={unit?.id ?? ''}
                onChange={(e) => onSelectUnit(Number(e.target.value))}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <i className="fas fa-chevron-down absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none" aria-hidden="true"></i>
            </span>
          </label>

          <div className="flex items-center gap-3 sm:border-l sm:border-gray-100 sm:pl-5 min-w-0">
            <GeneratorIllustration className="w-20 h-14 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-base font-bold text-gray-900 truncate">{unit?.name || '—'}</p>
              <p className="text-xs text-gray-500 truncate">{maintenance?.settings?.model || 'Generator'}</p>
              <span className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.pill}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`}></span>
                {status.label}
              </span>
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center gap-2.5">
              <IconTile icon="fa-gas-pump" size="sm" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-gray-700 whitespace-nowrap">Fuel Status</p>
                <p className="text-xl font-bold text-gray-900 leading-tight">{percent === null ? '—' : `${fmt1(percent)}%`}</p>
                <p className="text-[11px] text-gray-500 truncate">
                  {fuel === null ? 'No fuel reading' : `${fmt2(fuel)} L${capacity ? ` / ${fmt2(capacity)} L` : ''}`}
                </p>
              </div>
            </div>
            <div className="mt-2.5 h-2 rounded-full bg-gray-100 overflow-hidden" role="progressbar" aria-valuenow={percent ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Fuel level">
              <div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${percent ?? 0}%` }}></div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-3 flex items-center gap-2.5">
            <IconTile icon="fa-clock" size="sm" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-gray-700 whitespace-nowrap">Total Running Hours</p>
              {maintenance?.totalHours != null ? (
                <p className="text-xl font-bold text-gray-900 leading-tight whitespace-nowrap">
                  {fmtHours(maintenance.totalHours)} <span className="text-sm font-semibold">hrs</span>
                </p>
              ) : (
                <button type="button" onClick={onSetUpMaintenance} className="text-sm font-semibold text-orange-600 hover:underline whitespace-nowrap">
                  Set hour meter
                </button>
              )}
              <p className="text-[11px] font-medium text-green-600 whitespace-nowrap">
                <i className="fas fa-arrow-up mr-1" aria-hidden="true"></i>
                +{fmt1(maintenance?.hoursToday ?? 0)} hrs (Today)
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 p-3 flex items-center gap-2.5">
            <IconTile icon="fa-wrench" size="sm" />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-gray-700 whitespace-nowrap">Maintenance Status</p>
              {maintenance?.status === 'not_configured' || !maintenance ? (
                <button type="button" onClick={onSetUpMaintenance} className="text-sm font-semibold text-orange-600 hover:underline whitespace-nowrap">
                  Set up schedule
                </button>
              ) : (
                <>
                  <Pill tone={ms.tone} className="mt-0.5 text-sm px-3 py-0.5">{ms.label}</Pill>
                  <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                    Next Service: {formatDueDate(maintenance.dueDate)}
                    {maintenance.daysLeft != null && ` (${maintenance.daysLeft < 0 ? `${-maintenance.daysLeft} days late` : `${maintenance.daysLeft} days`})`}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default UnitSummaryBar;
