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

/** Boards that are design-system specs (not pages) and were verified
 *  directly against the code instead of a page-fidelity commit. */
const VERIFIED_SPECS = new Set([
  'DS-01', // foundations — token values verified against src/styles/tokens.css
  'DS-02', // components — all variants exist in src/components/ui + page CSS
]);

let log;
try {
  log = execSync('git log --format=%B', { encoding: 'utf8' });
} catch {
  console.error('Not a git repository (or git unavailable).');
  process.exit(1);
}

const covered = [];
const verified = [];
const missing = [];
for (const board of boards) {
  // Strip extension and match the board code: "S31-model-character-sheet.png"
  // → "S31" (or the full stem when there is no code, e.g. "foundations").
  const stem = board.replace(/\.png$/, '');
  const code = stem.match(/^[A-Z]+-?\d+/)?.[0] ?? stem;
  if (VERIFIED_SPECS.has(code)) {
    verified.push(board);
    continue;
  }
  const pattern = new RegExp(`(^|[^\\w-])(${escapeRegExp(code)}|${escapeRegExp(stem)})`, 'i');
  if (pattern.test(log)) {
    covered.push(board);
  } else {
    missing.push(board);
  }
}

console.log(
  `Boards: ${boards.length} · covered by commits: ${covered.length} · verified specs: ${verified.length} · not yet committed: ${missing.length}\n`,
);
if (verified.length > 0) {
  console.log('Verified design-system specs (no page work needed):');
  for (const board of verified) console.log(`  ◆ ${board}`);
  console.log();
}
if (missing.length > 0) {
  console.log('Not yet covered:');
  for (const board of missing) console.log(`  ✗ ${board}`);
}
if (covered.length > 0) {
  console.log('Covered:');
  for (const board of covered) console.log(`  ✓ ${board}`);
}
process.exit(missing.length > 0 ? 1 : 0);

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
