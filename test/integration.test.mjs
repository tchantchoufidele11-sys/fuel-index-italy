import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildIndex } from '../src/build-index.mjs';
import { sha256Hex } from '../src/sha256.mjs';
import { haversineKm } from '../src/geographic-quality.mjs';
import { tileIndex, tileKey, TILE_DEG } from '../src/tiles.mjs';
import { wallToUtcMs, snapshotUtcMs } from '../src/freshness.mjs';
import { fixtures, builtFixture, fixtureInputs, allIndexedStations, PRICES_FIXTURE, STATIONS_FIXTURE, PRICES_SHA256, STATIONS_SHA256, limits } from './helpers.mjs';
import { validateManifest } from '../src/manifest.mjs';
import { run } from '../scripts/fetch-and-build.mjs';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Empreinte fonctionnelle de reference = celle de la sortie REELLEMENT publiee par le script (inputs compris).
const REFERENCE_FINGERPRINT = 'ec927f56a870c54cb9dabee2a1eabd00143e855f76bb613fca15d24e92faf4fb';   // IT-1b (IT-1 : 4cd0b2b0…414f)

const BUILD_URL = new URL('../src/build-index.mjs', import.meta.url).href;
const SCRIPT_URL = new URL('../scripts/fetch-and-build.mjs', import.meta.url).href;

/** Empreinte fonctionnelle : manifeste sans generatedAt + toutes les zones. */
function fingerprint(r) {
  const { generatedAt, ...m } = r.manifest;
  return sha256Hex(JSON.stringify(m) + [...r.tiles].map(([k, v]) => k + v).join(''));
}

test('fixture : empreintes SHA-256 completes identiques a celles de la specification', () => {
  assert.equal(sha256Hex(readFileSync(PRICES_FIXTURE)), PRICES_SHA256);
  assert.equal(sha256Hex(readFileSync(STATIONS_FIXTURE)), STATIONS_SHA256);
});

test('fixture complete IT-1b : OK, 655 zones, 23 793 stations valides, 20 461 indexees, manifeste conforme', () => {
  const r = builtFixture();
  assert.equal(r.status, 'OK');
  const m = r.manifest;
  assert.equal(m.schema, 1);
  assert.equal(m.country, 'IT');
  assert.equal(m.extraction, '2026-10-01');
  assert.equal(m.snapshotAt, '2026-10-01T06:00:00.000Z');
  assert.equal(m.tileDeg, 0.25);
  assert.equal(m.dir, '2026-10-01');
  assert.equal(m.tiles.length, 655);
  assert.deepEqual(m.tz, { dtComu: 'Europe/Rome', confirmed: false });
  assert.equal(m.license, 'IODL 2.0');
  assert.equal(m.counts.stationsValid, 23793);
  assert.equal(m.counts.stationsIndexed, 20461);
  assert.deepEqual(m.servicePolicy, { sp95: 'SELF_ONLY', diesel: 'SELF_ONLY', gpl: 'SELF_PREFERRED_SERVED_ALLOWED' });
  assert.deepEqual([...m.tiles], [...m.tiles].sort());
  assert.equal(m.boundaries.bufferKm, 5);
  assert.equal(m.boundaries.referenceDate, '2026-01-01');
  assert.equal(m.boundaries.license, 'CC BY 4.0');
  assert.equal(m.boundaries.sardiniaCompatibility, 'UNION_DES_UNITES_SARDES');
  assert.match(m.boundaries.geojsonSha256, /^[0-9a-f]{64}$/);
});

test('sortie deterministe : deux constructions identiques, seul generatedAt varie ; empreinte de reference', () => {
  const f = fixtures();
  const a = buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: '2026-10-02T00:00:00.000Z', inputs: fixtureInputs() });
  const b = buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: '2030-01-01T00:00:00.000Z', inputs: fixtureInputs() });
  assert.equal(fingerprint(a), fingerprint(b));
  assert.equal(fingerprint(a), REFERENCE_FINGERPRINT);
  assert.notEqual(a.manifest.generatedAt, b.manifest.generatedAt);
  assert.deepEqual(validateManifest(a.manifest), []);
});

test('empreinte de la sortie ECRITE SUR DISQUE par le script = empreinte de reference', async () => {
  const out = mkdtempSync(path.join(tmpdir(), 'idx-fp-')), rep = mkdtempSync(path.join(tmpdir(), 'idx-fpr-'));
  const r = await run(['--out', out, '--reports', rep, '--prices', PRICES_FIXTURE, '--stations', STATIONS_FIXTURE, '--generated-at', '2031-05-05T05:05:05.000Z']);
  assert.equal(r.status, 'OK');
  const m = JSON.parse(readFileSync(path.join(out, 'it', 'v1', 'manifest.json'), 'utf8'));
  const dir = path.join(out, 'it', 'v1', m.dir);
  const tiles = new Map(m.tiles.map(k => [k, readFileSync(path.join(dir, `z_${k}.json`), 'utf8')]));
  assert.equal(readdirSync(dir).length, m.tiles.length);
  assert.equal(fingerprint({ manifest: m, tiles }), REFERENCE_FINGERPRINT);
});

test('fuseau de la machine sans effet : resultat identique sous Europe/Rome, America/New_York, Pacific/Honolulu, Asia/Tokyo', () => {
  const ref = REFERENCE_FINGERPRINT;
  const code = `
    const { buildIndex } = await import(${JSON.stringify(BUILD_URL)});
    const { loadBoundaries } = await import(${JSON.stringify(SCRIPT_URL)});
    const L = await loadBoundaries();
    const { createHash } = await import('node:crypto');
    const fs = await import('node:fs');
    const pb = fs.readFileSync(${JSON.stringify(PRICES_FIXTURE)}), sb = fs.readFileSync(${JSON.stringify(STATIONS_FIXTURE)});
    const h = b => createHash('sha256').update(b).digest('hex');
    const r = buildIndex({ boundaries: L.index, boundariesMeta: L.meta, pricesText: pb.toString('utf8'), stationsText: sb.toString('utf8'), generatedAt: 'x',
      inputs: { prices: { sha256: h(pb), bytes: pb.length }, stations: { sha256: h(sb), bytes: sb.length } } });
    const { generatedAt, ...m } = r.manifest;
    process.stdout.write(createHash('sha256').update(JSON.stringify(m) + [...r.tiles].map(([k, v]) => k + v).join('')).digest('hex') + ' ' + new Date(2026, 9, 1).getTimezoneOffset());`;
  const offsets = new Set();
  for (const tz of ['Europe/Rome', 'America/New_York', 'Pacific/Honolulu', 'Asia/Tokyo']) {
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const [hash, offset] = p.stdout.split(' ');
    offsets.add(offset);
    assert.equal(hash, ref, tz);
  }
  assert.equal(offsets.size, 4, 'les processus ont bien tourne sous 4 fuseaux differents');
});

// Recherche simplifiee, cote test uniquement : zones couvrant le rayon, station la plus proche (SP95 self, 3 j au plus).
function nearestValid(r, lat, lng, radiusKm = 40, maxAgeDays = 3) {
  const snap = snapshotUtcMs(r.manifest.extraction);
  const age = t => { const [d, h] = t.split('T'); const [y, mo, dd] = d.split('-').map(Number); const [hh, mi, ss] = h.split(':').map(Number);
    return (snap - wallToUtcMs({ y, mo, d: dd, h: hh, mi, s: ss })) / 864e5; };
  const dLat = radiusKm / 111, dLng = radiusKm / (111 * Math.cos(lat * Math.PI / 180));
  const [a0, b0] = tileIndex(lat - dLat, lng - dLng), [a1, b1] = tileIndex(lat + dLat, lng + dLng);
  let best = null;
  for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) {
    const json = r.tiles.get(tileKey(i, j));
    if (!json) continue;   // zone non listee : legitimement vide
    for (const s of JSON.parse(json).stations) {
      if (!s.f.sp95 || s.f.sp95[2] !== 'SELF' || age(s.f.sp95[1]) > maxAgeDays) continue;
      const d = haversineKm(lat, lng, s.lat, s.lng);
      if (d <= radiusKm && (!best || d < best.d)) best = { d, id: s.id };
    }
  }
  return best;
}

test('stations retenues identiques a l audit : Rome 0,88 km (16807), Milan 0,49 km (61903), Pienza 0,35 km (7727)', () => {
  const r = builtFixture();
  const cases = [[41.8960, 12.4823, 16807, 0.876], [45.4642, 9.1900, 61903, 0.488], [43.0766, 11.6788, 7727, 0.346]];
  for (const [lat, lng, id, km] of cases) {
    const b = nearestValid(r, lat, lng);
    assert.equal(b.id, id);
    assert.ok(Math.abs(b.d - km) < 0.001, `${b.d} km`);
  }
});

test('Stromboli (37410) desormais indexee : aucun prix VALIDE a 40 km, la recherche de SECOURS (3 a 8 j) la retrouve', () => {
  const r = builtFixture();
  const s = allIndexedStations(r).find(x => x.id === 37410);
  assert.ok(s && s.f.sp95 && s.f.diesel, 'indexee avec SP95 et diesel');
  assert.equal(nearestValid(r, s.lat, s.lng, 40, 3), null, 'aucun prix de 3 jours au plus dans 40 km');
  const b = nearestValid(r, s.lat, s.lng, 40, 8);
  assert.equal(b && b.id, 37410);
});

test('limite de deux zones : une station de la zone voisine est trouvee', () => {
  const r = builtFixture();
  const s = allIndexedStations(r).find(x => x.f.sp95 && x.f.sp95[2] === 'SELF' && x.id === 61903);
  const [, j] = tileIndex(s.lat, s.lng);
  const edgeLng = (j + 1) * TILE_DEG + 0.0005;   // juste de l'autre cote de la limite est de sa zone
  assert.notEqual(tileKey(...tileIndex(s.lat, edgeLng)), tileKey(...tileIndex(s.lat, s.lng)));
  const b = nearestValid(r, s.lat, edgeLng, 40);
  assert.ok(b && b.d <= haversineKm(s.lat, edgeLng, s.lat, s.lng) + 1e-9);
});
