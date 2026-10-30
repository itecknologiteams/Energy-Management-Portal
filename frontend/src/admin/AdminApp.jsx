// Admin portal for alert emails, served at /admin.
// Separate from customer logins: its own sign-in, its own session.
import { useCallback, useEffect, useState } from 'react';
import { LogOut, Plus, Mail, History, ClipboardList, Server, Loader2, Lock } from 'lucide-react';
import * as api from './adminApi';
import FleetEditor from './FleetEditor';
import { HistoryView, AuditView, SystemView } from './AdminViews';
import { Banner, Button, StatusPill } from './ui';
import './admin.css';

function AdminLogin({ onSignedIn, message }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!username.trim() || !password) { setError('Enter your username and password'); return; }
    setBusy(true);
    setError('');
    try {
      onSignedIn(await api.login(username.trim(), password));
    } catch (err) {
      setError(err.message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ems-admin min-h-screen flex items-center justify-center bg-[#f5f3ef] p-4">
      <form onSubmit={submit} noValidate className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-7 space-y-4">
        <div className="text-center">
          <div className="mx-auto w-11 h-11 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Alert email administration</h1>
          <p className="text-xs text-gray-500 mt-1">Energy Management Portal · iTecknologi staff only</p>
        </div>
        {message && <Banner tone="warning">{message}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        <div>
          <label htmlFor="admin-user" className="block text-sm font-medium text-gray-700">Username</label>
          <input id="admin-user" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-orange-200" />
        </div>
        <div>
          <label htmlFor="admin-pass" className="block text-sm font-medium text-gray-700">Password</label>
          <input id="admin-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-orange-200" />
        </div>
        <button type="submit" disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
        </button>
      </form>
    </div>
  );
}

const TABS = [
  { id: 'fleets', label: 'Fleets', icon: Mail },
  { id: 'history', label: 'Email history', icon: History },
  { id: 'audit', label: 'Activity log', icon: ClipboardList },
  { id: 'system', label: 'System', icon: Server },
];

function AdminConsole({ session, onSignOut }) {
  const [tab, setTab] = useState('fleets');
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [newFleetId, setNewFleetId] = useState('');
  const [addError, setAddError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const o = await api.getOverview();
      setOverview(o);
      return o;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().then((o) => { if (o && o.fleets.length) setSelected((s) => s ?? o.fleets[0].fleetId); });
  }, [refresh]);

  const fleets = overview?.fleets || [];

  function addFleet(e) {
    e.preventDefault();
    const id = newFleetId.trim();
    if (!/^\d+$/.test(id) || Number(id) <= 0) { setAddError('Enter a fleet ID (a number, e.g. 2086)'); return; }
    setAddError('');
    setNewFleetId('');
    setSelected(Number(id));
    setTab('fleets');
  }

  return (
    <div className="ems-admin min-h-screen bg-[#f5f3ef]">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div>
            <span className="text-sm font-semibold text-gray-900">Alert email administration</span>
            <span className="hidden sm:inline text-xs text-gray-400"> · Energy Management Portal</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{session.username}</span>
            <Button variant="secondary" className="!px-3 !py-1.5" onClick={onSignOut}><LogOut className="w-4 h-4" /> Sign out</Button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => { setTab(id); if (id === 'system') refresh(); }}
              className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === id ? 'border-orange-600 text-orange-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        {overview && overview.config.errors.length > 0 && tab !== 'system' && (
          <Banner tone="error">Server alert settings have a problem — see the System tab.</Banner>
        )}

        {tab === 'fleets' && (
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <aside className="space-y-3">
              <form onSubmit={addFleet} className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
                <label htmlFor="new-fleet" className="block text-xs font-medium text-gray-600">Set up a fleet</label>
                <div className="flex gap-2">
                  <input id="new-fleet" inputMode="numeric" value={newFleetId} onChange={(e) => setNewFleetId(e.target.value)}
                    placeholder="Fleet ID"
                    className="w-full min-w-0 px-3 py-2 rounded-lg border border-gray-300 text-sm outline-none focus:ring-2 focus:ring-orange-200" />
                  <Button type="submit" className="!px-3" aria-label="Open fleet"><Plus className="w-4 h-4" /></Button>
                </div>
                {addError && <p className="text-xs text-red-600">{addError}</p>}
              </form>
              <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                {fleets.length === 0 && <li className="p-4 text-sm text-gray-400">No fleets set up yet</li>}
                {fleets.map((f) => (
                  <li key={f.fleetId}>
                    <button type="button" onClick={() => setSelected(f.fleetId)}
                      className={`w-full text-left px-4 py-3 ${selected === f.fleetId ? 'bg-orange-50' : 'hover:bg-gray-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">Fleet {f.fleetId}{f.label ? ` — ${f.label}` : ''}</span>
                        {f.enabled ? <StatusPill tone="green">On</StatusPill> : <StatusPill tone="gray">Paused</StatusPill>}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {f.recipientCount} recipient(s) · limit {f.defaultThresholdC ?? overview.temperature.defaultThresholdC} °C
                        {f.generatorLimitCount ? ` · ${f.generatorLimitCount} custom` : ''}
                      </div>
                      {f.warnings.length > 0 && <div className="text-xs text-amber-700 mt-0.5">{f.warnings[0]}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="min-w-0">
              {selected
                ? <FleetEditor key={selected} fleetId={selected} onSaved={refresh}
                    onRemoved={() => { refresh().then((o) => setSelected(o?.fleets[0]?.fleetId ?? null)); }} />
                : <p className="text-sm text-gray-500 py-12 text-center">Enter a fleet ID on the left to set up its alert emails.</p>}
            </section>
          </div>
        )}

        {tab === 'history' && <HistoryView fleets={fleets} />}
        {tab === 'audit' && <AuditView />}
        {tab === 'system' && <SystemView overview={overview} onRefresh={refresh} />}
      </main>
    </div>
  );
}

export default function AdminApp() {
  const [session, setSession] = useState(() => api.getSession());
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.setUnauthorizedHandler((msg) => {
      setSession(null);
      setMessage(msg || 'Your session has ended. Please sign in again.');
    });
    document.title = 'Alert email administration';
  }, []);

  if (!session) return <AdminLogin onSignedIn={(s) => { setMessage(''); setSession(s); }} message={message} />;
  return <AdminConsole session={session} onSignOut={() => { api.clearSession(); setSession(null); setMessage(''); }} />;
}
