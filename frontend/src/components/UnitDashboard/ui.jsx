import React from 'react';

// Building blocks shared by the unit dashboard cards.

export const Card = ({ className = '', children, ...rest }) => (
  <section className={`bg-white rounded-2xl border border-gray-100 shadow-sm ${className}`} {...rest}>
    {children}
  </section>
);

// Square tinted tile holding a Font Awesome icon
export const IconTile = ({ icon, size = 'md', tone = 'orange' }) => {
  const sizes = { sm: 'w-9 h-9 text-base', md: 'w-11 h-11 text-lg', lg: 'w-12 h-12 text-xl' };
  const tones = {
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    gray: 'bg-gray-100 text-gray-500',
  };
  return (
    <div className={`${sizes[size]} ${tones[tone]} rounded-xl flex items-center justify-center flex-shrink-0`}>
      <i className={`fas ${icon}`} aria-hidden="true"></i>
    </div>
  );
};

const PILL_TONES = {
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-blue-50 text-blue-700',
  orange: 'bg-orange-50 text-orange-700',
  gray: 'bg-gray-100 text-gray-600',
};

export const Pill = ({ tone = 'green', icon, children, className = '' }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${PILL_TONES[tone]} ${className}`}>
    {icon && <i className={`fas ${icon} text-[10px]`} aria-hidden="true"></i>}
    {children}
  </span>
);

// Bordered box: icon, label, big value, then an optional sub-line and pill
// that wrap under the value rather than squeeze it
export const StatBox = ({ icon, label, value, unit, sub, subTone = 'gray', pill, className = '' }) => (
  <div className={`flex items-center gap-3 rounded-xl border border-gray-300 bg-white px-3.5 py-3 shadow-sm ${className}`}>
    {icon && <IconTile icon={icon} size="sm" />}
    <div className="min-w-0 flex-1">
      <p className="text-xs font-medium text-gray-600 leading-tight">{label}</p>
      <p className="text-lg font-bold text-gray-900 leading-tight whitespace-nowrap">
        {value}
        {unit && <span className="text-sm font-semibold text-gray-700 ml-1">{unit}</span>}
      </p>
      {(sub || pill) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
          {sub && (
            <span className={`text-[11px] ${subTone === 'green' ? 'text-green-600 font-medium' : 'text-gray-500'}`}>{sub}</span>
          )}
          {pill}
        </div>
      )}
    </div>
  </div>
);

// Card heading: optional icon, title, subtitle, and something on the right
export const CardTitle = ({ icon, title, subtitle, right }) => (
  <div className="flex items-start justify-between gap-3">
    <div className="flex items-start gap-2.5 min-w-0">
      {icon && <i className={`fas ${icon} text-orange-600 text-lg mt-0.5`} aria-hidden="true"></i>}
      <div className="min-w-0">
        <h3 className="text-[15px] font-bold text-gray-900 leading-snug">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5 truncate">{subtitle}</p>}
      </div>
    </div>
    {right}
  </div>
);
