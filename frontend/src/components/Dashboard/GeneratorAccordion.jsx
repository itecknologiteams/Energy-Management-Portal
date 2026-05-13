/**
 * GeneratorAccordion
 *
 * Enterprise-level accordion for the Fleet Performance Overview section.
 * Designed for React + Tailwind CSS.
 *
 * Usage:
 *   <GeneratorAccordion data={dashboardData.vehicles} filter="This Month" />
 *
 * `data` shape (from getDashboardData / getDashboardDataRange):
 *   [{
 *     id, name, type, status,
 *     hours, hoursRaw, fuelUsed, fuelUsedRaw,
 *     fuelLevel, fuelLevelRaw, fuelTheft, fuelTheftRaw,
 *     batteryHealth, batteryHealthRaw, fuelRefilled,
 *     engineHours, workTimeHours, refillDate,
 *     generatorStartTime, generatorStopTime,
 *     generatorStartTimeRaw, generatorStopTimeRaw,
 *     dailyRuns: [{ date, startTime, stopTime, workTime }]
 *   }]
 */

import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Zap,
  Clock,
  Fuel,
  Droplets,
  Battery,
  ShieldAlert,
  AlertTriangle,
  TrendingUp,
  Timer,
  Activity,
  MapPin,
  CalendarDays,
  CircleDot,
} from 'lucide-react';

// ─── Status configuration ────────────────────────────────────────────────────

const STATUS = {
  Running: {
    badge:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot:     'bg-emerald-500',
    icon:    'bg-emerald-100 text-emerald-600',
    ring:    'ring-emerald-100',
    pulse:   true,
  },
  Active: {
    badge:   'bg-blue-50 text-blue-700 border-blue-200',
    dot:     'bg-blue-400',
    icon:    'bg-blue-100 text-blue-600',
    ring:    'ring-blue-100',
    pulse:   false,
  },
  Alert: {
    badge:   'bg-red-50 text-red-700 border-red-200',
    dot:     'bg-red-500',
    icon:    'bg-red-100 text-red-600',
    ring:    'ring-red-100',
    pulse:   false,
  },
  'Low Fuel': {
    badge:   'bg-amber-50 text-amber-700 border-amber-200',
    dot:     'bg-amber-500',
    icon:    'bg-amber-100 text-amber-600',
    ring:    'ring-amber-100',
    pulse:   false,
  },
  Normal: {
    badge:   'bg-gray-100 text-gray-500 border-gray-200',
    dot:     'bg-gray-400',
    icon:    'bg-gray-100 text-gray-500',
    ring:    'ring-gray-100',
    pulse:   false,
  },
};

function getStatus(status) {
  return STATUS[status] || STATUS.Normal;
}

// ─── Small reusable pieces ───────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = getStatus(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot} ${s.pulse ? 'animate-pulse' : ''}`} />
      {status}
    </span>
  );
}

function MetricChip({ icon: Icon, label, value, variant = 'default' }) {
  const variants = {
    default: 'bg-gray-50 border-gray-100 text-gray-800',
    danger:  'bg-red-50  border-red-100  text-red-700',
    info:    'bg-blue-50 border-blue-100 text-blue-700',
  };
  const iconVariants = {
    default: 'text-gray-400',
    danger:  'text-red-400',
    info:    'text-blue-400',
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${variants[variant]}`}>
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconVariants[variant]}`} />
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400 leading-none mb-0.5">{label}</p>
        <p className={`text-sm font-semibold leading-none ${variant === 'danger' ? 'text-red-700' : 'text-gray-800'}`}>
          {value || '—'}
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ icon: Icon, text, color = 'text-gray-600' }) {
  return (
    <div className="flex items-center gap-1.5 mb-3">
      <Icon className={`w-4 h-4 ${color}`} />
      <span className={`text-sm font-semibold ${color}`}>{text}</span>
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

function DailyRunTimeline({ runs, startTimeFormatted, stopTimeFormatted }) {
  // For "Today" view there are no dailyRuns — show the single session instead
  if (!runs || runs.length === 0) {
    if (startTimeFormatted && startTimeFormatted !== '-') {
      return (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
          <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
          <div>
            <p className="text-sm font-medium text-blue-700">Today's session</p>
            <p className="text-xs text-blue-500 mt-0.5">
              {startTimeFormatted} {stopTimeFormatted && stopTimeFormatted !== '-' ? `– ${stopTimeFormatted}` : '→ Running'}
            </p>
          </div>
        </div>
      );
    }
    return (
      <p className="text-sm text-gray-400 italic py-2 px-1">No activity recorded for this period</p>
    );
  }

  return (
    <div className="relative">
      {/* Vertical connector */}
      <div className="absolute left-[7px] top-4 bottom-4 w-px bg-gray-200" aria-hidden="true" />

      <ul className="space-y-2">
        {runs.map((run, idx) => {
          // Use run.date (the UTC query date) as the day label — it corresponds
          // to which TrackData table the data came from and is the stable anchor.
          // Using startTime's PKT date caused phantom "Apr 23" entries when a
          // run ending at e.g. UTC 19:49 (= PKT 00:49 next day) had its startTime
          // roll over PKT midnight while the data was still from the Apr-22 table.
          const dateLabel = (() => {
            try {
              return new Date(run.date + 'T00:00:00').toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
              });
            } catch {
              return run.date;
            }
          })();

          const fmt = (iso) => {
            try {
              // DB stores PKT naive datetimes; the server (UTC) reads them as UTC,
              // so display as UTC to recover the original PKT stored value.
              return new Date(iso).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
              });
            } catch {
              return iso;
            }
          };

          // "Still running" only applies to today's data. Historical entries
          // where the data window ended while running show the last known time.
          const todayStr = new Date().toISOString().split('T')[0];
          const isLive   = !!run.isOpen && run.date === todayStr;
          const start    = run.isCarryover ? '←' : run.startTime ? fmt(run.startTime) : '–';
          const stop     = isLive ? 'Still running' : run.stopTime ? fmt(run.stopTime) : '–';
          const workMins = run.workTime || 0;
          const dur      = workMins >= 60
            ? `${Math.round(workMins / 60 * 10) / 10} hrs`
            : workMins > 0 ? `${Math.round(workMins)} min` : '–';
          const fuelUnknown = false;
          const fuelL = workMins > 0 && (run.fuelConsumption || 0) > 0 ? run.fuelConsumption : null;

          // Detect when the session crosses local (PKT) midnight — stop is on a
          // different calendar day than start. Without this indicator the display
          // shows e.g. "06:13 AM – 01:31 AM" which looks reversed.
          const crossesMidnight = !isLive && !run.isCarryover && run.startTime && run.stopTime && run.stopTime !== run.startTime && (() => {
            const startDay = new Date(run.startTime).toLocaleDateString('en-US', { timeZone: 'UTC' });
            const stopDay  = new Date(run.stopTime).toLocaleDateString('en-US', { timeZone: 'UTC' });
            return startDay !== stopDay;
          })();

          return (
            <li key={idx} className="flex items-start gap-3 pl-1">
              {/* Timeline dot */}
              <div className={`relative z-10 w-3 h-3 rounded-full border-2 flex-shrink-0 mt-1.5 ${
                isLive
                  ? 'bg-emerald-500 border-emerald-300 shadow-sm shadow-emerald-200'
                  : run.isCarryover
                    ? 'bg-blue-100 border-blue-300'
                    : 'bg-white border-gray-300'
              }`} />

              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium text-gray-700">{dateLabel}</span>
                    {run.isCarryover && (
                      <span className="text-[10px] font-medium text-blue-500 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full leading-none flex-shrink-0" title="Run started before this day">
                        cont.
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {fuelL != null && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100">
                        {fuelL} L
                      </span>
                    )}
                    {fuelUnknown && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200" title="Fuel sensor data unavailable for this day">
                        ? L
                      </span>
                    )}
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isLive
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {dur}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {start}
                  {isLive ? ' → ' : ' – '}
                  {stop}
                  {crossesMidnight && (
                    <span className="ml-1.5 inline-flex items-center text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full leading-none">
                      +1 day
                    </span>
                  )}
                </p>
                {run.batteryHealth != null && (
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    <span className="font-medium text-gray-500">Battery:</span>{' '}
                    {run.batteryHealth >= 1000 ? `${(run.batteryHealth / 1000).toFixed(1)} V` : `${run.batteryHealth} mV`}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── Event cards ─────────────────────────────────────────────────────────────

function RefillCard({ amount, date, filter }) {
  const label = date || filter || 'Recorded';
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
      <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
        <TrendingUp className="w-4 h-4 text-blue-600" />
      </div>
      <div>
        <p className="text-sm font-semibold text-blue-700">+{amount} L refilled</p>
        <p className="text-xs text-blue-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function TheftCard({ amount, at }) {
  const when = at
    ? new Date(at).toLocaleString('en-PK', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
    : null;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
      <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
        <AlertTriangle className="w-4 h-4 text-red-600" />
      </div>
      <div>
        <p className="text-sm font-semibold text-red-700">{amount} L unaccounted loss</p>
        <p className="text-xs text-red-400 mt-0.5">
          {when ? `Detected ${when} — generator was OFF` : 'Detected while generator was OFF'}
        </p>
      </div>
    </div>
  );
}

function EngineStats({ engineHours, workTimeHours }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Engine Hours</p>
        <p className="text-sm font-semibold text-gray-700">{engineHours ?? '—'} hrs</p>
      </div>
      <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
        <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">Work Time</p>
        <p className="text-sm font-semibold text-gray-700">{workTimeHours ?? '—'} hrs</p>
      </div>
    </div>
  );
}

// ─── Animated expand panel ───────────────────────────────────────────────────

function ExpandPanel({ isOpen, children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!ref.current) return;
    if (isOpen) {
      // Measure after paint so children are fully rendered
      const id = requestAnimationFrame(() => {
        setHeight(ref.current?.scrollHeight ?? 0);
      });
      return () => cancelAnimationFrame(id);
    } else {
      setHeight(0);
    }
  }, [isOpen]);

  return (
    <div
      style={{ height, overflow: 'hidden', transition: 'height 280ms cubic-bezier(0.4, 0, 0.2, 1)' }}
    >
      <div ref={ref}>{children}</div>
    </div>
  );
}

// ─── Single accordion item ───────────────────────────────────────────────────

function AccordionItem({ item, isOpen, onToggle, filter }) {
  const s = getStatus(item.status);

  // Normalise numeric fields — the transformed shape may pass strings like "437 L"
  const parse = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v.replace(/[^\d.]/g, '')) || 0;
    return 0;
  };

  const theft    = parse(item.fuelTheftRaw ?? item.fuelTheft);
  const refilled = parse(item.fuelRefilled);
  const engHrs   = item.engineHours ?? item.runningTime ?? 0;
  const workHrs  = item.workTimeHours ?? 0;

  // Format values that arrive as raw numbers — add units for display
  const fuelLevelDisplay = item.fuelLevel != null && item.fuelLevel !== '-'
    ? (typeof item.fuelLevel === 'number' ? `${item.fuelLevel} L` : item.fuelLevel)
    : '—';
  const batteryDisplay = item.batteryHealth != null
    ? `${(item.batteryHealth / 1000).toFixed(1)} V`
    : '—';

  const hasDailyRuns = Array.isArray(item.dailyRuns) && item.dailyRuns.length > 0;
  const hasEvents    = theft > 0 || refilled > 0;

  return (
    <div
      className={`
        rounded-2xl bg-white border transition-all duration-200
        ${isOpen
          ? 'border-blue-200 shadow-md ring-1 ring-blue-50'
          : 'border-gray-200 shadow-sm hover:border-gray-300 hover:shadow-md'
        }
      `}
    >
      {/* ── Header ── */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 rounded-2xl"
      >
        <div className="flex items-center gap-3 p-4">
          {/* Status icon */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.icon}`}>
            <Zap className="w-5 h-5" />
          </div>

          {/* Name + type */}
          <div className="flex-shrink-0 w-44 min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate leading-tight">{item.name}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-400 truncate">{item.type || 'Generator'}</span>
            </div>
          </div>

          {/* Status badge */}
          <div className="flex-shrink-0">
            <StatusBadge status={item.status} />
          </div>

          {/* Metric chips — hidden on small screens */}
          <div className="hidden sm:flex items-center gap-2 flex-1 justify-end flex-wrap">
            <MetricChip icon={Clock}    label="Work Time"  value={item.hours || `${workHrs} hrs`} />
            {!item.noFuelSensor && <MetricChip icon={Fuel}     label="Fuel Used"  value={item.fuelUsed || (item.fuelConsumption != null ? `${item.fuelConsumption} L` : '—')} />}
            {!item.noFuelSensor && <MetricChip icon={Droplets} label="Fuel Level" value={fuelLevelDisplay} />}
            <MetricChip icon={Battery}  label="Battery"    value={batteryDisplay} />
            {theft > 0 && (
              <MetricChip icon={ShieldAlert} label="Theft"
                value={typeof item.fuelTheft === 'string' ? item.fuelTheft : `${theft} L`}
                variant="danger" />
            )}
          </div>

          {/* Chevron */}
          <ChevronDown
            className={`w-5 h-5 text-gray-400 flex-shrink-0 ml-2 transition-transform duration-280 ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>

        {/* Mobile-only metric row */}
        <div className="flex sm:hidden items-center gap-2 px-4 pb-3 flex-wrap">
          <MetricChip icon={Clock}    label="Work"    value={item.hours || `${workHrs} hrs`} />
          {!item.noFuelSensor && <MetricChip icon={Droplets} label="Fuel" value={fuelLevelDisplay} />}
          <MetricChip icon={Battery}  label="Battery" value={batteryDisplay} />
          {theft > 0 && (
            <MetricChip icon={ShieldAlert} label="Theft"
              value={`${theft} L`} variant="danger" />
          )}
        </div>
      </button>

      {/* ── Expanded body ── */}
      <ExpandPanel isOpen={isOpen}>
        <div className="border-t border-gray-100 px-4 pb-5 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Left — Activity timeline */}
            <div>
              <SectionLabel icon={Activity} text="Activity Timeline" color="text-blue-600" />
              <DailyRunTimeline
                runs={hasDailyRuns ? item.dailyRuns : []}
                startTimeFormatted={item.generatorStartTime}
                stopTimeFormatted={item.generatorStopTime}
              />
            </div>

            {/* Right — Events & stats */}
            <div className="space-y-4">

              {/* Fuel events */}
              {hasEvents && (
                <div>
                  <SectionLabel icon={CalendarDays} text="Events" color="text-gray-600" />
                  <div className="space-y-2">
                    {refilled > 0 && (
                      <RefillCard amount={refilled} date={item.refillDate} filter={filter} />
                    )}
                    {theft > 0 && (
                      <TheftCard amount={theft} at={item.fuelTheftAt} />
                    )}
                  </div>
                </div>
              )}

              {/* Engine stats */}
              <div>
                <SectionLabel icon={Timer} text="Engine Stats" color="text-gray-600" />
                <EngineStats engineHours={engHrs} workTimeHours={workHrs} />
              </div>

              {/* All-clear */}
              {!hasEvents && workHrs === 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <CircleDot className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  <p className="text-sm text-gray-400">No activity or alerts for this period</p>
                </div>
              )}
            </div>

          </div>
        </div>
      </ExpandPanel>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

/**
 * @param {{ data: object[], filter?: string }} props
 * `filter` is forwarded from the dashboard ("Today" | "This Week" | "This Month").
 */
export default function GeneratorAccordion({ data = [], filter }) {
  const [openId, setOpenId] = useState(null);

  const toggle = (id) =>
    setOpenId((prev) => (prev === id ? null : id));

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Zap className="w-12 h-12 text-gray-200 mb-3" />
        <p className="text-sm text-gray-400">No generator data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((item) => (
        <AccordionItem
          key={item.id ?? item.vehicleId}
          item={item}
          isOpen={openId === (item.id ?? item.vehicleId)}
          onToggle={() => toggle(item.id ?? item.vehicleId)}
          filter={filter}
        />
      ))}
    </div>
  );
}
