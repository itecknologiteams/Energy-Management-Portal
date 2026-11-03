import React from 'react';
import { Card, Pill } from './ui';
import { currentFuel, fuelCapacity, fmt1, fmt2 } from '../../utils/unitData';

// Below this share of the tank the level is called low
const LOW_FUEL_PERCENT = 20;

// Tank + scale drawing, one SVG so the scale lines up with the tank exactly
// (SVG units; the element is sized in tailwind.css → .fuel-tank-gauge)
const VIEW = { w: 340, h: 310 };
const TANK = { x: 14, y: 34, w: 160, h: 262, r: 30 };
const INNER = { x: TANK.x + 8, y: TANK.y + 8, w: TANK.w - 16, h: TANK.h - 16, r: TANK.r - 8 };
const AXIS_X = 198;
const TICKS = 8;

// Scale labels: whole litres on big tanks, one decimal on small ones
const litreLabel = (litres, capacity) => (capacity >= 100 ? `${Math.round(litres)} L` : `${fmt1(litres)} L`);

/**
 * The selected unit's tank: level in % and litres, a drawn tank filled to
 * the level, and a litre scale with the current reading marked.
 */
const LiveFuelTank = ({ unit }) => {
  const fuel = currentFuel(unit);
  const capacity = fuelCapacity(unit);
  const percent = fuel !== null && capacity ? Math.max(0, Math.min(100, (fuel / capacity) * 100)) : null;
  const low = percent !== null && percent < LOW_FUEL_PERCENT;

  const pill = percent === null
    ? <Pill tone="gray" icon="fa-circle-question">No Fuel Reading</Pill>
    : low
      ? <Pill tone="red" icon="fa-triangle-exclamation">Low Fuel</Pill>
      : <Pill tone="green" icon="fa-circle-check">Sufficient Fuel</Pill>;

  const fillY = INNER.y + INNER.h * (1 - (percent ?? 0) / 100);

  // Two wave periods wider than the tank, slid left by one tank width in a
  // loop (.fuel-wave), so the surface ripples without a seam
  const waveLen = INNER.w / 2;
  let wave = `M ${INNER.x - INNER.w} ${fillY}`;
  for (let i = 0; i < 4; i++) wave += ` q ${waveLen / 2} -6 ${waveLen} 0 t ${waveLen} 0`;
  wave += ` V ${INNER.y + INNER.h + 4} H ${INNER.x - INNER.w} Z`;

  const tagText = percent === null ? '' : `${fmt2(fuel)} L (${fmt1(percent)}%)`;
  const tagW = tagText.length * 7 + 18;
  const tagX = AXIS_X + 10;

  return (
    <Card className="fuel-tank-card p-5 lg:p-6 bg-gradient-to-br from-orange-50 via-white to-orange-50/60 h-full">
      {/* Layout follows the card's own width — see .fuel-tank-* in tailwind.css */}
      <div className="fuel-tank-layout">
        <div className="fuel-tank-info">
          <div className="fuel-tank-title">
            <div className="flex items-start gap-3">
              <i className="fas fa-gas-pump text-orange-600 text-2xl mt-1" aria-hidden="true"></i>
              <div>
                <h3 className="text-xl font-bold text-gray-900 whitespace-nowrap">Live Fuel Tank</h3>
                <p className="text-sm text-gray-500">{unit?.name || '—'}</p>
              </div>
            </div>
            <div className="mt-3">{pill}</div>
          </div>

          <div className="fuel-tank-level">
            <p className={`fuel-tank-percent font-extrabold mt-4 tracking-tight whitespace-nowrap ${low ? 'text-red-600' : 'text-gray-900'}`}>
              {percent === null ? '—' : `${fmt1(percent)}%`}
            </p>
            <p className="text-lg text-gray-700 mt-1 whitespace-nowrap">
              {fuel === null ? 'No reading' : `${fmt2(fuel)} L${capacity ? ` / ${fmt2(capacity)} L` : ''}`}
            </p>
            {capacity && fuel !== null && (
              <dl className="flex gap-5 mt-4 text-xs">
                <div>
                  <dt className="text-gray-500">Capacity</dt>
                  <dd className="font-semibold text-gray-800">{fmt2(capacity)} L</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Free space</dt>
                  <dd className="font-semibold text-gray-800">{fmt2(Math.max(0, capacity - fuel))} L</dd>
                </div>
              </dl>
            )}
          </div>
        </div>

        <svg
          viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
          className="fuel-tank-gauge"
          role="img"
          aria-label={percent === null ? 'Fuel level unknown' : `Tank ${fmt1(percent)}% full: ${fmt2(fuel)} of ${fmt2(capacity)} litres`}
        >
          <defs>
            <linearGradient id="tank-liquid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={low ? '#f87171' : '#fdba74'} />
              <stop offset="0.35" stopColor={low ? '#ef4444' : '#fb923c'} />
              <stop offset="1" stopColor={low ? '#b91c1c' : '#ea580c'} />
            </linearGradient>
            <linearGradient id="tank-glass" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f3f4f6" />
              <stop offset="0.5" stopColor="#ffffff" />
              <stop offset="1" stopColor="#e5e7eb" />
            </linearGradient>
            <clipPath id="tank-inner-clip">
              <rect x={INNER.x} y={INNER.y} width={INNER.w} height={INNER.h} rx={INNER.r} />
            </clipPath>
          </defs>

          {/* Filler cap */}
          <rect x={TANK.x + TANK.w / 2 - 22} y="10" width="44" height="9" rx="3" fill="#374151" />
          <rect x={TANK.x + TANK.w / 2 - 15} y="17" width="30" height={TANK.y - 15} rx="3" fill="#4b5563" />

          {/* Tank body */}
          <rect x={TANK.x} y={TANK.y} width={TANK.w} height={TANK.h} rx={TANK.r} fill="url(#tank-glass)" stroke="#374151" strokeWidth="4" />

          <g clipPath="url(#tank-inner-clip)">
            {percent !== null && percent > 0 && (
              <g className="fuel-wave">
                <path d={wave} fill="url(#tank-liquid)" />
              </g>
            )}
            {/* Graduations inside the tank at each quarter */}
            {[1, 2, 3].map((q) => {
              const y = INNER.y + (INNER.h * q) / 4;
              return <line key={q} x1={INNER.x + INNER.w - 22} x2={INNER.x + INNER.w - 4} y1={y} y2={y} stroke="#374151" strokeOpacity="0.25" strokeWidth="2" />;
            })}
            {/* Glass shine */}
            <rect x={INNER.x + 10} y={INNER.y + 14} width="10" height={INNER.h - 28} rx="5" fill="#fff" opacity="0.35" />
          </g>

          {percent === null && (
            <text x={TANK.x + TANK.w / 2} y={TANK.y + TANK.h / 2} textAnchor="middle" fontSize="13" fill="#9ca3af" fontFamily="Inter, sans-serif">No reading</text>
          )}

          {/* Litre scale, spanning exactly the tank's inside */}
          {capacity && (
            <g fontFamily="Inter, sans-serif">
              <line x1={AXIS_X} x2={AXIS_X} y1={INNER.y} y2={INNER.y + INNER.h} stroke="#6b7280" strokeWidth="2" />
              {Array.from({ length: TICKS + 1 }, (_, i) => {
                const y = INNER.y + (INNER.h * i) / TICKS;
                const litres = capacity * (1 - i / TICKS);
                const major = i % 2 === 0;
                // The current-level tag replaces a label it would cover
                const covered = percent !== null && Math.abs(y - fillY) < 16;
                return (
                  <g key={i}>
                    <line x1={AXIS_X} x2={AXIS_X + (major ? 12 : 7)} y1={y} y2={y} stroke="#6b7280" strokeWidth="2" />
                    {!covered && (
                      <text x={AXIS_X + 18} y={y + 4.5} fontSize="13" fill={major ? '#374151' : '#6b7280'} fontWeight={major ? 600 : 400}>
                        {litreLabel(litres, capacity)}{i === 0 ? ' (100%)' : ''}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {/* Current level: dashed line from the surface to the tagged scale */}
          {percent !== null && capacity && (
            <g>
              <line x1={TANK.x + TANK.w} x2={AXIS_X} y1={fillY} y2={fillY} stroke={low ? '#dc2626' : '#ea580c'} strokeWidth="2" strokeDasharray="4 3" />
              <path d={`M ${tagX - 7} ${fillY} l 8 -6 v 12 Z`} fill={low ? '#dc2626' : '#ea580c'} />
              <rect x={tagX} y={fillY - 12} width={tagW} height="24" rx="6" fill={low ? '#dc2626' : '#ea580c'} />
              <text x={tagX + tagW / 2} y={fillY + 4.5} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#fff" fontFamily="Inter, sans-serif">
                {tagText}
              </text>
            </g>
          )}
        </svg>
      </div>
    </Card>
  );
};

export default LiveFuelTank;
