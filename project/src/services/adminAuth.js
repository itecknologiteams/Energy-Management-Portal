'use strict';

/**
 * Admin authentication for the alert email portal.
 *
 * Admin accounts live in config/admins.json (git-ignored; path overridable with
 * ADMINS_PATH) and are managed with `npm run admin -- add|remove|list|password`.
 * They are completely separate from customer (fleet) logins.
 *
 * - Passwords: scrypt with a random salt per user; never stored in plain text.
 * - Sessions: HMAC-SHA256 signed tokens with an expiry. The signing secret comes
 *   from ADMIN_TOKEN_SECRET or is generated once into data/admin-token-secret.
 *   Changing a user's password (or removing the user) invalidates their tokens.
 * - Brute force: 5 failed logins for a username from one IP lock it for 15 min;
 *   30 failures from one IP lock that IP for 15 min.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJson, writeJson } = require('../utils/jsonStore');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MIN_PASSWORD_LENGTH = 10;
const SESSION_HOURS = Math.min(Math.max(parseFloat(process.env.ADMIN_SESSION_HOURS) || 8, 0.25), 72);
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_USER = 5;
const MAX_FAILS_PER_IP = 30;
const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

class AuthError extends Error {
  constructor(message, statusCode = 401, code = 'UNAUTHORIZED') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const adminsPath = () => process.env.ADMINS_PATH || path.join(__dirname, '..', '..', 'config', 'admins.json');
const secretPath = () => path.join(process.env.ALERT_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'admin-token-secret');

// ─── Accounts ─────────────────────────────────────────────────────────────────

function loadAdmins() {
  const data = readJson(adminsPath(), { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

function saveAdmins(users) {
  writeJson(adminsPath(), { users }, { keepBackups: 5 });
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
  return { salt, hash };
}

function checkPasswordPolicy(password) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password must contain letters and numbers';
  return null;
}

/** Create an admin, or reset an existing admin's password. */
function setAdminPassword(username, password) {
  const name = normalizeUsername(username);
  if (!USERNAME_RE.test(name)) throw new Error('Username must be 3-40 characters: letters, numbers, dot, dash, underscore');
  const problem = checkPasswordPolicy(password);
  if (problem) throw new Error(problem);

  const users = loadAdmins();
  const existing = users.find((u) => u.username === name);
  const { salt, hash } = hashPassword(password);
  if (existing) {
    Object.assign(existing, { salt, hash, tokenVersion: (existing.tokenVersion || 0) + 1, passwordChangedAt: new Date().toISOString() });
  } else {
    users.push({ username: name, salt, hash, tokenVersion: 1, createdAt: new Date().toISOString() });
  }
  saveAdmins(users);
  return { username: name, created: !existing };
}

function removeAdmin(username) {
  const name = normalizeUsername(username);
  const users = loadAdmins();
  const next = users.filter((u) => u.username !== name);
  if (next.length === users.length) return false;
  saveAdmins(next);
  return true;
}

function listAdmins() {
  return loadAdmins().map((u) => ({ username: u.username, createdAt: u.createdAt, passwordChangedAt: u.passwordChangedAt || null }));
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

let secretCache = null;

function getSecret() {
  if (secretCache) return secretCache;
  const fromEnv = process.env.ADMIN_TOKEN_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    secretCache = Buffer.from(fromEnv, 'utf8');
    return secretCache;
  }
  const file = secretPath();
  try {
    secretCache = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
    if (secretCache.length >= 32) return secretCache;
  } catch { /* create below */ }
  const fresh = crypto.randomBytes(48);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fresh.toString('hex'), { mode: 0o600 });
  secretCache = fresh;
  return secretCache;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', getSecret()).update(data).digest();

function issueToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.username, ver: user.tokenVersion || 1, iat: now, exp: now + Math.round(SESSION_HOURS * 3600), typ: 'ems-admin' };
  const body = b64url(JSON.stringify(payload));
  return { token: `${body}.${b64url(sign(body))}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

/**
 * Check a token; returns the admin's username or throws AuthError.
 * @param {string} token
 * @returns {{username:string, expiresAt:string}}
 */
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new AuthError('Please sign in');
  const [body, signature] = parts;
  const expected = sign(body);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new AuthError('Please sign in');

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new AuthError('Please sign in'); }
  if (payload.typ !== 'ems-admin') throw new AuthError('Please sign in');
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new AuthError('Your session has expired. Please sign in again.');

  const user = loadAdmins().find((u) => u.username === payload.sub);
  if (!user || (user.tokenVersion || 1) !== payload.ver) throw new AuthError('Please sign in');
  return { username: user.username, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

// ─── Login with lockout ───────────────────────────────────────────────────────

const failures = new Map(); // key → [timestamps]

function recentFailures(key, now) {
  const list = (failures.get(key) || []).filter((t) => now - t < LOCK_WINDOW_MS);
  if (list.length) failures.set(key, list); else failures.delete(key);
  return list;
}

// Used for unknown usernames so the response time doesn't reveal which exist
const DUMMY = hashPassword('not-a-real-password-0', '00000000000000000000000000000000');

/**
 * @param {string} username
 * @param {string} password
 * @param {string} ip
 * @returns {{token:string, expiresAt:string, username:string}}
 * @throws {AuthError} 401 wrong credentials, 429 locked
 */
function login(username, password, ip = 'unknown') {
  const name = normalizeUsername(username);
  const now = Date.now();
  const userKey = `u:${ip}:${name}`;
  const ipKey = `ip:${ip}`;

  if (recentFailures(userKey, now).length >= MAX_FAILS_PER_USER || recentFailures(ipKey, now).length >= MAX_FAILS_PER_IP) {
    throw new AuthError('Too many failed sign-in attempts. Try again in 15 minutes.', 429, 'LOCKED');
  }

  const user = loadAdmins().find((u) => u.username === name);
  const { hash } = hashPassword(password, user ? user.salt : DUMMY.salt);
  const stored = Buffer.from(user ? user.hash : DUMMY.hash, 'hex');
  const ok = !!user && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), stored);

  if (!ok) {
    for (const key of [userKey, ipKey]) failures.set(key, [...recentFailures(key, now), now]);
    throw new AuthError('Wrong username or password');
  }
  failures.delete(userKey);
  return { ...issueToken(user), username: user.username };
}

/** Test helper */
function resetForTests() {
  failures.clear();
  secretCache = null;
}

module.exports = {
  login,
  verifyToken,
  setAdminPassword,
  removeAdmin,
  listAdmins,
  checkPasswordPolicy,
  AuthError,
  MIN_PASSWORD_LENGTH,
  resetForTests,
};
