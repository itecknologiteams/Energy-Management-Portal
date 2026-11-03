import React from 'react';
import { Pill } from './ui';
import { fmt1, fmt2, formatAgo, minutesSince, OFFLINE_AFTER_MINUTES } from '../../utils/unitData';

// The gauge spans 0–100 °C; its colour bands run green → red
const GAUGE_MAX_C = 100;
const BANDS = ['#22c55e', '#84cc16', '#facc15', '#f97316', '#ef4444'];

// Supply voltage outside this range is flagged
const BATTERY_LOW_V = 11.5;
const BATTERY_HIGH_V = 14.8;
const BACKUP_LOW_V = 3.7;

const polar = (cx, cy, r, deg) => {
  const rad = (Math.PI / 180) * deg;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
};

// Arc from angle a to b (degrees, 180 = left, 360 = right) as a stroke path
const arc = (cx, cy, r, a, b) => {
  const [x1, y1] = polar(cx, cy, r, a);
  const [x2, y2] = polar(cx, cy, r, b);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
};

const TemperatureGauge = ({ value, alert }) => {
  const cx = 90, cy = 88, r = 70;
  const share = value === null ? 0 : Math.max(0, Math.min(1, value / GAUGE_MAX_C));
  const angle = 180 + share * 180;
  const [nx, ny] = polar(cx, cy, r - 18, angle);
  const gap = 2;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 104" className="w-36 h-auto" role="img" aria-label={value === null ? 'Temperature unknown' : `Temperature ${fmt1(value)} °C`}>
        {BANDS.map((color, i) => (
          <path
            key={color}
            d={arc(cx, cy, r, 180 + i * 36 + gap / 2, 180 + (i + 1) * 36 - gap / 2)}
            stroke={color}
            strokeWidth="14"
            fill="none"
            strokeLinecap="butt"
          />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => {
          const [x1, y1] = polar(cx, cy, r - 12, 180 + i * 18);
          const [x2, y2] = polar(cx, cy, r - 17, 180 + i * 18);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9ca3af" strokeWidth="1.5" />;
        })}
        {/* Thermometer mark above the hub */}
        <g transform={`translate(${cx} ${cy - 40})`} fill="none" stroke="#4b5563" strokeWidth="1.8">
          <path d="M -2.5 -8 a 2.5 2.5 0 0 1 5 0 v 9 a 4.5 4.5 0 1 1 -5 0 Z" />
          <circle cx="0" cy="4.6" r="2.2" fill="#ef4444" stroke="none" />
        </g>
        {value !== null && (
          <>
            <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#1f2937" strokeWidth="4" strokeLinecap="round" />
            <circle cx={cx} cy={cy} r="7" fill="#1f2937" />
          </>
        )}
      </svg>
      <p className="text-2xl font-bold text-gray-900 -mt-1">{value === null ? '—' : `${fmt1(value)} °C`}</p>
      <Pill tone={value === null ? 'gray' : alert ? 'red' : 'green'} className="mt-1">
        {value === null ? 'No Reading' : alert ? 'High' : 'Normal'}
      </Pill>
    </div>
  );
};

// Bordered box as in the design: icon beside label and value, status pill
// at the foot of the box
const ConditionCard = ({ icon, label, value, status }) => (
  <div className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 shadow-sm flex flex-col gap-2 min-w-0 h-full">
    <div className="flex items-start gap-2">
      <i className={`fas ${icon} text-orange-600 text-lg mt-0.5 w-5 text-center flex-shrink-0`} aria-hidden="true"></i>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-gray-600 leading-tight whitespace-nowrap">{label}</p>
        <p className="text-base font-bold text-gray-900 leading-tight whitespace-nowrap mt-0.5">{value}</p>
      </div>
    </div>
    <div className="flex justify-end mt-auto">{status}</div>
  </div>
);

/**
 * Live readings the devices actually report: temperature probe (gauge),
 * supply and backup battery, today's running time and signal freshness.
 */
const OperatingConditions = ({ unit, hoursToday, temperatureAlert }) => {
  const battery = unit?.batteryHealth != null ? unit.batteryHealth / 1000 : null;
  const backup = unit?.gpsBackupBattery != null ? unit.gpsBackupBattery / 1000 : null;
  const ago = minutesSince(unit?.lastReadingAt);
  const online = ago !== null && ago <= OFFLINE_AFTER_MINUTES && !unit?.lastUpdate;
  const running = unit?.status === 'Running';

  const batteryPill = battery === null
    ? <Pill tone="gray">No Reading</Pill>
    : battery < BATTERY_LOW_V ? <Pill tone="amber">Low</Pill>
    : battery > BATTERY_HIGH_V ? <Pill tone="amber">Charging</Pill>
    : <Pill tone="green">Normal</Pill>;

  return (
    // Layout follows the panel's own width — see .op-* in tailwind.css
    <div className="op-conditions">
      <div className="op-layout">
      <TemperatureGauge value={unit?.temperature ?? null} alert={temperatureAlert} />
      <div className="op-cards">
        <ConditionCard icon="fa-car-battery" label="Battery" value={battery === null ? '—' : `${fmt2(battery)} V`} status={batteryPill} />
        <ConditionCard
          icon="fa-battery-three-quarters"
          label="GPS Battery"
          value={backup === null ? '—' : `${backup.toFixed(2)} V`}
          status={backup === null ? <Pill tone="gray">No Reading</Pill> : backup < BACKUP_LOW_V ? <Pill tone="amber">Low</Pill> : <Pill tone="green">Normal</Pill>}
        />
        <ConditionCard
          icon="fa-stopwatch"
          label="Running Today"
          value={`${fmt1(hoursToday ?? 0)} hrs`}
          status={running ? <Pill tone="green">Running</Pill> : <Pill tone="gray">Idle</Pill>}
        />
        <ConditionCard
          icon="fa-signal"
          label="Last Signal"
          value={formatAgo(unit?.lastReadingAt)}
          status={online ? <Pill tone="green">Online</Pill> : <Pill tone="red">Offline</Pill>}
        />
      </div>
      </div>
    </div>
  );
};

export default OperatingConditions;
