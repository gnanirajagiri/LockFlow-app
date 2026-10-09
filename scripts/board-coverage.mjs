#!/usr/bin/env node
/**
 * Board coverage check — lists Stage-5 design boards (public/boards/*.png)
 * that have never been mentioned in a commit message, i.e. fidelity work
 * that has not been started (or at least not committed).
 *
 * Usage: node scripts/board-coverage.mjs
 */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const boardsDir = join(process.cwd(), 'public', 'boards');
const boards = readdirSync(boardsDir)
  .filter((name) => name.endsWith('.png'))
  .sort();

let log;
try {
  log = execSync('git log --format=%B', { encoding: 'utf8' });
} catch {
  console.error('Not a git repository (or git unavailable).');
  process.exit(1);
}

const covered = [];
const missing = [];
for (const board of boards) {
  // Strip extension and match the board code: "S31-model-character-sheet.png"
  // → "S31" (or the full stem when there is no code, e.g. "foundations").
  const stem = board.replace(/\.png$/, '');
  const code = stem.match(/^[A-Z]+\d+/)?.[0] ?? stem;
  const pattern = new RegExp(`(^|[^\\w-])(${escapeRegExp(code)}|${escapeRegExp(stem)})`, 'i');
  if (pattern.test(log)) {
    covered.push(board);
  } else {
    missing.push(board);
  }
}

console.log(`Boards: ${boards.length} · covered by commits: ${covered.length} · not yet committed: ${missing.length}\n`);
if (missing.length > 0) {
  console.log('Not yet covered:');
  for (const board of missing) console.log(`  ✗ ${board}`);
}
if (covered.length > 0) {
  console.log('\nCovered:');
  for (const board of covered) console.log(`  ✓ ${board}`);
}
process.exit(missing.length > 0 ? 1 : 0);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
