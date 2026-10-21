import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const root = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('asset-manifest.json', root), 'utf8'));
const staticEntries = new Set<string>();
function visit(key: string) { if (staticEntries.has(key)) return; staticEntries.add(key); for (const child of manifest[key]?.imports ?? []) visit(child); }
visit('index.html');
const chunks = await Promise.all(Object.entries(manifest).map(async ([key, entry]) => {
  const e = entry as { file: string };
  const bytes = await readFile(new URL(e.file, root));
  const text = bytes.toString();
  const astronomy = text.includes('Jupiter') && text.includes('Saturn');
  const satellite = text.includes('25544') && (text.includes('jdsatepoch') || text.includes('satnum'));
  if (staticEntries.has(key)) { assert.equal(astronomy, false, 'astronomy entered initial bundle'); assert.equal(satellite, false, 'satellite propagation entered initial bundle'); }
  return { key, file: e.file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, initialStaticGraph: staticEntries.has(key), astronomyMarkers: astronomy, satelliteMarkers: satellite };
}));
assert.ok(chunks.some(c => c.key.includes('NightSky') && c.astronomyMarkers && c.satelliteMarkers));
const report = { totals: { initialStaticJsBytes: chunks.filter(c => c.initialStaticGraph).reduce((n, c) => n + c.bytes, 0), offlinePrecachedJsBytes: chunks.reduce((n, c) => n + c.bytes, 0), nodeGzipJsBytes: chunks.reduce((n, c) => n + c.gzipBytes, 0) }, gzipMethod: 'Node zlib gzipSync default level 6; baseline gzip was the Vite CLI report and may use a different compression setting.', recordedAt: new Date().toISOString(), baseline: { initialJsBytes: 338790, initialJsGzipBytes: 103350, trendsJsBytes: 392040, note: 'Before edits: npm run build output (rounded to nearest 10 bytes).' }, chunks, libraries: { 'astronomy-engine': { version: '2.1.19', licence: 'MIT' }, 'satellite.js': { version: '7.1.0', licence: 'MIT', note: 'Vite transform removes unused WASM barrel export; JS propagation remains in lazy NightSky chunk.' } }, note: 'Measured production output bytes and gzip; package unpacked size is not a browser transfer size. The full NightSky chunk includes UI, calculations and both libraries. Marker check supplements the lazy import boundary; it is not a per-library byte attribution.' };
await writeFile(new URL('../docs/bundle-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
