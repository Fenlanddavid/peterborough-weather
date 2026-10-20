import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
type InstallHandler = (event: { waitUntil: (work: Promise<void>) => void }) => void;

test('installs lazy chunks, their CSS and images before making the app available offline', async () => {
  const scope = 'https://example.com/peterborough-weather/';
  const cached: string[] = [];
  const handlers = new Map<string, InstallHandler>();
  let activated = false;
  runInNewContext(source, {
    URL,
    self: {
      registration: { scope },
      addEventListener: (name: string, handler: InstallHandler) => handlers.set(name, handler),
      skipWaiting: async () => { activated = true; },
    },
    caches: { open: async () => ({ addAll: async (assets: string[]) => { cached.push(...assets); } }) },
    fetch: async (url: URL) => {
      assert.equal(url.href, `${scope}asset-manifest.json`);
      return Response.json({
        'index.html': { file: 'assets/index.js', css: ['assets/index.css'], dynamicImports: ['src/views/Trends.tsx'] },
        'src/views/Trends.tsx': { file: 'assets/Trends.js', css: ['assets/charts.css'], assets: ['assets/chart.png'] },
      });
    },
  });
  let installation: Promise<void> | undefined;
  handlers.get('install')!({ waitUntil: (work) => { installation = work; } });
  await installation;
  for (const asset of ['assets/index.js', 'assets/index.css', 'assets/Trends.js', 'assets/charts.css', 'assets/chart.png']) {
    assert.ok(cached.includes(`${scope}${asset}`), `Missing offline asset: ${asset}`);
  }
  assert.equal(activated, true);
});

test('does not activate an incomplete offline cache when the manifest cannot be fetched', async () => {
  let install: InstallHandler | undefined;
  let activated = false;
  runInNewContext(source, {
    URL,
    self: {
      registration: { scope: 'https://example.com/peterborough-weather/' },
      addEventListener: (name: string, handler: typeof install) => { if (name === 'install') install = handler; },
      skipWaiting: async () => { activated = true; },
    },
    caches: { open: async () => ({ addAll: async () => {} }) },
    fetch: async () => new Response('', { status: 404 }),
  });
  let installation: Promise<void> | undefined;
  install!({ waitUntil: (work) => { installation = work; } });
  await assert.rejects(installation!, /offline asset manifest/);
  assert.equal(activated, false);
});
