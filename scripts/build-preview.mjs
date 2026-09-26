/**
 * Builds a self-contained `dist-preview/index.html` by inlining the built
 * CSS/JS from `dist/`. Used for environment previews where only a single file
 * can be served. Run: `npm run build:preview` (runs `vite build` first).
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const distDir = 'dist';
const entries = await readdir(distDir, { recursive: true });

const jsEntry = entries.find((f) => f.startsWith('assets/') && f.endsWith('.js'));
const cssEntry = entries.find((f) => f.startsWith('assets/') && f.endsWith('.css'));

if (!jsEntry || !cssEntry) {
  console.error('Expected built JS and CSS under dist/assets — run `vite build` first.');
  process.exit(1);
}

const html = await readFile(join(distDir, 'index.html'), 'utf8');
const css = await readFile(join(distDir, cssEntry), 'utf8');
const js = await readFile(join(distDir, jsEntry), 'utf8');

const inlined = html
  .replace(
    /<link rel="stylesheet"[^>]*>/,
    () => `<style>\n${css}\n</style>`,
  )
  .replace(
    /<script type="module"[^>]*><\/script>/,
    () => `<script type="module">\n${js.replace(/<\/script>/g, '<\\/script>')}\n</script>`,
  );

await mkdir('dist-preview', { recursive: true });
await writeFile('dist-preview/index.html', inlined, 'utf8');
console.log('Wrote dist-preview/index.html (single self-contained file).');
