import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGuards, GUARDS } from '../src/manifest.mjs';
import { buildIndex } from '../src/build-index.mjs';
import { fixtures, builtFixture, previousManifest, limits } from './helpers.mjs';

const okCounts = () => ({ stationsValid: 23793, retainedByFuel: { sp95: 20045, diesel: 20049, gpl: 4523 }, keys: 45284, conflicts: 0 });   // references IT-1b

test('seuils de la specification : 20 000 stations, 15 000 / 15 000 / 3 500 prix, 20 % de chute, 1 % de conflits', () => {
  assert.deepEqual(GUARDS.minByFuel, { sp95: 15000, diesel: 15000, gpl: 3500 });
  assert.equal(GUARDS.minStations, 20000);
  assert.equal(GUARDS.maxDropRatio, 0.20);
  assert.equal(GUARDS.maxConflictRatio, 0.01);
});

test('fixture reelle : tous les garde-fous passent', () => {
  assert.deepEqual(builtFixture().report.guards, { ok: true, failures: [] });
});

test('seuils aux bornes', () => {
  assert.equal(evaluateGuards(okCounts(), null).ok, true);
  const c1 = okCounts(); c1.stationsValid = 19999;
  assert.match(evaluateGuards(c1, null).failures.join(), /stations_insuffisantes/);
  const c2 = okCounts(); c2.retainedByFuel.sp95 = 14999;
  assert.match(evaluateGuards(c2, null).failures.join(), /prix_sp95_insuffisants/);
  const c3 = okCounts(); c3.retainedByFuel.gpl = 3499;
  assert.match(evaluateGuards(c3, null).failures.join(), /prix_gpl_insuffisants/);
  const c4 = okCounts(); c4.conflicts = 453;   // > 1 % de 45 284
  assert.match(evaluateGuards(c4, null).failures.join(), /conflits_excessifs/);
  const c5 = okCounts(); c5.conflicts = 452;
  assert.equal(evaluateGuards(c5, null).ok, true);
});

test('chute par carburant par rapport au dernier index : 19 % accepte, 21 % refuse', () => {
  const prev = { counts: { retainedByFuel: { sp95: 25000, diesel: 20049, gpl: 4523 } } };
  const c = okCounts(); c.retainedByFuel.sp95 = 20250;   // -19 %
  assert.equal(evaluateGuards(c, prev).ok, true);
  c.retainedByFuel.sp95 = 19750;                          // -21 %
  assert.match(evaluateGuards(c, prev).failures.join(), /chute_sp95/);
});

test('libelle Benzina renomme dans la source : aucun prix SP95 retenu -> rien n est publie', () => {
  const p = fixtures().prices.replace(/\|Benzina\|/g, '|Benzina 95|');
  const r = buildIndex({ ...limits(), pricesText: p, stationsText: fixtures().stations, generatedAt: 'x' });
  assert.equal(r.status, 'GUARD_FAIL');
  assert.match(r.report.guards.failures.join(), /prix_sp95_insuffisants:0/);
  assert.equal(r.manifest, undefined);
  assert.equal(r.tiles, undefined);
});

test('isSelf disparu (tout en servi) : SP95 et diesel a zero -> rien n est publie', () => {
  const p = fixtures().prices.replace(/\|1\|(\d{2}\/\d{2}\/\d{4} )/g, '|0|$1');
  const r = buildIndex({ ...limits(), pricesText: p, stationsText: fixtures().stations, generatedAt: 'x' });
  assert.equal(r.status, 'GUARD_FAIL');
  assert.match(r.report.guards.failures.join(), /prix_sp95_insuffisants:0.*prix_diesel_insuffisants:0/);
});

test('anti-regression : extraction identique ou plus ancienne que celle publiee -> NO_CHANGE, rien n est produit', () => {
  const f = fixtures();
  for (const prev of ['2026-10-01', '2026-10-02']) {
    const r = buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: 'x', previousManifest: previousManifest(prev) });
    assert.equal(r.status, 'NO_CHANGE', prev);
    assert.equal(r.tiles, undefined);
  }
  const r = buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: 'x', previousManifest: previousManifest('2026-09-30') });
  assert.equal(r.status, 'OK');
});
