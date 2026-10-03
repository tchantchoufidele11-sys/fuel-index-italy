import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toUtm32, fromUtm32 } from '../src/utm32.mjs';
import { convertProvinces, EXPECTED_PRJ } from '../src/istat-provinces.mjs';
import { StructuralError } from '../src/mimit-parser.mjs';
import { sha256Hex } from '../src/sha256.mjs';
import { loadBoundaries, DEFAULT_BOUNDARIES_DIR } from '../scripts/fetch-and-build.mjs';
import { candidatesFor, insideAny } from '../src/province-boundaries.mjs';
import { limits } from './helpers.mjs';

const SRC = path.join(DEFAULT_BOUNDARIES_DIR, 'source'), BASE = 'ProvCM01012026_g_WGS84';
const read = ext => new Uint8Array(readFileSync(path.join(SRC, `${BASE}.${ext}`)));
const SOURCE = JSON.parse(readFileSync(path.join(DEFAULT_BOUNDARIES_DIR, 'SOURCE.json'), 'utf8'));

test('SOURCE.json : provenance, licence CC BY 4.0, empreintes des fichiers ISTAT versionnes', () => {
  assert.equal(SOURCE.referenceDate, '2026-01-01');
  assert.equal(SOURCE.archiveSha256, 'b011a590656c3a3ebc297fba80726a376aa843b6f164641cf6a4a990021a81d6');
  assert.equal(SOURCE.license, 'CC BY 4.0');
  assert.match(SOURCE.attribution, /Istat, CC BY 4\.0\. Données converties et normalisées pour Magot/);
  assert.equal(SOURCE.derived, true);
  for (const ext of ['shp', 'dbf', 'prj', 'shx']) assert.equal(sha256Hex(read(ext)), SOURCE.sourceFiles[`${BASE}.${ext}`], ext);
});

test('SOURCE.json : sigles du fichier ISTAT (CI, sans SU) distincts des alias de compatibilite Magot (dont SU)', () => {
  assert.deepEqual(SOURCE.istatSnapshotSigle.sardinia, ['CA', 'CI', 'NU', 'OG', 'OR', 'OT', 'SS', 'VS']);
  assert.equal(SOURCE.istatSnapshotSigle.all.length, 110);
  assert.equal(SOURCE.istatSnapshotSigle.all.includes('SU'), false);
  assert.equal(SOURCE.istatSnapshotSigle.all.includes('CI'), true);
  assert.deepEqual(SOURCE.magotCompatibility.sardiniaAcceptedSigle, ['CA', 'CI', 'NU', 'OG', 'OR', 'OT', 'SS', 'SU', 'VS']);
  const g = JSON.parse(readFileSync(path.join(DEFAULT_BOUNDARIES_DIR, 'provinces.geojson'), 'utf8'));
  assert.deepEqual(g.features.map(f => f.properties.sigla), SOURCE.istatSnapshotSigle.all);   // la donnee source n'est pas reecrite
});

test('conversion deterministe : reconvertir les fichiers versionnes redonne exactement le GeoJSON publie', () => {
  const { geojson, stats } = convertProvinces({ shp: read('shp'), dbf: read('dbf'), prj: new TextDecoder().decode(read('prj')) });
  assert.equal(sha256Hex(JSON.stringify(geojson)), SOURCE.output.sha256);
  assert.deepEqual(stats, { unites: 110, anneaux: 552, trous: 21, sommets: 127458 });
});

test('projection UTM 32N : aller-retour < 1 mm ; Rome = (788884, 4644096)', () => {
  for (const [la, lo] of [[41.896, 12.4823], [45.4642, 9.19], [35.5, 12.6], [47.0, 6.7], [37.5, 18.5]]) {
    const [E, N] = toUtm32(la, lo), [lo2, la2] = fromUtm32(E, N), [E2, N2] = toUtm32(la2, lo2);
    assert.ok(Math.hypot(E - E2, N - N2) < 0.001);
  }
  assert.deepEqual(toUtm32(41.8960, 12.4823).map(Math.round), [788884, 4644096]);
});

test('projection inattendue dans le .prj : anomalie structurelle', () => {
  assert.throws(() => convertProvinces({ shp: read('shp'), dbf: read('dbf'), prj: EXPECTED_PRJ.replace('Zone_32N', 'Zone_33N') }),
    e => e instanceof StructuralError && e.code === 'projection_inattendue');
});

test('GeoJSON modifie : empreinte invalide, chargement refuse (echec ferme)', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'limites-'));
  cpSync(DEFAULT_BOUNDARIES_DIR, dir, { recursive: true });
  const f = path.join(dir, 'provinces.geojson');
  writeFileSync(f, readFileSync(f, 'utf8').replace('"sigla":"RM"', '"sigla":"RX"'));
  await assert.rejects(() => loadBoundaries(dir), e => e instanceof StructuralError && e.code === 'limites_empreinte_invalide');
});

test('limites reelles : Rome dans RM, Milan dans MI, Stromboli dans ME, Lampedusa dans AG', () => {
  const b = limits().boundaries;
  const isIn = (s, lat, lon) => insideAny(candidatesFor(b, s).units, lon, lat);
  assert.equal(isIn('RM', 41.8960, 12.4823), true);
  assert.equal(isIn('MI', 45.4642, 9.1900), true);
  assert.equal(isIn('MI', 41.8960, 12.4823), false);
  assert.equal(isIn('ME', 38.7926, 15.2148), true);    // Stromboli
  assert.equal(isIn('AG', 35.5067, 12.6050), true);    // Lampedusa
});
