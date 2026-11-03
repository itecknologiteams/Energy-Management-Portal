import React, { useEffect, useState } from 'react';

const EMPTY = { model: '', lastServiceDate: '', hourMeterAtLastService: '', serviceIntervalHours: '', serviceIntervalDays: '' };

/**
 * Edit one generator's service settings: model, last service (date and hour
 * meter reading) and the service interval in hours and/or days.
 */
const MaintenanceSettingsModal = ({ isOpen, onClose, unitName, settings, onSave }) => {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setForm({
      ...EMPTY,
      ...Object.fromEntries(Object.entries(settings || {}).map(([k, v]) => [k, v ?? ''])),
    });
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        model: form.model,
        lastServiceDate: form.lastServiceDate,
        hourMeterAtLastService: form.hourMeterAtLastService,
        serviceIntervalHours: form.serviceIntervalHours,
        serviceIntervalDays: form.serviceIntervalDays,
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save maintenance settings');
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100 mt-1';
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="modal-content"
        style={{ maxWidth: 520, padding: 28 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-settings-title"
      >
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 id="maintenance-settings-title" className="text-lg font-semibold text-gray-900">
              <i className="fas fa-wrench text-orange-600 mr-2" aria-hidden="true"></i>
              Service Schedule — {unitName}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Running hours are counted from the generator's ignition since the last service.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="Close">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-xs text-gray-500 sm:col-span-2">
            Model / rating
            <input className={field} value={form.model} onChange={set('model')} placeholder="e.g. DG-1000KVA" maxLength={60} />
          </label>
          <label className="text-xs text-gray-500">
            Last service date
            <input type="date" className={field} value={form.lastServiceDate} onChange={set('lastServiceDate')} max={today} />
          </label>
          <label className="text-xs text-gray-500">
            Hour meter at last service (hrs)
            <input type="number" min="0" step="0.1" className={field} value={form.hourMeterAtLastService} onChange={set('hourMeterAtLastService')} placeholder="e.g. 3200" />
          </label>
          <label className="text-xs text-gray-500">
            Service every (hrs)
            <input type="number" min="1" step="1" className={field} value={form.serviceIntervalHours} onChange={set('serviceIntervalHours')} placeholder="e.g. 250" />
          </label>
          <label className="text-xs text-gray-500">
            …or every (days)
            <input type="number" min="1" step="1" className={field} value={form.serviceIntervalDays} onChange={set('serviceIntervalDays')} placeholder="e.g. 90" />
          </label>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-4" role="alert">{error}</p>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default MaintenanceSettingsModal;
