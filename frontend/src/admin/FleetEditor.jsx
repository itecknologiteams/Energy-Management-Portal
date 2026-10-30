// Edit one fleet's alert email settings: recipients (To/CC/BCC), on/off,
// temperature limits per generator, test email, remove.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Thermometer, Send, Trash2, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import * as api from './adminApi';
import { Banner, Button, Modal, RecipientInput, Spinner, StatusPill, Toggle } from './ui';

const emptyForm = {
  label: '',
  enabled: true,
  recipients: { to: [], cc: [], bcc: [] },
  defaultThresholdC: '',
  vehicleThresholdsC: {},
};

function toForm(settings) {
  if (!settings) return emptyForm;
  return {
    label: settings.label || '',
    enabled: settings.enabled,
    recipients: {
      to: [...settings.recipients.to],
      cc: [...settings.recipients.cc],
      bcc: [...settings.recipients.bcc],
    },
    defaultThresholdC: settings.defaultThresholdC ?? '',
    vehicleThresholdsC: Object.fromEntries(Object.entries(settings.vehicleThresholdsC).map(([k, v]) => [k, String(v)])),
  };
}

function toPayload(form) {
  return {
    label: form.label.trim(),
    enabled: form.enabled,
    recipients: form.recipients,
    defaultThresholdC: form.defaultThresholdC === '' ? null : Number(form.defaultThresholdC),
    vehicleThresholdsC: Object.fromEntries(
      Object.entries(form.vehicleThresholdsC).filter(([, v]) => v !== '' && v !== null).map(([k, v]) => [k, Number(v)])
    ),
  };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function FleetEditor({ fleetId, onSaved, onRemoved }) {
  const [data, setData] = useState(null);        // GET /admin/fleets/:id
  const [live, setLive] = useState({});          // vehicleId → {temperatureC, readingAt, ageMinutes}
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');          // 'save' | 'test' | 'remove' | 'live'
  const [notice, setNotice] = useState(null);    // {tone, text}
  const [errors, setErrors] = useState([]);
  const [sharedPrompt, setSharedPrompt] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setNotice(null);
    setErrors([]);
    try {
      const d = await api.getFleet(fleetId);
      setData(d);
      setForm(toForm(d.settings));
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fleetId]);

  const loadLive = useCallback(async () => {
    setBusy('live');
    try {
      const t = await api.getFleetTemperatures(fleetId);
      setLive(Object.fromEntries(t.generators.map((g) => [g.vehicleId, g])));
    } catch {
      setLive({});
    } finally {
      setBusy((b) => (b === 'live' ? '' : b));
    }
  }, [fleetId]);

  useEffect(() => { load(); loadLive(); }, [load, loadLive]);

  const saved = data?.settings || null;
  const dirty = useMemo(() => !sameJson(toPayload(form), toPayload(toForm(saved))), [form, saved]);
  const fleetLimit = form.defaultThresholdC === '' ? data?.serverDefaultThresholdC : Number(form.defaultThresholdC);
  const totalRecipients = form.recipients.to.length + form.recipients.cc.length + form.recipients.bcc.length;

  const setRecipients = (list, value) => setForm((f) => ({ ...f, recipients: { ...f.recipients, [list]: value } }));
  const others = (list) => ['to', 'cc', 'bcc'].filter((l) => l !== list).flatMap((l) => form.recipients[l]);

  async function save(confirmSharedAddresses = false) {
    setBusy('save');
    setErrors([]);
    setNotice(null);
    try {
      const result = await api.saveFleet(fleetId, {
        settings: toPayload(form),
        revision: saved ? saved.revision : 0,
        confirmSharedAddresses,
      });
      setSharedPrompt(null);
      setData((d) => ({ ...d, settings: result.settings, warnings: result.warnings }));
      setForm(toForm(result.settings));
      setNotice({ tone: 'success', text: result.changes.length ? `Saved: ${result.changes.join('; ')}` : 'Saved (no changes).' });
      onSaved?.();
    } catch (err) {
      if (err.code === 'ADDRESS_IN_OTHER_FLEET') {
        setSharedPrompt(err.details.sharedAddresses || []);
      } else if (err.code === 'REVISION_CONFLICT') {
        setNotice({ tone: 'error', text: 'Someone else changed this fleet while you were editing. Reload to see their changes, then make yours again.' });
      } else {
        setErrors(err.details?.errors?.length ? err.details.errors : [err.message]);
      }
    } finally {
      setBusy('');
    }
  }

  async function sendTest() {
    setBusy('test');
    setNotice(null);
    try {
      await api.sendTestEmail(fleetId);
      setNotice({ tone: 'success', text: `Test email sent to this fleet's ${totalRecipients} saved recipient(s). It appears in Email history.` });
    } catch (err) {
      setNotice({ tone: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  async function remove() {
    setBusy('remove');
    try {
      await api.deleteFleet(fleetId, saved.revision);
      setConfirmRemove(false);
      onRemoved?.();
    } catch (err) {
      setConfirmRemove(false);
      setNotice({ tone: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  if (loading) return <Spinner label={`Loading fleet ${fleetId}…`} />;
  if (loadError) {
    return (
      <div className="space-y-3">
        <Banner tone="error">{loadError}</Banner>
        <Button variant="secondary" onClick={load}><RefreshCw className="w-4 h-4" /> Try again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Fleet {fleetId}{form.label ? ` — ${form.label}` : ''}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {saved ? `Last saved ${api.formatServerTime(saved.updatedAt)} by ${saved.updatedBy}` : 'Not set up yet — alerts for this fleet are not emailed until you save.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && !saved.enabled && <StatusPill tone="gray">Paused</StatusPill>}
          {saved && saved.enabled && <StatusPill tone="green">Emails on</StatusPill>}
          {dirty && <StatusPill tone="amber">Unsaved changes</StatusPill>}
        </div>
      </div>

      {notice && <Banner tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Banner>}
      {errors.length > 0 && (
        <Banner tone="error">
          <ul className="list-disc pl-4 space-y-0.5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </Banner>
      )}
      {!dirty && (data.warnings || []).map((w) => <Banner key={w} tone="warning">{w}</Banner>)}

      {/* Recipients */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-orange-600" />
          <h3 className="text-sm font-semibold text-gray-900">Who receives this fleet's alerts</h3>
        </div>
        <Banner tone="info">
          <span className="inline-flex items-center gap-1 font-medium"><ShieldCheck className="w-3.5 h-3.5" /> Private to this fleet.</span>{' '}
          These people receive alerts for fleet {fleetId}'s generators only, and nothing from any other fleet.
        </Banner>

        <Toggle
          checked={form.enabled}
          onChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
          label="Send alert emails for this fleet"
          description="Switch off to pause emails without losing the recipient list. The portal's notification bell keeps working."
        />

        <div>
          <label htmlFor="fleet-label" className="block text-sm font-medium text-gray-700">Name (optional)</label>
          <input id="fleet-label" type="text" maxLength={80} value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="e.g. TCM"
            className="mt-1 w-full max-w-sm px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-orange-200" />
        </div>

        <RecipientInput id="rcpt-to" label="To" value={form.recipients.to} otherLists={others('to')}
          onChange={(v) => setRecipients('to', v)} hint="Main recipients. They can see each other's addresses." />
        <RecipientInput id="rcpt-cc" label="CC" value={form.recipients.cc} otherLists={others('cc')}
          onChange={(v) => setRecipients('cc', v)} hint="Copied. Visible to everyone in To and CC." />
        <RecipientInput id="rcpt-bcc" label="BCC" value={form.recipients.bcc} otherLists={others('bcc')}
          onChange={(v) => setRecipients('bcc', v)} hint="Hidden. Nobody sees BCC addresses, and BCC recipients don't see anyone else's." />
        <p className="text-xs text-gray-500">{totalRecipients} recipient(s). Press Enter after each address, or paste several at once.</p>
      </section>

      {/* Limits */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-orange-600" />
            <h3 className="text-sm font-semibold text-gray-900">Temperature limits</h3>
          </div>
          <Button variant="secondary" className="!px-3 !py-1.5" busy={busy === 'live'} onClick={loadLive}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh readings
          </Button>
        </div>

        <div>
          <label htmlFor="fleet-limit" className="block text-sm font-medium text-gray-700">Fleet limit (°C)</label>
          <p className="text-xs text-gray-500 mb-1">An alert is sent when a reading is above the limit. Leave empty to use the server default ({data.serverDefaultThresholdC} °C).</p>
          <input id="fleet-limit" type="number" step="0.1" min={-55} max={125}
            value={form.defaultThresholdC}
            onChange={(e) => setForm((f) => ({ ...f, defaultThresholdC: e.target.value }))}
            placeholder={`${data.serverDefaultThresholdC} (server default)`}
            className="w-56 px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-orange-200" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3 font-medium">Generator</th>
                <th className="py-2 pr-3 font-medium">Latest reading</th>
                <th className="py-2 pr-3 font-medium">Own limit (°C)</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.generators.map((g) => {
                const own = form.vehicleThresholdsC[String(g.vehicleId)] ?? '';
                const limit = own === '' ? fleetLimit : Number(own);
                const reading = live[g.vehicleId];
                const temp = reading?.temperatureC;
                const over = temp !== null && temp !== undefined && Number.isFinite(limit) && temp > limit;
                return (
                  <tr key={g.vehicleId} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-900">{g.vehicleName}</div>
                      <div className="text-xs text-gray-400">ID {g.vehicleId}</div>
                    </td>
                    <td className="py-2 pr-3">
                      {temp === null || temp === undefined
                        ? <span className="text-gray-400">{busy === 'live' ? '…' : 'No reading today'}</span>
                        : <span className={over ? 'font-semibold text-red-600' : 'text-gray-800'}>{temp.toFixed(1)} °C</span>}
                      {reading?.readingAt && <div className="text-xs text-gray-400">{api.formatReadingTime(reading.readingAt)}{reading.ageMinutes > 30 ? ` · ${reading.ageMinutes} min ago` : ''}</div>}
                    </td>
                    <td className="py-2 pr-3">
                      <input type="number" step="0.1" min={-55} max={125} value={own}
                        aria-label={`Limit for ${g.vehicleName}`}
                        onChange={(e) => setForm((f) => ({ ...f, vehicleThresholdsC: { ...f.vehicleThresholdsC, [String(g.vehicleId)]: e.target.value } }))}
                        placeholder={`${fleetLimit} (fleet)`}
                        className="w-32 px-2 py-1.5 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-orange-200" />
                    </td>
                    <td className="py-2">
                      {temp === null || temp === undefined ? <StatusPill tone="gray">—</StatusPill>
                        : over ? <StatusPill tone="red">Above {limit} °C</StatusPill>
                        : <StatusPill tone="green">OK</StatusPill>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button busy={busy === 'save'} disabled={!dirty && !!saved} onClick={() => save(false)}>
          <Save className="w-4 h-4" /> {saved ? 'Save changes' : 'Save and start alerts'}
        </Button>
        {dirty && saved && <Button variant="secondary" onClick={() => { setForm(toForm(saved)); setErrors([]); }}>Discard changes</Button>}
        <Button variant="secondary" busy={busy === 'test'}
          disabled={!saved || dirty || saved.recipients.to.length + saved.recipients.cc.length + saved.recipients.bcc.length === 0}
          title={dirty ? 'Save first — the test goes to the saved recipients' : undefined}
          onClick={sendTest}>
          <Send className="w-4 h-4" /> Send test email
        </Button>
        <div className="flex-1" />
        {saved && (
          <Button variant="danger" onClick={() => setConfirmRemove(true)}>
            <Trash2 className="w-4 h-4" /> Remove fleet
          </Button>
        )}
      </div>

      {sharedPrompt && (
        <Modal
          title="Address already used by another fleet"
          onClose={() => setSharedPrompt(null)}
          actions={<>
            <Button variant="secondary" onClick={() => setSharedPrompt(null)}>Go back and fix</Button>
            <Button variant="danger" busy={busy === 'save'} onClick={() => save(true)}>This person may see both fleets</Button>
          </>}
        >
          <p>These addresses already receive alerts for <strong>another fleet</strong>:</p>
          <ul className="list-disc pl-5">
            {sharedPrompt.map((s) => <li key={s.address}><strong>{s.address}</strong> — fleet {s.fleetIds.join(', ')}</li>)}
          </ul>
          <p>Saving would let them receive alerts for <strong>fleet {fleetId}</strong> as well. Only continue if this person is allowed to see both fleets' information.</p>
        </Modal>
      )}

      {confirmRemove && (
        <Modal
          title={`Remove fleet ${fleetId}?`}
          onClose={() => setConfirmRemove(false)}
          actions={<>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>Cancel</Button>
            <Button variant="danger" busy={busy === 'remove'} onClick={remove}>Remove</Button>
          </>}
        >
          <p>Its recipients and limits are deleted, and alerts for this fleet are no longer emailed. Email history is kept. To stop emails temporarily, switch them off instead.</p>
        </Modal>
      )}
    </div>
  );
}
