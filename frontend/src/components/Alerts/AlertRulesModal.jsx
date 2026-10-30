import React, { useCallback, useEffect, useState } from 'react';
import {
  getAlertRules,
  createAlertRule,
  updateAlertRule,
  deleteAlertRule,
  getFleetVehicles,
} from '../../services/api';
import { alertKey } from '../../hooks/useTemperatureAlerts';

const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;

/**
 * Dashboard dialog for temperature alert rules: add a threshold for one
 * vehicle or the whole fleet, switch rules on/off, delete them, and allow
 * browser notifications.
 *
 * @param {boolean}  isOpen
 * @param {Function} onClose
 * @param {number}   fleetId
 * @param {Object[]} triggered       - breaches active right now (from useTemperatureAlerts)
 * @param {Function} onRulesChanged  - re-run the alert check after a change
 */
const AlertRulesModal = ({ isOpen, onClose, fleetId, triggered = [], onRulesChanged }) => {
  const [rules, setRules] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ vehicleId: 'all', operator: 'above', threshold: '50', emails: '' });
  // Rule whose email list is being edited, and the draft text
  const [editingEmails, setEditingEmails] = useState(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [permission, setPermission] = useState(notificationsSupported ? Notification.permission : 'unsupported');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, vehiclesRes] = await Promise.all([getAlertRules(fleetId), getFleetVehicles(fleetId)]);
      setRules(rulesRes.rules || []);
      setVehicles((vehiclesRes.vehicles || []).map((v) => ({ id: Number(v.vehicleId), name: v.vehicleName })));
    } catch (err) {
      setError(err.message || 'Could not load alert rules');
    } finally {
      setLoading(false);
    }
  }, [fleetId]);

  useEffect(() => {
    if (isOpen && fleetId) load();
  }, [isOpen, fleetId, load]);

  if (!isOpen) return null;

  const vehicleName = (id) =>
    id === null ? 'All vehicles' : vehicles.find((v) => v.id === id)?.name || `Vehicle ${id}`;
  const activeKeys = new Set(triggered.map(alertKey));
  const isTriggered = (rule) => triggered.some((a) => a.ruleId === rule.id && activeKeys.has(alertKey(a)));

  // Every change saves straight away, then re-runs the check so the
  // dashboard reflects it without waiting for the next poll
  const run = async (action) => {
    setSaving(true);
    setError(null);
    try {
      await action();
      await load();
      onRulesChanged?.();
    } catch (err) {
      setError(err.message || 'Could not save the alert rule');
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = (e) => {
    e.preventDefault();
    run(() => createAlertRule(fleetId, {
      metric: 'temperature',
      operator: form.operator,
      threshold: Number(form.threshold),
      vehicleId: form.vehicleId === 'all' ? null : Number(form.vehicleId),
      emails: form.emails,
      enabled: true,
    }).then(() => setForm((f) => ({ ...f, emails: '' }))));
  };

  const startEditingEmails = (rule) => {
    setEditingEmails(rule.id);
    setEmailDraft((rule.emails || []).join(', '));
  };

  const saveEmails = (rule) =>
    run(() => updateAlertRule(fleetId, rule.id, { emails: emailDraft }).then(() => setEditingEmails(null)));

  const requestPermission = async () => {
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(Notification.permission);
    }
  };

  const fieldClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-rules-title"
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 id="alert-rules-title" className="text-lg font-semibold text-gray-900">
              <i className="fas fa-temperature-high text-orange-600 mr-2"></i>
              Temperature Alerts
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Get notified on the dashboard — and by email, if you add addresses — when a generator's temperature crosses a limit. Checked every minute.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Browser notifications */}
        {permission !== 'unsupported' && permission !== 'granted' && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-orange-50 border border-orange-100 px-4 py-3 mb-5">
            <p className="text-sm text-orange-800">
              {permission === 'denied'
                ? 'Browser notifications are blocked. Allow them for this site in your browser settings to get pop-up alerts.'
                : 'Allow browser notifications to get a pop-up even when this tab is in the background.'}
            </p>
            {permission === 'default' && (
              <button type="button" className="btn btn-primary whitespace-nowrap" onClick={requestPermission}>
                Allow
              </button>
            )}
          </div>
        )}

        {/* New rule */}
        <form onSubmit={handleAdd} className="rounded-xl border border-gray-200 p-4 mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">New alert</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs text-gray-500">
              Vehicle
              <select
                className={`${fieldClass} mt-1`}
                value={form.vehicleId}
                onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
              >
                <option value="all">All vehicles</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-500">
              When temperature is
              <select
                className={`${fieldClass} mt-1`}
                value={form.operator}
                onChange={(e) => setForm({ ...form, operator: e.target.value })}
              >
                <option value="above">Above</option>
                <option value="below">Below</option>
              </select>
            </label>
            <label className="text-xs text-gray-500">
              Limit (°C)
              <input
                type="number"
                step="0.1"
                min="-55"
                max="125"
                required
                className={`${fieldClass} mt-1`}
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
              />
            </label>
          </div>
          <label className="block text-xs text-gray-500 mt-3">
            Email to <span className="text-gray-400">(optional, separate addresses with commas)</span>
            <input
              type="text"
              inputMode="email"
              autoComplete="off"
              placeholder="ops@company.com, manager@company.com"
              className={`${fieldClass} mt-1`}
              value={form.emails}
              onChange={(e) => setForm({ ...form, emails: e.target.value })}
            />
          </label>
          <div className="flex justify-end mt-3">
            <button type="submit" className="btn btn-primary" disabled={saving || loading}>
              <i className="fas fa-plus"></i>
              Add alert
            </button>
          </div>
        </form>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4" role="alert">
            {error}
          </p>
        )}

        {/* Existing rules */}
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Your alerts</p>
        {loading ? (
          <p className="text-sm text-gray-500 py-4">
            <i className="fas fa-circle-notch fa-spin mr-2"></i>Loading…
          </p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">No alerts yet. Add one above, e.g. "Above 50 °C".</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${rule.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                    {vehicleName(rule.vehicleId)}
                  </p>
                  <p className={`text-xs ${rule.enabled ? 'text-gray-500' : 'text-gray-400'}`}>
                    Temperature {rule.operator} {rule.threshold} °C
                  </p>
                  {editingEmails === rule.id ? (
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        type="text"
                        inputMode="email"
                        autoComplete="off"
                        aria-label="Email addresses"
                        placeholder="Leave empty for no emails"
                        className={`${fieldClass} py-1 text-xs`}
                        value={emailDraft}
                        onChange={(e) => setEmailDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEmails(rule); }}
                      />
                      <button type="button" className="text-xs font-semibold text-orange-600 hover:underline" disabled={saving} onClick={() => saveEmails(rule)}>
                        Save
                      </button>
                      <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setEditingEmails(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:text-orange-600 mt-0.5 text-left truncate max-w-full"
                      onClick={() => startEditingEmails(rule)}
                      title="Change email recipients"
                    >
                      <i className="fas fa-envelope mr-1"></i>
                      {rule.emails?.length ? rule.emails.join(', ') : 'No emails — add'}
                    </button>
                  )}
                </div>
                {rule.enabled && isTriggered(rule) && (
                  <span className="text-xs font-semibold text-red-600 bg-red-50 rounded-full px-2 py-0.5 whitespace-nowrap">
                    Triggered now
                  </span>
                )}
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={saving}
                    onChange={() => run(() => updateAlertRule(fleetId, rule.id, { enabled: !rule.enabled }))}
                  />
                  On
                </label>
                <button
                  type="button"
                  className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                  disabled={saving}
                  onClick={() => run(() => deleteAlertRule(fleetId, rule.id))}
                  aria-label={`Delete alert for ${vehicleName(rule.vehicleId)}`}
                  title="Delete alert"
                >
                  <i className="fas fa-trash"></i>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default AlertRulesModal;
