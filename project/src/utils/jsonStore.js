'use strict';

/**
 * Small, safe JSON file storage for server-side settings.
 *
 * - Writes are atomic: data goes to a temporary file that is then renamed over
 *   the real one, so a crash mid-write never leaves a half-written file.
 * - Before each overwrite the previous version is copied to a backups folder;
 *   the newest `keepBackups` copies are kept.
 * - Files are created with owner-only permissions (0600) where the OS allows.
 */

const fs = require('fs');
const path = require('path');

/**
 * Read and parse a JSON file.
 * @param {string} file
 * @param {*} fallback - returned when the file does not exist
 * @returns {*}
 * @throws {Error} when the file exists but is not valid JSON
 */
function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Atomically write `data` as pretty JSON, keeping a backup of the old file.
 * @param {string} file
 * @param {*} data
 * @param {{keepBackups?:number}} [options]
 */
function writeJson(file, data, { keepBackups = 20 } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  if (keepBackups > 0 && fs.existsSync(file)) {
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const base = path.basename(file, '.json');
    fs.copyFileSync(file, path.join(backupDir, `${base}-${timestampForFile()}.json`));
    const old = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith(`${base}-`) && f.endsWith('.json'))
      .sort();
    for (const f of old.slice(0, Math.max(0, old.length - keepBackups))) {
      try { fs.unlinkSync(path.join(backupDir, f)); } catch { /* best effort */ }
    }
  }

  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Append one JSON object as a line (JSON Lines format).
 * @param {string} file
 * @param {Object} entry
 */
function appendJsonLine(file, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/**
 * Read a JSON Lines file, skipping blank or corrupt lines.
 * @param {string} file
 * @returns {Object[]}
 */
function readJsonLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a corrupt line */ }
  }
  return out;
}

/**
 * Keep only the newest `maxLines` lines of a JSON Lines file.
 * @param {string} file
 * @param {number} maxLines
 */
function trimJsonLines(file, maxLines) {
  const entries = readJsonLines(file);
  if (entries.length <= maxLines) return;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, entries.slice(-maxLines).map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

module.exports = { readJson, writeJson, appendJsonLine, readJsonLines, trimJsonLines };
