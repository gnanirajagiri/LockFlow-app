#!/usr/bin/env node
/**
 * Generate the demo-mode placeholder SVGs referenced by src/mock/gallerySeed.ts
 * and src/data/mockGalleryRepository.ts (placeholders/gallery/*.svg).
 *
 * Vite serves public/ as-is, so these files make the demo thumbnails (Gallery
 * cards, S79 campaign covers, S34 version rows) render real imagery instead
 * of falling back to initials. Fictional warm-toned product/lifestyle art
 * only — no real generated media is involved.
 *
 * Usage: node scripts/generate-placeholders.mjs
 * Checked in: run once; regenerate only if seed output ids change.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'public', 'placeholders', 'gallery');
mkdirSync(OUT_DIR, { recursive: true });

/** Warm LockFlow palette (matches tokens.css DS-01 foundations). */
const PALETTE = {
  cream: '#faf8f5',
  oat: '#f4f1ea',
  sand: '#e7e2da',
  ink: '#111827',
  muted: '#6b7280',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  lavender: '#ede9fe',
  gold: '#d4a85a',
  sage: '#a8bfa0',
  clay: '#c98d6b',
};

/** 4:3 artboard with a soft backdrop, plinth shadow and a centred motif. */
function artboard({ id, title, motif, backdrop, accent }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img" aria-label="${title} (placeholder)">
  <defs>
    <linearGradient id="bg-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${backdrop}"/>
      <stop offset="1" stop-color="${PALETTE.oat}"/>
    </linearGradient>
    <linearGradient id="ai-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${PALETTE.indigo}"/>
      <stop offset="1" stop-color="${PALETTE.violet}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg-${id})"/>
  <ellipse cx="400" cy="470" rx="240" ry="26" fill="${PALETTE.sand}" opacity="0.55"/>
  ${motif}
  <g opacity="0.9">
    <rect x="24" y="24" width="34" height="34" rx="10" fill="url(#ai-${id})"/>
    <path d="M37 33v16M31 41h12" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  <text x="30" y="566" font-family="Inter, system-ui, sans-serif" font-size="19" font-weight="600" fill="${PALETTE.ink}">${title}</text>
  <text x="30" y="588" font-family="Inter, system-ui, sans-serif" font-size="13" fill="${PALETTE.muted}">Placeholder preview · demo mode</text>
  <rect x="0.5" y="0.5" width="799" height="599" fill="none" stroke="${accent}" stroke-opacity="0.25"/>
</svg>
`;
}

function serumBottle(c) {
  return `
  <g>
    <rect x="356" y="250" width="88" height="34" rx="8" fill="${c.gold}"/>
    <rect x="344" y="284" width="112" height="190" rx="22" fill="#ffffff"/>
    <rect x="344" y="284" width="112" height="190" rx="22" fill="none" stroke="${c.sand}" stroke-width="2"/>
    <rect x="366" y="330" width="68" height="64" rx="6" fill="${c.lavender}"/>
    <rect x="374" y="342" width="52" height="4" rx="2" fill="${c.indigo}" opacity="0.65"/>
    <rect x="374" y="354" width="40" height="4" rx="2" fill="${c.indigo}" opacity="0.4"/>
    <rect x="374" y="366" width="46" height="4" rx="2" fill="${c.indigo}" opacity="0.3"/>
  </g>`;
}

function jar(c) {
  return `
  <g>
    <rect x="340" y="300" width="120" height="96" rx="18" fill="#ffffff" stroke="${c.sand}" stroke-width="2"/>
    <rect x="334" y="284" width="132" height="26" rx="10" fill="${c.sage}"/>
    <rect x="362" y="326" width="76" height="6" rx="3" fill="${c.muted}" opacity="0.5"/>
    <rect x="374" y="342" width="52" height="6" rx="3" fill="${c.muted}" opacity="0.3"/>
  </g>`;
}

function person(c) {
  return `
  <g>
    <circle cx="400" cy="250" r="52" fill="${c.clay}"/>
    <path d="M316 476c0-58 38-96 84-96s84 38 84 96" fill="#ffffff" stroke="${c.sand}" stroke-width="2"/>
    <path d="M356 402c14-18 30-26 44-26s30 8 44 26" fill="none" stroke="${c.lavender}" stroke-width="10" stroke-linecap="round"/>
  </g>`;
}

function mirrorScene(c) {
  return `
  <g>
    <rect x="300" y="200" width="200" height="250" rx="100 100 14 14" fill="#ffffff" stroke="${c.sand}" stroke-width="2"/>
    <circle cx="400" cy="300" r="64" fill="${c.lavender}"/>
    <rect x="330" y="440" width="140" height="12" rx="6" fill="${c.sand}"/>
    <rect x="368" y="452" width="64" height="24" rx="6" fill="${c.sage}"/>
  </g>`;
}

/** thumb variants: 1:1 crop of the same art with a compact caption band. */
function thumbOf(id, title, motif, backdrop, accent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img" aria-label="${title} thumbnail (placeholder)">
  <defs>
    <linearGradient id="tbg-${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${backdrop}"/>
      <stop offset="1" stop-color="${PALETTE.oat}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#tbg-${id})"/>
  <g transform="translate(-200 -90) scale(1)">${motif}</g>
  <rect x="0" y="330" width="400" height="70" fill="${PALETTE.cream}" opacity="0.92"/>
  <text x="20" y="372" font-family="Inter, system-ui, sans-serif" font-size="20" font-weight="600" fill="${PALETTE.ink}">${title}</text>
  <rect x="0.5" y="0.5" width="399" height="399" fill="none" stroke="${accent}" stroke-opacity="0.25"/>
</svg>
`;
}

const ART = [
  {
    id: 'gallery_morning_vanity_setup',
    title: 'Morning Vanity Setup',
    motif: mirrorScene(PALETTE),
    backdrop: PALETTE.lavender,
    accent: PALETTE.indigo,
  },
  {
    id: 'gallery_serum_product_moment',
    title: 'Serum Product Moment',
    motif: serumBottle(PALETTE),
    backdrop: PALETTE.cream,
    accent: PALETTE.gold,
  },
  {
    id: 'gallery_routine_wrapup_story',
    title: 'Routine Wrap-up Story',
    motif: jar(PALETTE),
    backdrop: PALETTE.oat,
    accent: PALETTE.sage,
  },
  {
    id: 'gallery_morning_routine_variant',
    title: 'Morning Routine Variant',
    motif: person(PALETTE),
    backdrop: PALETTE.cream,
    accent: PALETTE.clay,
  },
];

let count = 0;
for (const art of ART) {
  writeFileSync(join(OUT_DIR, `${art.id}.svg`), artboard(art));
  writeFileSync(join(OUT_DIR, `${art.id}-thumb.svg`), thumbOf(art.id, art.title, art.motif, art.backdrop, art.accent));
  count += 2;
}

// Fallback used by mockGalleryRepository.createOutput for new demo outputs.
writeFileSync(
  join(OUT_DIR, 'generic-output.svg'),
  artboard({
    id: 'generic',
    title: 'Generated output',
    motif: serumBottle(PALETTE),
    backdrop: PALETTE.cream,
    accent: PALETTE.indigo,
  }),
);
count += 1;

console.log(`Wrote ${count} placeholder SVGs to public/placeholders/gallery/`);
