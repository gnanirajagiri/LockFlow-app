/**
 * Builds a self-contained `dist-preview/index.html` by inlining the built
 * CSS/JS from `dist/`. Used for environment previews where only a single file
 * can be served. Run: `npm run build:preview` (runs `vite build` first).
 *
 * Route-level code splitting means `dist/` ships many chunks whose imports
 * reference files that no longer exist once everything is inlined into one
 * HTML file. Instead of re-linking a chunk graph, this script re-bundles the
 * app with Rollup's `inlineDynamicImports` — one classic chunk, no dynamic
 * import() statements — which is exactly what a single-file preview needs.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'vite';

process.env.NODE_ENV = 'production'; // ensure prod builds of React/router in the re-bundle

const distDir = 'dist';
const html = await readFile(join(distDir, 'index.html'), 'utf8');

// Capture the single-chunk re-bundle from Vite's programmatic API.
let captured;
await build({
  logLevel: 'error',
  configFile: false,
  root: process.cwd(),
  base: './',
  plugins: [
    {
      name: 'single-chunk-capture',
      generateBundle(_options, bundle) {
        captured = Object.values(bundle).filter((f) => f.type === 'chunk');
      },
      // Route pages still use dynamic import() in source. With
      // inlineDynamicImports Rollup resolves those in-bundle; nothing to do.
    },
  ],
  mode: 'production',
  build: {
    outDir: 'dist-preview-tmp',
    emptyOutDir: true,
    write: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});

const jsEntry = captured.find((c) => c.isEntry);
if (!jsEntry) {
  console.error('Expected a single entry chunk from the preview re-bundle.');
  process.exit(1);
}
const js = jsEntry.code.replace(/<\/script>/g, '<\\/script>');

const cssAsset = /<link rel="stylesheet"[^>]*href="\.\/([^"]+\.css)"/.exec(html)?.[1];
if (!cssAsset) {
  console.error('Expected a stylesheet link in dist/index.html.');
  process.exit(1);
}
let css = await readFile(join(distDir, cssAsset), 'utf8');

// The single-file preview ships no asset files, so any url(./xxx.woff2)
// reference in the CSS would 404 and silently drop the self-hosted fonts.
// Inline every emitted font as a base64 data: URI.
const fontRefs = [...css.matchAll(/url\(\.\/([^)]+\.woff2)\)/g)];
for (const [, fontFile] of fontRefs) {
  const fontData = await readFile(join(distDir, 'assets', fontFile));
  css = css.replaceAll(
    `url(./${fontFile})`,
    `url(data:font/woff2;base64,${fontData.toString('base64')})`,
  );
}
if (fontRefs.length) {
  console.log(`Inlined ${fontRefs.length} font file(s) as data: URIs.`);
}

// When the single file is served from a sub-path (…/dist-preview/index.html)
// the router would match that URL against no route and render 404. Normalize
// to '/' before the app boots. try/catch keeps file:// booting intact.
const bootGuard = `<script>try{if(/\\/index\\.html$/.test(location.pathname)){history.replaceState(null,'','/');}}catch(e){}</script>`;

const inlined = html
  .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module"[^>]*><\/script>/, () => `${bootGuard}\n<script type="module">\n${js}\n</script>`)
  // Module-preload links point at files that no longer exist once inlined.
  .replace(/<link rel="modulepreload"[^>]*>\n?/g, '');

await mkdir('dist-preview', { recursive: true });
await writeFile('dist-preview/index.html', inlined, 'utf8');
console.log(
  `Wrote dist-preview/index.html (single self-contained file; entry chunk ${(js.length / 1024).toFixed(0)}kB inlined).`,
);
