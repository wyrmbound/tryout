#!/usr/bin/env node
// tryout: keeps a ledger of trial add-ons and removes them when their trial ends.
// Usage: node tryout.mjs <add|list|keep|extend|remove|check> [options]  (run with no args for help)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const HOUR = 3600e3, DAY = 24 * HOUR;
const KINDS = ['plugin', 'skill', 'mcp', 'manual'];
const SCOPES = ['user', 'project', 'local'];
// Names go to the claude CLI (through a shell on Windows), so only allow plain identifiers.
const SAFE = /^[\w.@:\/-]+$/;

const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const ledgerPath = () => process.env.TRYOUT_LEDGER || path.join(configDir(), 'tryout', 'trials.json');

export function load() {
  try { return JSON.parse(fs.readFileSync(ledgerPath(), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}

function save(trials) {
  const file = ledgerPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', JSON.stringify(trials, null, 2));
  fs.renameSync(file + '.tmp', file);
}

// Only a folder directly inside some ".claude/skills" (or CLAUDE_CONFIG_DIR/skills) may be deleted.
export function isSkillFolder(p) {
  const abs = path.resolve(p);
  const parent = path.dirname(abs);
  const root = path.dirname(parent);
  return path.basename(parent) === 'skills' &&
    (path.basename(root) === '.claude' || root === path.resolve(configDir()));
}

// Reminder window: 2 days, or half the trial for trials shorter than 4 days.
export function due(trials, now = Date.now()) {
  const expired = [], expiring = [];
  for (const t of trials) {
    const ends = Date.parse(t.ends), len = ends - Date.parse(t.started);
    if (ends <= now) expired.push(t);
    else if (ends - now <= Math.min(2 * DAY, len / 2)) expiring.push(t);
  }
  return { expired, expiring };
}

export function makeTrial(o, now = Date.now()) {
  const fail = (m) => { throw new Error(m); };
  if (!KINDS.includes(o.kind)) fail(`--kind must be one of ${KINDS.join(', ')}`);
  if (!o.name || !SAFE.test(o.name)) fail('--name is required and may only contain letters, digits and . _ @ : / -');
  if (o.scope && !SCOPES.includes(o.scope)) fail(`--scope must be one of ${SCOPES.join(', ')}`);
  if (o.marketplace && !SAFE.test(o.marketplace)) fail('--marketplace has unsafe characters');
  if (o.kind === 'plugin' && !o.name.includes('@')) fail('plugin --name must be plugin@marketplace');
  if (o.kind === 'skill' && !(o.path && isSkillFolder(o.path))) fail('skill --path must be a folder inside a .claude/skills directory');
  const ms = (Number(o.days) || 0) * DAY + (Number(o.hours) || 0) * HOUR;
  if (!(ms > 0)) fail('give a trial length with --days and/or --hours');
  const t = { name: o.name, kind: o.kind, started: new Date(now).toISOString(), ends: new Date(now + ms).toISOString() };
  if (o.source) t.source = o.source;
  if (o.scope) t.scope = o.scope;
  if (o.scope === 'project' || o.scope === 'local') t.cwd = process.cwd();
  if (o.marketplace) t.marketplace = o.marketplace;
  if (o.path) t.path = path.resolve(o.path);
  if (o.note) t.note = o.note;
  return t;
}

function claude(args, cwd) {
  // Windows needs a shell to find claude.cmd; args are SAFE-checked names, so joining is fine.
  const r = process.platform === 'win32'
    ? spawnSync(['claude', ...args].join(' '), { cwd, encoding: 'utf8', shell: true })
    : spawnSync('claude', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`claude ${args.join(' ')} failed: ${(r.stderr || r.stdout || r.error || '').toString().trim()}`);
  return r.stdout;
}

// Undo exactly what the trial installed. Throws on failure so the trial stays in the ledger.
export function uninstall(t, trials) {
  const cwd = t.cwd && fs.existsSync(t.cwd) ? t.cwd : undefined;
  if (t.kind === 'manual') throw new Error(`"${t.name}" must be removed by hand${t.note ? ': ' + t.note : ''}`);
  if (t.kind === 'skill') {
    if (!isSkillFolder(t.path)) throw new Error(`refusing to delete ${t.path}: not a skills folder`);
    fs.rmSync(t.path, { recursive: true, force: true });
  }
  if (t.kind === 'mcp') claude(['mcp', 'remove', t.name, ...(t.scope ? ['-s', t.scope] : [])], cwd);
  if (t.kind === 'plugin') {
    claude(['plugin', 'uninstall', t.name, '-s', t.scope || 'user'], cwd);
    const mk = t.marketplace;
    const otherTrial = trials.some((o) => o !== t && o.marketplace === mk);
    // Keep the marketplace if anything still installed (kept plugins included) comes from it.
    const stillUsed = mk && JSON.parse(claude(['plugin', 'list', '--json'], cwd)).some((p) => p.id.endsWith('@' + mk));
    if (mk && !otherTrial && !stillUsed) claude(['plugin', 'marketplace', 'remove', mk], cwd);
  }
}

function find(trials, name) {
  const t = trials.find((x) => x.name === name);
  if (!t) throw new Error(`no trial named "${name}" (see: list)`);
  return t;
}

const fmt = (t, now = Date.now()) => {
  const left = Date.parse(t.ends) - now;
  const when = left <= 0 ? 'ended' : left < DAY ? `${Math.ceil(left / HOUR)}h left` : `${Math.round(left / DAY)}d left`;
  return `- ${t.name} (${t.kind}) ends ${t.ends.slice(0, 16).replace('T', ' ')} UTC, ${when}${t.source ? ' — ' + t.source : ''}`;
};

// SessionStart hook: remove expired trials, tell Claude what ends soon.
function check() {
  let trials = load();
  const { expired, expiring } = due(trials);
  const removed = [], failed = [];
  for (const t of expired) {
    try { uninstall(t, trials); removed.push(t); trials = trials.filter((x) => x !== t); }
    catch (e) { failed.push(`${t.name}: ${e.message}`); }
  }
  if (removed.length) save(trials);
  const ctx = [];
  if (removed.length) ctx.push(`Tryout removed these add-ons because their trial ended unanswered (takes full effect after a restart):\n${removed.map((t) => fmt(t)).join('\n')}\nTell the user in one line.`);
  if (failed.length) ctx.push(`Tryout could not remove these expired trials:\n${failed.map((f) => '- ' + f).join('\n')}\nTell the user and help them remove these.`);
  if (expiring.length) ctx.push(`Tryout trials ending soon:\n${expiring.map((t) => fmt(t)).join('\n')}\nEarly in this session, ask the user once whether to keep, extend or remove each (use the tryout skill). If they don't answer, do nothing: unanswered trials are removed automatically when they end.`);
  if (!ctx.length) return;
  const out = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx.join('\n\n') } };
  if (removed.length || failed.length) out.systemMessage = `tryout: ${removed.length} trial(s) removed${failed.length ? `, ${failed.length} need manual removal` : ''}`;
  process.stdout.write(JSON.stringify(out));
}

function parse(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else o._.push(argv[i]);
  }
  return o;
}

const HELP = `tryout — trial add-ons for Claude Code
  add     --kind plugin|skill|mcp|manual --name <id> --days N [--hours N]
          [--source <url>] [--scope user|project|local] [--marketplace <name>]
          [--path <skill folder>] [--note <how to remove by hand>]
  list                      show trials and time left
  keep    <name>            make permanent (forget the trial, touch nothing)
  extend  <name> --days N   push the end date back
  remove  <name>            uninstall now and forget
  check                     SessionStart hook: auto-remove ended trials
Ledger: ${ledgerPath()}`;

function main() {
  const o = parse(process.argv.slice(2));
  const [cmd, name] = o._;
  let trials = load();
  if (cmd === 'check') return check();
  if (cmd === 'add') {
    const t = makeTrial(o);
    if (trials.some((x) => x.name === t.name)) throw new Error(`"${t.name}" is already on trial (use extend)`);
    save([...trials, t]);
    return console.log(`trial started:\n${fmt(t)}`);
  }
  if (cmd === 'list') return console.log(trials.length ? trials.map((t) => fmt(t)).join('\n') : 'no trials');
  if (cmd === 'keep') { const t = find(trials, name); save(trials.filter((x) => x !== t)); return console.log(`kept ${t.name} permanently`); }
  if (cmd === 'extend') {
    const t = find(trials, name);
    const ms = (Number(o.days) || 0) * DAY + (Number(o.hours) || 0) * HOUR;
    if (!(ms > 0)) throw new Error('give --days and/or --hours');
    t.ends = new Date(Math.max(Date.parse(t.ends), Date.now()) + ms).toISOString();
    save(trials);
    return console.log(`extended:\n${fmt(t)}`);
  }
  if (cmd === 'remove') { const t = find(trials, name); uninstall(t, trials); save(trials.filter((x) => x !== t)); return console.log(`removed ${t.name}`); }
  console.log(HELP);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (e) { console.error(`tryout: ${e.message}`); process.exit(1); }
}
