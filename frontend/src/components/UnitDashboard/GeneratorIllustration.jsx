import React from 'react';

// Drawn diesel generator set (canopy, control panel, louvres, skid) used
// beside the selected unit's name.
const GeneratorIllustration = ({ className = '' }) => (
  <svg viewBox="0 0 120 80" className={className} role="img" aria-label="Generator">
    <defs>
      <linearGradient id="gen-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fb923c" />
        <stop offset="1" stopColor="#ea580c" />
      </linearGradient>
      <linearGradient id="gen-side" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#f97316" />
        <stop offset="1" stopColor="#c2410c" />
      </linearGradient>
    </defs>
    {/* skid */}
    <rect x="6" y="66" width="108" height="7" rx="1.5" fill="#374151" />
    {/* side panel (depth) */}
    <path d="M92 14 L112 8 L112 62 L92 68 Z" fill="url(#gen-side)" />
    {/* canopy front */}
    <rect x="8" y="14" width="84" height="54" rx="3" fill="url(#gen-body)" />
    {/* roof */}
    <path d="M8 14 L28 8 L112 8 L92 14 Z" fill="#fdba74" />
    {/* exhaust */}
    <rect x="76" y="2" width="5" height="8" rx="1" fill="#4b5563" />
    {/* control panel door */}
    <rect x="14" y="22" width="24" height="36" rx="2" fill="#1f2937" />
    <rect x="18" y="27" width="16" height="9" rx="1" fill="#22c55e" opacity="0.85" />
    <circle cx="21" cy="44" r="2" fill="#f59e0b" />
    <circle cx="27" cy="44" r="2" fill="#ef4444" />
    <rect x="18" y="50" width="16" height="3" rx="1" fill="#6b7280" />
    {/* louvres */}
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <rect key={i} x="46" y={24 + i * 6} width="40" height="2.5" rx="1" fill="#9a3412" opacity="0.55" />
    ))}
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <path key={`s${i}`} d={`M96 ${24 + i * 6} L108 ${20.5 + i * 6}`} stroke="#9a3412" strokeOpacity="0.5" strokeWidth="2" />
    ))}
  </svg>
);

export default GeneratorIllustration;
