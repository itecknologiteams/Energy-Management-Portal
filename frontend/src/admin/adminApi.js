// API client for the admin email portal (/admin).
// The admin session token is kept in sessionStorage, so it ends when the
// browser tab closes and is never shared with customer logins.

const API_BASE_URL =
  process.env.REACT_APP_API_URL ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3010'
    : '');

const TOKEN_KEY = 'emsAdminSession';

export class AdminApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorized = () => {};

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export function getSession() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || new Date(session.expiresAt) <= new Date()) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session)); } catch { /* private mode */ }
}

export function clearSession() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function request(method, path, body) {
  const session = getSession();
  let res;
  try {
    res = await fetch(`${API_BASE_URL}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AdminApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }

  if (!res.ok || !data || data.success === false) {
    const err = data?.error || {};
    if (res.status === 401 && path !== '/admin/login') {
      clearSession();
      onUnauthorized(err.message);
    }
    const { code, message, ...details } = err;
    throw new AdminApiError(res.status, code || 'ERROR', message || `Request failed (${res.status})`, details);
  }
  return data.data ?? data;
}

export async function login(username, password) {
  const session = await request('POST', '/admin/login', { username, password });
  saveSession(session);
  return session;
}

export const getOverview = () => request('GET', '/admin/overview');
export const getFleet = (fleetId) => request('GET', `/admin/fleets/${fleetId}`);
export const getFleetTemperatures = (fleetId) => request('GET', `/admin/fleets/${fleetId}/temperatures`);
export const saveFleet = (fleetId, { settings, revision, confirmSharedAddresses = false }) =>
  request('PUT', `/admin/fleets/${fleetId}`, { settings, revision, confirmSharedAddresses });
export const deleteFleet = (fleetId, revision) => request('DELETE', `/admin/fleets/${fleetId}?revision=${revision}`);
export const sendTestEmail = (fleetId) => request('POST', `/admin/fleets/${fleetId}/test-email`);

export function getHistory({ fleetId, status, before, limit = 50 } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (fleetId) q.set('fleetId', fleetId);
  if (status) q.set('status', status);
  if (before) q.set('before', before);
  return request('GET', `/admin/history?${q}`);
}

export const getAudit = (limit = 200) => request('GET', `/admin/audit?limit=${limit}`);

// ─── Formatting helpers ──────────────────────────────────────────────────────

// Server event times (history, audit, saves) are real UTC → show in local time.
export function formatServerTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// Tracking readings are PKT wall-clock time read back as UTC → print as stored.
export function formatReadingTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC',
  });
}

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;
