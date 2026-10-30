// Run from the repo root: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { due, isSkillFolder, makeTrial } from '../skills/tryout/tryout.mjs';

const CLI = path.resolve('skills/tryout/tryout.mjs');
const DAY = 86400e3;

test('due: expired, expiring and quiet trials', () => {
  const now = Date.parse('2026-01-10T00:00:00Z');
  const t = (started, ends) => ({ name: ends, started, ends });
  const r = due([
    t('2026-01-01T00:00:00Z', '2026-01-09T00:00:00Z'), // ended
    t('2026-01-01T00:00:00Z', '2026-01-11T00:00:00Z'), // 1 day left of 10
    t('2026-01-01T00:00:00Z', '2026-01-20T00:00:00Z'), // 10 days left
    t('2026-01-09T12:00:00Z', '2026-01-10T12:00:00Z'), // 12h left of a 1-day trial: half-way
    t('2026-01-09T23:00:00Z', '2026-01-10T23:00:00Z'), // 23h left of a 1-day trial: too early
  ], now);
  assert.deepEqual(r.expired.map((x) => x.name), ['2026-01-09T00:00:00Z']);
  assert.deepEqual(r.expiring.map((x) => x.name), ['2026-01-11T00:00:00Z', '2026-01-10T12:00:00Z']);
});

test('isSkillFolder only accepts folders inside .claude/skills', () => {
  assert.ok(isSkillFolder('/home/a/.claude/skills/foo'));
  assert.ok(isSkillFolder('/repo/.claude/skills/foo'));
  assert.ok(!isSkillFolder('/home/a/.claude/skills'));
  assert.ok(!isSkillFolder('/home/a/.claude'));
  assert.ok(!isSkillFolder('/home/a/skills/foo'));
  assert.ok(!isSkillFolder('/home/a/.claude/skills/foo/../../..'));
});

test('makeTrial validates input', () => {
  assert.throws(() => makeTrial({ kind: 'plugin', name: 'x; rm -rf /', days: 1 }), /--name/);
  assert.throws(() => makeTrial({ kind: 'plugin', name: 'noat', days: 1 }), /plugin@marketplace/);
  assert.throws(() => makeTrial({ kind: 'mcp', name: 'srv' }), /trial length/);
  assert.throws(() => makeTrial({ kind: 'skill', name: 's', days: 1, path: '/etc' }), /skills/);
  const t = makeTrial({ kind: 'mcp', name: 'srv', days: 2, hours: 12 }, 0);
  assert.equal(Date.parse(t.ends), 2.5 * DAY);
});

test('CLI: skill trial is recorded, then removed by check once it ends', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tryout-'));
  const skill = path.join(tmp, '.claude', 'skills', 'demo');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: demo\n---\n');
  const env = { ...process.env, TRYOUT_LEDGER: path.join(tmp, 'trials.json') };
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a], { env, encoding: 'utf8' });

  assert.equal(run('add', '--kind', 'skill', '--name', 'demo', '--hours', '1', '--path', skill).status, 0);
  assert.equal(run('check').stdout, '', 'nothing due yet');

  const ledger = JSON.parse(fs.readFileSync(env.TRYOUT_LEDGER, 'utf8'));
  ledger[0].ends = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(env.TRYOUT_LEDGER, JSON.stringify(ledger));

  const out = JSON.parse(run('check').stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /removed/);
  assert.ok(!fs.existsSync(skill), 'skill folder deleted');
  assert.ok(fs.existsSync(path.dirname(skill)), 'skills dir kept');
  assert.deepEqual(JSON.parse(fs.readFileSync(env.TRYOUT_LEDGER, 'utf8')), []);
  fs.rmSync(tmp, { recursive: true, force: true });
});
