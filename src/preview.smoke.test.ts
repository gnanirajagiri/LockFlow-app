// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Preview smoke test: boots the built `dist-preview/index.html` single file
 * inside happy-dom and asserts the app shell actually renders. Catches
 * regressions where the inlined bundle stops executing (bad chunk inlining,
 * top-level errors, missing DOM anchor, …) — the failure mode that is
 * invisible to both tsc and unit tests of the unbundled source.
 */

const previewPath = resolve(process.cwd(), 'dist-preview/index.html');

/**
 * happy-dom does not execute `<script type="module">` injected via
 * document.write, so we write the HTML for the DOM tree and then eval the
 * inlined bundle ourselves. The single-chunk preview bundle is authored with
 * no module imports/exports (Rollup inlineDynamicImports), so classic
 * evaluation is faithful to how the module executes in a browser.
 */
function bootPreview() {
  const html = readFileSync(previewPath, 'utf8');
  document.open();
  document.write(html.replace(/<script type="module">[\s\S]*<\/script>/, ''));
  document.close();

  const js = /<script type="module">\n([\s\S]*)\n<\/script>/.exec(html)?.[1];
  expect(js, 'inlined module script present').toBeTruthy();
  const source = (js as string)
    // Vite/Rollup emit `import.meta.env` style references only under module
    // semantics; neutralise them so classic evaluation is faithful.
    .replace(/import\.meta\./g, '({}).')
    .replace(/\bimport\.meta\b/g, '({})');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional eval of our own build artifact
  const run = new Function(source);
  run();
  return html;
}

describe('dist-preview single-file boot', () => {
  const exists = (() => {
    try {
      readFileSync(previewPath, 'utf8');
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!exists)('renders the app shell from the inlined bundle', async () => {
    const html = bootPreview();

    expect(html).toContain('<script type="module">');
    expect(html).not.toMatch(/<link[^>]+rel="modulepreload"/); // stale chunk links stripped
    expect(html).toContain('--lf-color-primary-500'); // design tokens inlined

    // Route components are lazy() — poll until the shell (sidebar) mounts.
    const root = document.getElementById('root');
    expect(root, '#root exists in built html').toBeTruthy();
    const deadline = Date.now() + 2000;
    while (
      Date.now() < deadline &&
      !(document.querySelector('.lf-shell') && document.querySelector('.lf-sidebar'))
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(document.querySelector('.lf-shell'), 'app shell renders from the inlined bundle').toBeTruthy();
    expect(document.querySelector('.lf-sidebar'), 'sidebar renders from the inlined bundle').toBeTruthy();
    expect(root!.innerHTML.length, 'React rendered content into #root').toBeGreaterThan(200);
  });
});
