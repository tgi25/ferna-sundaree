'use strict';
// The IPC gate. Exactly one channel ("ferna") reaches the main process, and only
// from the main frame of a Ferna-created internal view on the ferna:// scheme.
// Every command declares which internal hosts may call it and the type of each
// argument; anything else is rejected before a handler runs.

const { ipcMain } = require('electron');

const internalContents = new Set(); // webContents ids of views Ferna created with the internal preload

function registerInternal(wc) {
  internalContents.add(wc.id);
  wc.once('destroyed', () => internalContents.delete(wc.id));
}

const MAX_STRING = 64 * 1024;
const MAX_BYTES = 400 * 1024 * 1024;

function checkType(type, v) {
  const optional = type.endsWith('?');
  const t = optional ? type.slice(0, -1) : type;
  if (v === undefined || v === null) return optional;
  switch (t) {
    case 'int': return Number.isInteger(v) && Math.abs(v) < 2 ** 31;
    case 'num': return typeof v === 'number' && Number.isFinite(v);
    case 'bool': return typeof v === 'boolean';
    case 'string': return typeof v === 'string' && v.length <= MAX_STRING;
    case 'text': return typeof v === 'string' && v.length <= 8 * 1024 * 1024;
    case 'bytes': return v instanceof Uint8Array && v.byteLength <= MAX_BYTES;
    case 'object': return typeof v === 'object' && !Array.isArray(v) && JSON.stringify(v).length <= 4 * 1024 * 1024;
    case 'array': return Array.isArray(v) && JSON.stringify(v).length <= 4 * 1024 * 1024;
    case 'any': return JSON.stringify(v).length <= 4 * 1024 * 1024;
    default: return false;
  }
}

function senderHost(event) {
  const frame = event.senderFrame;
  if (!frame || frame.parent) return null; // main frame only
  if (!internalContents.has(event.sender.id)) return null;
  let u;
  try { u = new URL(frame.url); } catch { return null; }
  if (u.protocol !== 'ferna:') return null;
  return u.host;
}

const commands = new Map();

/**
 * @param {string} name
 * @param {string[]} types   argument types, e.g. ['int', 'string?']
 * @param {string[]|'*'} hosts  internal hosts allowed to call it
 * @param {(ctx:{event, host, wc}, ...args) => any} fn
 */
function command(name, types, hosts, fn) {
  commands.set(name, { types, hosts, fn });
}

const rejected = [];

function install() {
  ipcMain.handle('ferna', async (event, name, ...args) => {
    const host = senderHost(event);
    const cmd = typeof name === 'string' ? commands.get(name) : null;
    const fail = reason => {
      rejected.push({ name: String(name).slice(0, 64), reason, at: Date.now() });
      if (rejected.length > 200) rejected.shift();
      throw new Error(`Rejected: ${reason}`);
    };
    if (!host) return fail('sender is not a Ferna internal page');
    if (!cmd) return fail('unknown command');
    if (cmd.hosts !== '*' && !cmd.hosts.includes(host)) return fail(`command not allowed from ${host}`);
    if (args.length > cmd.types.length) return fail('too many arguments');
    for (let i = 0; i < cmd.types.length; i++) {
      if (!checkType(cmd.types[i], args[i])) return fail(`argument ${i + 1} must be ${cmd.types[i]}`);
    }
    return cmd.fn({ event, host, wc: event.sender }, ...args);
  });
  // No other channel is ever listened to.
}

module.exports = { install, command, registerInternal, checkType, rejected, internalContents };
