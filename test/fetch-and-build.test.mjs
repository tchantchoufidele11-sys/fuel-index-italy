import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../scripts/fetch-and-build.mjs';
import { StructuralError } from '../src/mimit-parser.mjs';
import { fixtures, previousManifest, PRICES_FIXTURE, STATIONS_FIXTURE, limits } from './helpers.mjs';
import { ManifestError } from '../src/manifest.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'idx-it-'));
const args = (out, reports, extra = []) => ['--out', out, '--reports', reports, '--prices', PRICES_FIXTURE, '--stations', STATIONS_FIXTURE, '--generated-at', '2026-10-02T00:00:00.000Z', ...extra];

test('publication : zones dans it/v1/2026-10-01, manifeste en dernier, rapport ecrit', async () => {
  const out = tmp(), rep = tmp();
  const r = await run(args(out, rep));
  assert.equal(r.code, 0);
  assert.equal(r.status, 'OK');
  const dir = path.join(out, 'it', 'v1', '2026-10-01');
  assert.equal(readdirSync(dir).length, 655);
  const m = JSON.parse(readFileSync(path.join(out, 'it', 'v1', 'manifest.json'), 'utf8'));
  assert.equal(m.extraction, '2026-10-01');
  assert.equal(m.inputs.prices.sha256, 'd274db0cea67267ddd770c834d7aa47bc35af106591235de9cf1144273e55b72');
  assert.ok(existsSync(r.reportFile));
  assert.equal(existsSync(path.join(out, 'it', 'v1', 'manifest.json.tmp')), false);
});

test('deuxieme passage sur la meme extraction : NO_CHANGE, aucun fichier publie modifie', async () => {
  const out = tmp(), rep = tmp();
  await run(args(out, rep));
  const mf = path.join(out, 'it', 'v1', 'manifest.json');
  const before = readFileSync(mf, 'utf8'), mtime = statSync(mf).mtimeMs;
  const r = await run([...args(out, rep).slice(0, -2), '--generated-at', '2030-01-01T00:00:00.000Z']);
  assert.equal(r.code, 0);
  assert.equal(r.status, 'NO_CHANGE');
  assert.equal(readFileSync(mf, 'utf8'), before);
  assert.equal(statSync(mf).mtimeMs, mtime);
});

test('garde-fous non satisfaits : code 3, l index precedent reste en ligne intact', async () => {
  const out = tmp(), rep = tmp(), work = tmp();
  const mf = path.join(out, 'it', 'v1', 'manifest.json');
  mkdirSync(path.dirname(mf), { recursive: true });
  writeFileSync(mf, JSON.stringify(previousManifest('2026-09-30')));
  const bad = path.join(work, 'prix.csv');
  writeFileSync(bad, fixtures().prices.replace(/\|Gasolio\|/g, '|Gasolio X|'));
  const r = await run(['--out', out, '--reports', rep, '--prices', bad, '--stations', STATIONS_FIXTURE, '--generated-at', 'x']);
  assert.equal(r.code, 3);
  assert.match(r.failures.join(), /prix_diesel_insuffisants:0/);
  assert.equal(JSON.parse(readFileSync(mf, 'utf8')).extraction, '2026-09-30');
  assert.equal(existsSync(path.join(out, 'it', 'v1', '2026-10-01')), false);
});

test('menage : seules les 3 extractions les plus recentes sont conservees', async () => {
  const out = tmp(), rep = tmp();
  const root = path.join(out, 'it', 'v1');
  for (const d of ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']) mkdirSync(path.join(root, d), { recursive: true });
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(previousManifest('2026-09-30')));
  const r = await run(args(out, rep));
  assert.equal(r.status, 'OK');
  assert.deepEqual(readdirSync(root).filter(n => /^\d{4}/.test(n)).sort(), ['2026-09-29', '2026-09-30', '2026-10-01']);
  assert.deepEqual(r.removed, ['2026-09-27', '2026-09-28']);
});

test('manifeste publie illisible : code 4, rien n est publie', async () => {
  const out = tmp(), rep = tmp();
  const mf = path.join(out, 'it', 'v1', 'manifest.json');
  mkdirSync(path.dirname(mf), { recursive: true });
  writeFileSync(mf, '{ pas du json');
  await assert.rejects(() => run(args(out, rep)), e => e.exitCode === 4);
  assert.equal(existsSync(path.join(out, 'it', 'v1', '2026-10-01')), false);
});

test('anomalie structurelle (en-tete modifie) : StructuralError, rien n est publie', async () => {
  const out = tmp(), rep = tmp(), work = tmp();
  const bad = path.join(work, 'stations.csv');
  writeFileSync(bad, fixtures().stations.replace('|Latitudine|', '|Lat|'));
  await assert.rejects(() => run(['--out', out, '--reports', rep, '--prices', PRICES_FIXTURE, '--stations', bad]), e => e instanceof StructuralError);
  assert.equal(existsSync(path.join(out, 'it')), false);
});

test('fichier non UTF-8 : anomalie structurelle', async () => {
  const out = tmp(), rep = tmp(), work = tmp();
  const bad = path.join(work, 'prix.csv');
  writeFileSync(bad, Buffer.concat([Buffer.from(fixtures().prices.slice(0, 200)), Buffer.from([0xff, 0xfe, 0xfd])]));
  await assert.rejects(() => run(['--out', out, '--reports', rep, '--prices', bad, '--stations', STATIONS_FIXTURE]), e => e instanceof StructuralError && e.code === 'encodage_non_utf8');
});

test('manifeste precedent incomplet ou incoherent : code 4, rien n est publie (jamais de garde-fou partiel)', async () => {
  const valid = previousManifest('2026-09-30');
  const cases = {
    'extraction seule': { extraction: '2026-09-30' },
    'date impossible': { ...valid, extraction: '2026-99-99', dir: '2026-99-99' },
    'compteur GPL absent': { ...valid, counts: { ...valid.counts, retainedByFuel: { sp95: 1, diesel: 1 } } },
    'compteur non entier': { ...valid, counts: { ...valid.counts, retainedByFuel: { sp95: 1.5, diesel: 1, gpl: 1 } } },
    'pays': { ...valid, country: 'FR' },
    'schema': { ...valid, schema: 2 },
    'dir different': { ...valid, dir: '2026-09-29' },
    'tileDeg': { ...valid, tileDeg: 0.5 },
    'zones non triees': { ...valid, tiles: ['2_1', '1_1'], counts: { ...valid.counts, tiles: 2 } },
    'nombre de zones incoherent': { ...valid, tiles: ['1_1'], counts: { ...valid.counts, tiles: 5 } },
  };
  for (const [label, m] of Object.entries(cases)) {
    const out = tmp(), rep = tmp();
    const mf = path.join(out, 'it', 'v1', 'manifest.json');
    mkdirSync(path.dirname(mf), { recursive: true });
    writeFileSync(mf, JSON.stringify(m));
    await assert.rejects(() => run(args(out, rep)), e => e instanceof ManifestError && e.exitCode === 4, label);
    assert.equal(existsSync(path.join(out, 'it', 'v1', '2026-10-01')), false, label);
    assert.equal(readFileSync(mf, 'utf8'), JSON.stringify(m), label);
  }
});

test('le coeur refuse aussi un manifeste precedent invalide (independamment de l appelant)', async () => {
  const { buildIndex } = await import('../src/build-index.mjs');
  const f = fixtures();
  assert.throws(() => buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: 'x', previousManifest: { extraction: '2026-09-30' } }),
    e => e instanceof ManifestError && e.exitCode === 4);
});
