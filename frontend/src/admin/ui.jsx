// Small shared UI pieces for the admin portal (Tailwind classes).
import { useState } from 'react';
import { X, Loader2, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { EMAIL_RE } from './adminApi';

export function Button({ variant = 'primary', busy = false, disabled, className = '', children, ...props }) {
  const styles = {
    primary: 'bg-orange-600 text-white hover:bg-orange-700 border-orange-600',
    secondary: 'bg-white text-gray-700 hover:bg-gray-50 border-gray-300',
    danger: 'bg-white text-red-600 hover:bg-red-50 border-red-300',
  };
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Banner({ tone = 'info', children, onClose }) {
  const tones = {
    info: ['bg-blue-50 border-blue-200 text-blue-800', Info],
    success: ['bg-emerald-50 border-emerald-200 text-emerald-800', CheckCircle2],
    warning: ['bg-amber-50 border-amber-200 text-amber-800', AlertTriangle],
    error: ['bg-red-50 border-red-200 text-red-800', AlertTriangle],
  };
  const [cls, Icon] = tones[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${cls}`}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function Modal({ title, children, actions, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        </div>
        <div className="px-5 py-4 text-sm text-gray-700 space-y-3">{children}</div>
        <div className="px-5 pb-5 flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-orange-600' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {description && <span className="block text-xs text-gray-500 mt-0.5">{description}</span>}
      </span>
    </label>
  );
}

/**
 * Email address list editor: type an address and press Enter, comma or Tab.
 * Pasting several addresses (separated by commas, semicolons, spaces or new
 * lines) adds them all.
 */
export function RecipientInput({ label, hint, value, onChange, otherLists = [], id }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const add = (text) => {
    const parts = text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length === 0) return;
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    const taken = parts.filter((p) => otherLists.includes(p));
    const good = parts.filter((p) => EMAIL_RE.test(p) && !otherLists.includes(p) && !value.includes(p));
    if (good.length) onChange([...value, ...good]);
    setError(bad.length ? `Not a valid email address: ${bad.join(', ')}`
      : taken.length ? `Already in another list for this fleet: ${taken.join(', ')}` : '');
    setDraft(bad.join(' '));
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-1">{hint}</p>}
      <div className={`flex flex-wrap items-center gap-1.5 min-h-[42px] px-2 py-1.5 rounded-lg border bg-white ${error ? 'border-red-300' : 'border-gray-300'} focus-within:ring-2 focus-within:ring-orange-200`}>
        {value.map((addr) => (
          <span key={addr} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-gray-100 text-gray-800 text-xs">
            {addr}
            <button type="button" onClick={() => onChange(value.filter((a) => a !== addr))}
              className="p-0.5 rounded-full hover:bg-gray-200" aria-label={`Remove ${addr}`}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          type="email"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if (['Enter', ',', ';', 'Tab'].includes(e.key) && draft.trim()) { e.preventDefault(); add(draft); }
            if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add(draft)}
          onPaste={(e) => { e.preventDefault(); add(`${draft} ${e.clipboardData.getData('text')}`); }}
          placeholder={value.length ? '' : 'name@company.com'}
          className="flex-1 min-w-[180px] px-1 py-1 text-sm outline-none border-0 bg-transparent"
        />
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

export function StatusPill({ tone, children }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    gray: 'bg-gray-100 text-gray-600 border-gray-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
      <Loader2 className="w-5 h-5 animate-spin text-orange-600" /> {label}
    </div>
  );
}
