// Email history, admin activity log and system status views.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import * as api from './adminApi';
import { Banner, Button, Spinner, StatusPill } from './ui';

const KIND_LABEL = { alert: 'Above limit', repeat: 'Still above limit', recovered: 'Back to normal' };

export function HistoryView({ fleets }) {
  const [filters, setFilters] = useState({ fleetId: '', status: '' });
  const [entries, setEntries] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  const load = useCallback(async (append = false, before = null) => {
    setLoading(true);
    setError('');
    try {
      const page = await api.getHistory({ ...filters, before });
      setEntries((prev) => (append ? [...prev, ...page.entries] : page.entries));
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(false); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="h-fleet" className="block text-xs font-medium text-gray-600">Fleet</label>
          <select id="h-fleet" value={filters.fleetId} onChange={(e) => setFilters((f) => ({ ...f, fleetId: e.target.value }))}
            className="mt-1 px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
            <option value="">All fleets</option>
            {fleets.map((f) => <option key={f.fleetId} value={f.fleetId}>Fleet {f.fleetId}{f.label ? ` — ${f.label}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="h-status" className="block text-xs font-medium text-gray-600">Result</label>
          <select id="h-status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="mt-1 px-3 py-2 rounded-lg border border-gray-300 text-sm bg-white">
            <option value="">Sent and failed</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <Button variant="secondary" busy={loading} onClick={() => load(false)}><RefreshCw className="w-4 h-4" /> Refresh</Button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
              <th className="py-2.5 pl-4 pr-2 w-6" />
              <th className="py-2.5 pr-3 font-medium">Sent</th>
              <th className="py-2.5 pr-3 font-medium">Fleet</th>
              <th className="py-2.5 pr-3 font-medium">Generators</th>
              <th className="py-2.5 pr-3 font-medium">Recipients</th>
              <th className="py-2.5 pr-4 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <Fragment key={e.id}>
                <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td className="py-2.5 pl-4 pr-2 text-gray-400">{open === e.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">{api.formatServerTime(e.at)}</td>
                  <td className="py-2.5 pr-3">{e.fleetId}</td>
                  <td className="py-2.5 pr-3">
                    {e.test ? <StatusPill tone="blue">Test by {e.sentBy}</StatusPill>
                      : e.items.map((i) => `${i.vehicleName} ${i.celsius} °C`).join(', ')}
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {e.to.length + e.cc.length + e.bcc.length}
                    <span className="text-xs text-gray-400"> ({e.to.length} to{e.cc.length ? `, ${e.cc.length} cc` : ''}{e.bcc.length ? `, ${e.bcc.length} bcc` : ''})</span>
                  </td>
                  <td className="py-2.5 pr-4">{e.status === 'sent' ? <StatusPill tone="green">Sent</StatusPill> : <StatusPill tone="red">Failed</StatusPill>}</td>
                </tr>
                {open === e.id && (
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <td />
                    <td colSpan={5} className="py-3 pr-4 text-xs text-gray-700 space-y-1.5">
                      <div><span className="font-medium">Subject:</span> {e.subject}</div>
                      {e.to.length > 0 && <div><span className="font-medium">To:</span> {e.to.join(', ')}</div>}
                      {e.cc.length > 0 && <div><span className="font-medium">CC:</span> {e.cc.join(', ')}</div>}
                      {e.bcc.length > 0 && <div><span className="font-medium">BCC:</span> {e.bcc.join(', ')}</div>}
                      {!e.test && e.items.map((i, idx) => (
                        <div key={idx}>{KIND_LABEL[i.kind] || i.kind}: {i.vehicleName} (ID {i.vehicleId}) — {i.celsius} °C, limit {i.threshold} °C, reading {api.formatReadingTime(i.at)}</div>
                      ))}
                      {e.error && <div className="text-red-700"><span className="font-medium">Error:</span> {e.error}</div>}
                      {e.messageId && <div className="text-gray-400">Message ID {e.messageId}</div>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!loading && entries.length === 0 && <p className="py-10 text-center text-sm text-gray-400">No emails yet</p>}
        {loading && entries.length === 0 && <Spinner />}
      </div>
      {hasMore && (
        <Button variant="secondary" busy={loading} onClick={() => load(true, entries[entries.length - 1].at)}>Load older</Button>
      )}
    </div>
  );
}

const ACTION_LABEL = {
  login: 'Signed in',
  login_failed: 'Failed sign-in',
  fleet_added: 'Set up fleet',
  fleet_updated: 'Changed fleet',
  fleet_removed: 'Removed fleet',
  test_email: 'Sent test email',
};

export function AuditView() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try { setEntries((await api.getAudit()).entries); } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <Banner tone="error">{error}</Banner>;
  if (!entries) return <Spinner />;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
            <th className="py-2.5 pl-4 pr-3 font-medium">When</th>
            <th className="py-2.5 pr-3 font-medium">Admin</th>
            <th className="py-2.5 pr-3 font-medium">Action</th>
            <th className="py-2.5 pr-4 font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, idx) => (
            <tr key={idx} className="border-b border-gray-50 align-top">
              <td className="py-2.5 pl-4 pr-3 whitespace-nowrap">{api.formatServerTime(e.at)}</td>
              <td className="py-2.5 pr-3">{e.actor}</td>
              <td className="py-2.5 pr-3 whitespace-nowrap">
                {e.action === 'login_failed' ? <StatusPill tone="red">{ACTION_LABEL[e.action]}</StatusPill> : (ACTION_LABEL[e.action] || e.action)}
                {e.fleetId ? ` ${e.fleetId}` : ''}
              </td>
              <td className="py-2.5 pr-4 text-xs text-gray-600">
                {e.details?.changes?.join('; ')}
                {e.details?.sharedAddressesConfirmed?.length ? ` · confirmed shared: ${e.details.sharedAddressesConfirmed.join(', ')}` : ''}
                {e.details?.status ? `Result: ${e.details.status}` : ''}
                {e.ip ? <span className="text-gray-400"> · IP {e.ip}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length === 0 && <p className="py-10 text-center text-sm text-gray-400">No activity yet</p>}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-gray-50 last:border-0 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{children}</span>
    </div>
  );
}

export function SystemView({ overview, onRefresh }) {
  if (!overview) return <Spinner />;
  const { email, monitor, temperature, config } = overview;
  const on = (v) => (v ? <StatusPill tone="green">On</StatusPill> : <StatusPill tone="red">Off</StatusPill>);
  return (
    <div className="space-y-4">
      {config.errors.map((e) => <Banner key={e} tone="error">{e}</Banner>)}
      {config.warnings.map((w) => <Banner key={w} tone="warning">{w}</Banner>)}
      <p className="text-xs text-gray-500">These are server settings in <code>project/config/alerts.json</code>. The SMTP password is never shown here.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Email (SMTP)</h3>
          <Row label="Sending">{on(email.enabled)}</Row>
          <Row label="Server">{email.smtpHost ? `${email.smtpHost}:${email.smtpPort}` : '—'}</Row>
          <Row label="Encryption">{email.secure ? 'TLS (port 465)' : 'STARTTLS'}</Row>
          <Row label="From">{email.from || '—'}</Row>
          <Row label="Subject prefix">{email.subjectPrefix || '—'}</Row>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Background monitor</h3>
          <Row label="Monitor">{on(monitor.enabled)}</Row>
          <Row label="Temperature alerts">{on(temperature.enabled)}</Row>
          <Row label="Checks every">{monitor.intervalMinutes} min</Row>
          <Row label="Server default limit">{temperature.defaultThresholdC} °C</Row>
          <Row label="Clears below limit by">{temperature.recoveryMarginC} °C</Row>
          <Row label="Reminder while hot">{monitor.repeatEmailEveryMinutes ? `every ${monitor.repeatEmailEveryMinutes} min` : 'off'}</Row>
          <Row label="Back-to-normal email">{monitor.sendRecoveryEmail ? 'yes' : 'no'}</Row>
          <Row label="Fleets checked">{monitor.monitoredFleetIds.join(', ') || 'none'}</Row>
        </section>
      </div>
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Last check</h3>
          <Button variant="secondary" className="!px-3 !py-1.5" onClick={onRefresh}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>
        </div>
        {monitor.lastRun ? (
          <>
            <Row label="Finished">{api.formatServerTime(monitor.lastRun.finishedAt)}</Row>
            <Row label="Generators checked">{monitor.lastRun.checked}</Row>
            <Row label="Currently above limit">{monitor.lastRun.alerts}</Row>
            <Row label="Emails sent">{monitor.lastRun.emailsSent}</Row>
            {monitor.lastRun.errors.map((e) => <Banner key={e} tone="warning">{e}</Banner>)}
          </>
        ) : <p className="text-sm text-gray-500">No check has run since the server started.</p>}
      </section>
    </div>
  );
}
