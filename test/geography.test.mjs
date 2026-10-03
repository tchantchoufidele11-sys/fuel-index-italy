import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStationsCsv } from '../src/mimit-parser.mjs';
import { qualifyStations, MIMIT_PROVINCES, ACCEPTED_PROVINCES } from '../src/geographic-quality.mjs';
import { indexBoundaries, PROVINCE_BUFFER_KM, SARDINIA_SIGLE } from '../src/province-boundaries.mjs';
import { fixtures, stationsCsv, limits } from './helpers.mjs';

let fixtureGeo = null;
const geo = () => fixtureGeo ||= qualifyStations(parseStationsCsv(fixtures().stations).stations, { boundaries: limits().boundaries });

// Limites synthetiques : carres de cote 0,2 deg (lon, lat) ; cod_reg 20 = Sardaigne.
const square = (lon, lat, s = 0.1) => [[[lon - s, lat - s], [lon + s, lat - s], [lon + s, lat + s], [lon - s, lat + s], [lon - s, lat - s]]];
const synth = units => indexBoundaries({ type: 'FeatureCollection', features: units.map(([sigla, codReg, lon, lat]) =>
  ({ type: 'Feature', properties: { sigla, cod_reg: codReg }, geometry: { type: 'MultiPolygon', coordinates: [square(lon, lat)] } })) });
const SYN = synth([['RM', 12, 12.5, 41.9], ['MI', 3, 9.19, 45.46], ['CA', 20, 9.1, 39.2], ['OT', 20, 9.5, 41.0]]);
const q = rows => qualifyStations(parseStationsCsv(stationsCsv(rows)).stations, { boundaries: SYN });
const KM_PER_DEG = 6371.0088 * Math.PI / 180;

test('sigles acceptes : 107 du MIMIT + nouveaux sigles sardes ; tolerance 5 km', () => {
  assert.equal(MIMIT_PROVINCES.size, 107);
  for (const s of ['OT', 'OG', 'VS', 'CI', 'SU']) assert.ok(ACCEPTED_PROVINCES.has(s), s);
  assert.equal(ACCEPTED_PROVINCES.size, 111);
  assert.deepEqual([...SARDINIA_SIGLE].sort(), ['CA', 'CI', 'NU', 'OG', 'OR', 'OT', 'SS', 'SU', 'VS']);
  assert.equal(PROVINCE_BUFFER_KM, 5);
});

test('fixture reelle IT-1b : 84 points partages, 66 hors province, 134 rejets, 23 793 stations retenues, aucune quarantaine', () => {
  const c = geo().counters;
  assert.equal(c.pointPartage, 84);
  assert.equal(c.horsProvince, 66);
  assert.equal(c.rejetsGeographiques, 134);
  assert.equal(c.retenues, 23793);
  assert.deepEqual(c.quarantaine, { province: 0, commune: 0, idDuplique: 0, provinceSansLimite: 0 });
});

test('Sardaigne en compatibilite : 674 stations comptees, sigles observes CA / NU / OR / SS / SU', () => {
  const c = geo().counters;
  assert.equal(c.geoSardiniaCompatibilityCount, 674);
  assert.deepEqual(c.siglesSardesObserves, { CA: 147, NU: 95, OR: 74, SS: 205, SU: 153 });
});

test('temoins : iles et Rome gardees ; erreurs grossieres et faux points du Duomo rejetes', () => {
  const g = geo();
  for (const id of [37410, 40673, 60141, 58115, 17767, 62793, 18915]) assert.equal(g.kept.has(id), true, `gardee ${id}`);
  for (const id of [55319, 57335, 52901, 57111, 55674]) assert.equal(g.rejected.outsideProvince.has(id), true, `hors province ${id}`);
  for (const id of [55577, 53351, 54251]) assert.equal(g.rejected.sharedPoint.has(id), true, `point partage ${id}`);
});

test('tolerance aux bornes : 4,9 km hors de la province -> gardee ; 5,1 km -> rejetee ; dedans -> gardee', () => {
  const edgeLon = 12.6;   // bord est du carre RM
  const out = km => edgeLon + km / (KM_PER_DEG * Math.cos(41.9 * Math.PI / 180));
  const r = q([[1, 'ROMA', 'RM', 41.9, out(4.9)], [2, 'ROMA', 'RM', 41.91, out(5.1)], [3, 'ROMA', 'RM', 41.92, 12.5]]);
  assert.deepEqual([...r.kept.keys()].sort(), [1, 3]);
  assert.deepEqual([...r.rejected.outsideProvince], [2]);
});

test('Sardaigne : une station SS situee dans le territoire CA est gardee (union) ; hors Sardaigne -> rejetee', () => {
  const r = q([[1, 'SASSARI', 'SS', 39.2, 9.1], [2, 'OLBIA', 'OT', 41.0, 9.5], [3, 'SASSARI', 'SS', 41.9, 12.5]]);
  assert.deepEqual([...r.kept.keys()].sort(), [1, 2]);
  assert.equal(r.rejected.outsideProvince.has(3), true);
  assert.equal(r.counters.geoSardiniaCompatibilityCount, 3);
  assert.deepEqual(r.counters.siglesSardesObserves, { OT: 1, SS: 2 });
});

test('quarantaine : sigle inconnu, commune vide, identifiant duplique, province sans limite', () => {
  const r = q([
    [1, 'ROMA', 'XX', 41.9, 12.5],
    [2, '', 'RM', 41.9, 12.51],
    [3, 'ROMA', 'RM', 41.91, 12.5], [3, 'ROMA', 'RM', 41.92, 12.5],
    [4, 'TORINO', 'TO', 45.07, 7.68],   // sigle accepte mais aucune limite dans l'index synthetique
    [5, 'ROMA', 'RM', 41.93, 12.5],
  ]);
  assert.deepEqual(r.counters.quarantaine, { province: 1, commune: 1, idDuplique: 2, provinceSansLimite: 1 });
  assert.deepEqual([...r.kept.keys()], [5]);
});

test('point partage : meme commune -> garde ; communes differentes -> tout rejete', () => {
  const r = q([[1, 'ROMA', 'RM', 41.9, 12.5], [2, 'ROMA', 'RM', 41.9, 12.5], [3, 'MILANO', 'MI', 45.46, 9.19], [4, 'BRESCIA', 'MI', 45.46, 9.19]]);
  assert.deepEqual([...r.kept.keys()].sort(), [1, 2]);
  assert.equal(r.counters.pointPartage, 2);
});

test('limites obligatoires : sans index, le controle refuse de tourner', () => {
  assert.throws(() => qualifyStations([], {}), /limites provinciales obligatoires/);
});
