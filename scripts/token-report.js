#!/usr/bin/env node
// Token usage per session, read from Claude Code's own transcripts.
//
// One session is roughly one ticket (CLAUDE.md §11), so per-session totals are
// per-ticket totals. Where a session opened with /start N or /merged N, the
// number is pulled out and shown, which is what makes cost-per-ticket legible.
//
//   npm run tokens              last 15 sessions
//   npm run tokens -- --all     every session
//   npm run tokens -- --steps   per-turn detail for the newest session

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Opus 5, $/1M. Cache read is ~0.1x input, cache write ~1.25x.
// Change these if the model changes — nothing else reads them.
const RATE = { input: 5.0, cacheWrite: 6.25, cacheRead: 0.5, output: 25.0 };

const PROJECT = process.cwd().replace(/\//g, '-');
const DIR = join(homedir(), '.claude', 'projects', PROJECT);

const cost = (t) =>
  (t.input * RATE.input +
    t.cacheWrite * RATE.cacheWrite +
    t.cacheRead * RATE.cacheRead +
    t.output * RATE.output) /
  1e6;

const usd = (n) => '$' + n.toFixed(2);
const num = (n) => n.toLocaleString('en-US');

/** Pull `/start 5` or `/merged 71` out of the first user turn, if it is there. */
function label(text) {
  const m = /<command-name>\/(start|merged)<\/command-name>\s*<command-args>(\d+)/.exec(text);
  if (m) return `/${m[1]} ${m[2]}`;
  const n = /\/(start|merged)\s+(\d+)/.exec(text);
  return n ? `/${n[1]} ${n[2]}` : '';
}

function readSession(file) {
  const totals = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  const turns = [];
  let head = '';

  for (const line of readFileSync(join(DIR, file), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a partial trailing line while a session is live
    }

    if (!head && entry.type === 'user') {
      const c = entry.message?.content;
      if (typeof c === 'string') head = c;
      else if (Array.isArray(c)) head = c.find((p) => p.type === 'text')?.text ?? '';
    }

    const u = entry.message?.usage;
    if (!u) continue;
    const turn = {
      input: u.input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      output: u.output_tokens ?? 0,
    };
    for (const k of Object.keys(totals)) totals[k] += turn[k];
    turns.push(turn);
  }
  return { file, totals, turns, label: label(head) };
}

const args = process.argv.slice(2);
let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.jsonl'));
} catch {
  console.error(`No transcripts at ${DIR}`);
  process.exit(1);
}

const sessions = files
  .map((f) => ({ ...readSession(f), mtime: statSync(join(DIR, f)).mtimeMs }))
  .filter((s) => s.turns.length)
  .sort((a, b) => a.mtime - b.mtime);

const shown = args.includes('--all') ? sessions : sessions.slice(-15);

if (args.includes('--steps')) {
  const s = sessions.at(-1);
  console.log(`\nPer-turn — ${s.file.slice(0, 8)} ${s.label}\n`);
  console.log('  turn   context-in      output      cost');
  s.turns.forEach((t, i) => {
    const ctx = t.input + t.cacheWrite + t.cacheRead;
    console.log(
      `  ${String(i + 1).padStart(4)} ${num(ctx).padStart(12)} ${num(t.output).padStart(11)} ${usd(cost(t)).padStart(9)}`,
    );
  });
  console.log(`\n  total ${usd(cost(s.totals))} over ${s.turns.length} turns\n`);
  process.exit(0);
}

console.log('\n  session   what          turns     cache-wr      cache-rd       output       cost');
console.log('  ' + '-'.repeat(84));

for (const s of shown) {
  const d = new Date(s.mtime).toISOString().slice(5, 10);
  console.log(
    `  ${s.file.slice(0, 8)}  ${(s.label || d).padEnd(12)} ${String(s.turns.length).padStart(5)} ` +
      `${num(s.totals.cacheWrite).padStart(12)} ${num(s.totals.cacheRead).padStart(13)} ` +
      `${num(s.totals.output).padStart(12)} ${usd(cost(s.totals)).padStart(10)}`,
  );
}

const all = shown.reduce(
  (a, s) => {
    for (const k of Object.keys(a)) a[k] += s.totals[k];
    return a;
  },
  { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
);
const turns = shown.reduce((n, s) => n + s.turns.length, 0);

console.log('  ' + '-'.repeat(84));
console.log(
  `  TOTAL                   ${String(turns).padStart(5)} ${num(all.cacheWrite).padStart(12)} ` +
    `${num(all.cacheRead).padStart(13)} ${num(all.output).padStart(12)} ${usd(cost(all)).padStart(10)}`,
);

const readShare = (all.cacheRead * RATE.cacheRead) / 1e6 / cost(all);
const outShare = (all.output * RATE.output) / 1e6 / cost(all);
console.log(
  `\n  Re-reading context: ${(readShare * 100).toFixed(0)}% of spend  ·  ` +
    `writing replies: ${(outShare * 100).toFixed(0)}%  ·  ` +
    `${num(Math.round(all.cacheRead / turns))} tokens of context per turn, average\n`,
);
