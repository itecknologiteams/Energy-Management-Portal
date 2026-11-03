'use strict';

/**
 * JSON file store — a small object persisted to one file beside the API,
 * for settings that do not belong in the shared production databases.
 *
 * Writes are serialised and go through a temp file + rename, so concurrent
 * requests cannot overwrite each other and a crash never leaves a
 * half-written file.
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} filePath
 * @returns {{ file: string, read: () => Promise<Object>, update: (change: (data: Object) => any) => Promise<any> }}
 */
function createJsonFileStore(filePath) {
  let writeQueue = Promise.resolve();

  async function read() {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async function write(data) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmp, filePath);
  }

  /**
   * Apply `change` to the stored object and save, one change at a time.
   * @param {(data: Object) => any} change - mutates data, returns the result
   */
  function update(change) {
    const run = writeQueue.then(async () => {
      const data = await read();
      const result = change(data);
      await write(data);
      return result;
    });
    // Keep the queue alive even if this change fails
    writeQueue = run.catch(() => {});
    return run;
  }

  return { file: filePath, read, update };
}

module.exports = { createJsonFileStore };
