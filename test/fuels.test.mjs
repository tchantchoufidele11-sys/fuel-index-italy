import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePricesCsv } from '../src/mimit-parser.mjs';
import { normalizePrices } from '../src/normalize.mjs';
import { magotFuel, modeAllowed, SERVICE_POLICY } from '../src/fuel-policy.mjs';
import { pricesCsv, builtFixture, allIndexedStations } from './helpers.mjs';

const norm = rows => normalizePrices(parsePricesCsv(pricesCsv(rows)).rows, '2026-10-01');

test('seuls Benzina, Gasolio et GPL sont retenus ; marques, "speciale", Metano ignores', () => {
  assert.equal(magotFuel('Benzina'), 'sp95');
  assert.equal(magotFuel('Gasolio'), 'diesel');
  assert.equal(magotFuel('GPL'), 'gpl');
  for (const d of ['Benzina Plus 98', 'Benzina speciale', 'Blue Super', 'Metano', 'benzina', 'Gasolio Premium', 'E10']) assert.equal(magotFuel(d), null);
});

test('politique declarative : SP95 et diesel SELF_ONLY, GPL SELF_PREFERRED_SERVED_ALLOWED', () => {
  assert.deepEqual(SERVICE_POLICY, { sp95: 'SELF_ONLY', diesel: 'SELF_ONLY', gpl: 'SELF_PREFERRED_SERVED_ALLOWED' });
  assert.equal(modeAllowed('sp95', 'SERVED'), false);
  assert.equal(modeAllowed('diesel', 'SERVED'), false);
  assert.equal(modeAllowed('gpl', 'SERVED'), true);
});

test('SP95 et diesel servis : jamais retenus, meme sans self', () => {
  const r = norm([[1, 'Benzina', 2.2, 0, '30/09/2026 12:00:00'], [1, 'Gasolio', 2.3, 0, '30/09/2026 12:00:00']]);
  assert.equal(r.byStation.has(1), false);
  assert.equal(r.counters.modeNonAdmis, 2);
});

test('GPL : self retenu s il existe, sinon servi ; le mode est conserve', () => {
  const r = norm([
    [1, 'GPL', 0.80, 1, '30/09/2026 12:00:00'], [1, 'GPL', 0.82, 0, '30/09/2026 12:00:00'],
    [2, 'GPL', 0.85, 0, '30/09/2026 12:00:00'],
  ]);
  assert.deepEqual([r.byStation.get(1).gpl.price, r.byStation.get(1).gpl.mode], [0.80, 'SELF']);
  assert.deepEqual([r.byStation.get(2).gpl.price, r.byStation.get(2).gpl.mode], [0.85, 'SERVED']);
});

test('GPL : self trop ancien (> 8 j) mais servi valide -> servi retenu', () => {
  const r = norm([[1, 'GPL', 0.80, 1, '10/09/2026 12:00:00'], [1, 'GPL', 0.82, 0, '30/09/2026 12:00:00']]);
  assert.deepEqual([r.byStation.get(1).gpl.price, r.byStation.get(1).gpl.mode], [0.82, 'SERVED']);
});

test('plage de prix 0,40 a 4,00 EUR/L appliquee avant publication', () => {
  const r = norm([[1, 'Benzina', 0.39, 1, '30/09/2026 12:00:00'], [2, 'Benzina', 4.01, 1, '30/09/2026 12:00:00'],
    [3, 'Benzina', 0.40, 1, '30/09/2026 12:00:00'], [4, 'Benzina', 4.00, 1, '30/09/2026 12:00:00']]);
  assert.equal(r.counters.prixHorsPlage, 2);
  assert.deepEqual([...r.byStation.keys()].sort(), [3, 4]);
});

test('fixture reelle apres filtre geographique IT-1b : 20 045 / 20 049 / 4 523 prix, 4 372 GPL servis, aucun SP95 ou diesel servi', () => {
  const b = builtFixture();
  assert.deepEqual(b.report.counts.retainedByFuel, { sp95: 20045, diesel: 20049, gpl: 4523 });
  assert.deepEqual(b.report.counts.retainedByMode, { SELF: 40245, SERVED: 4372 });
  const st = allIndexedStations(b);
  assert.equal(st.filter(s => s.f.sp95 && s.f.sp95[2] !== 'SELF').length, 0);
  assert.equal(st.filter(s => s.f.diesel && s.f.diesel[2] !== 'SELF').length, 0);
  assert.equal(st.filter(s => s.f.gpl && s.f.gpl[2] === 'SERVED').length, 4372);
});
