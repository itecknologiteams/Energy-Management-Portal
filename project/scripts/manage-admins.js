'use strict';

/**
 * Manage admin accounts for the alert email portal (/admin).
 *
 *   npm run admin -- add <username>        create an admin (asks for the password)
 *   npm run admin -- password <username>   change a password (signs that admin out everywhere)
 *   npm run admin -- remove <username>     delete an admin
 *   npm run admin -- list                  list admins
 *
 * Accounts are stored in config/admins.json with scrypt password hashes.
 */

require('dotenv').config();

const readline = require('readline');
const { setAdminPassword, removeAdmin, listAdmins, checkPasswordPolicy, MIN_PASSWORD_LENGTH } = require('../src/services/adminAuth');

// One reader for every prompt, so piped input (and fast typing) is never lost.
// Typed characters are not echoed.
let rl = null;
let muted = false;
const lines = [];
const waiting = [];

function reader() {
  if (rl) return rl;
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const write = rl._writeToOutput;
  rl._writeToOutput = (str) => { if (!muted) write.call(rl, str); };
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
  rl.on('close', () => { while (waiting.length) waiting.shift()(null); });
  return rl;
}

function askHidden(question) {
  reader();
  process.stdout.write(question);
  muted = true;
  return new Promise((resolve) => {
    const done = (answer) => { muted = false; process.stdout.write('\n'); resolve(answer); };
    if (lines.length) done(lines.shift()); else waiting.push(done);
  });
}

async function askNewPassword() {
  const first = await askHidden(`New password (min ${MIN_PASSWORD_LENGTH} chars, letters and numbers): `);
  if (first === null) throw new Error('No password entered');
  const problem = checkPasswordPolicy(first);
  if (problem) throw new Error(problem);
  const second = await askHidden('Repeat password: ');
  if (second === null) throw new Error('No password entered');
  if (first !== second) throw new Error('Passwords do not match');
  return first;
}

async function main() {
  const [command, username] = process.argv.slice(2);

  switch (command) {
    case 'add':
    case 'password': {
      if (!username) throw new Error(`Usage: npm run admin -- ${command} <username>`);
      const exists = listAdmins().some((u) => u.username === username.trim().toLowerCase());
      if (command === 'add' && exists) throw new Error(`Admin "${username}" already exists. Use: npm run admin -- password ${username}`);
      if (command === 'password' && !exists) throw new Error(`No admin named "${username}". Use: npm run admin -- add ${username}`);
      const password = await askNewPassword();
      const result = setAdminPassword(username, password);
      console.log(result.created ? `Admin "${result.username}" created.` : `Password changed for "${result.username}". Their existing sessions are signed out.`);
      break;
    }
    case 'remove': {
      if (!username) throw new Error('Usage: npm run admin -- remove <username>');
      console.log(removeAdmin(username) ? `Admin "${username}" removed.` : `No admin named "${username}".`);
      break;
    }
    case 'list': {
      const admins = listAdmins();
      if (admins.length === 0) console.log('No admins yet. Create one: npm run admin -- add <username>');
      for (const a of admins) console.log(`${a.username}  (created ${a.createdAt}${a.passwordChangedAt ? `, password changed ${a.passwordChangedAt}` : ''})`);
      break;
    }
    default:
      console.log('Usage: npm run admin -- add|password|remove <username>   or   npm run admin -- list');
      process.exit(command ? 1 : 0);
  }
}

main().then(() => { if (rl) rl.close(); }).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
