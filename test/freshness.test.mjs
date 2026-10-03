import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallToUtcMs, snapshotUtcMs, freshnessClass, isFutureVsSnapshot, ageDays } from '../src/freshness.mjs';
import { parsePricesCsv } from '../src/mimit-parser.mjs';
import { normalizePrices } from '../src/normalize.mjs';
import { pricesCsv, builtFixture } from './helpers.mjs';

const iso = ms => new Date(ms).toISOString();
const C = (y, mo, d, h, mi = 0, s = 0) => ({ y, mo, d, h, mi, s });

test('heure de Rome -> UTC : ete (UTC+2) et hiver (UTC+1)', () => {
  assert.equal(iso(wallToUtcMs(C(2026, 7, 1, 12))), '2026-07-01T10:00:00.000Z');
  assert.equal(iso(wallToUtcMs(C(2026, 12, 1, 12))), '2026-12-01T11:00:00.000Z');
});

test('fin de l heure d ete (25/10/2026) : 02:30 existe deux fois -> premiere occurrence (UTC+2)', () => {
  assert.equal(iso(wallToUtcMs(C(2026, 10, 25, 2, 30))), '2026-10-25T00:30:00.000Z');
  assert.equal(iso(wallToUtcMs(C(2026, 10, 25, 3, 30))), '2026-10-25T02:30:00.000Z');
  assert.equal(iso(wallToUtcMs(C(2026, 10, 25, 1, 30))), '2026-10-24T23:30:00.000Z');
});

test('debut de l heure d ete (29/03/2026) : 02:30 n existe pas -> decalee a 03:30 (UTC+2)', () => {
  assert.equal(iso(wallToUtcMs(C(2026, 3, 29, 2, 30))), '2026-03-29T01:30:00.000Z');
  assert.equal(iso(wallToUtcMs(C(2026, 3, 29, 3, 30))), '2026-03-29T01:30:00.000Z');
});

test('releve : 8 h 00 heure de Rome le jour d extraction', () => {
  assert.equal(iso(snapshotUtcMs('2026-10-01')), '2026-10-01T06:00:00.000Z');
  assert.equal(iso(snapshotUtcMs('2026-12-15')), '2026-12-15T07:00:00.000Z');
});

test('classes de fraicheur aux bornes : 3 j VALID, 3 j + 1 s FALLBACK, 8 j FALLBACK, 8 j + 1 s EXPIRED, negatif EXPIRED', () => {
  const s = 1 / 86400;
  assert.equal(freshnessClass(0), 'VALID');
  assert.equal(freshnessClass(3), 'VALID');
  assert.equal(freshnessClass(3 + s), 'FALLBACK');
  assert.equal(freshnessClass(8), 'FALLBACK');
  assert.equal(freshnessClass(8 + s), 'EXPIRED');
  assert.equal(freshnessClass(-s), 'EXPIRED');
});

test('tolerance d extraction : 08:15:00 accepte, 08:15:01 rejete', () => {
  const snap = snapshotUtcMs('2026-10-01');
  assert.equal(isFutureVsSnapshot(wallToUtcMs(C(2026, 10, 1, 8, 15, 0)), snap), false);
  assert.equal(isFutureVsSnapshot(wallToUtcMs(C(2026, 10, 1, 8, 15, 1)), snap), true);
});

test('constructeur : dtComu apres 8 h 15 rejete, plus de 8 jours exclu, 8 jours exactement garde', () => {
  const r = normalizePrices(parsePricesCsv(pricesCsv([
    [1, 'Benzina', 1.9, 1, '01/10/2026 08:16:00'],
    [2, 'Benzina', 1.9, 1, '23/09/2026 08:00:00'],
    [3, 'Benzina', 1.9, 1, '23/09/2026 07:59:59'],
  ])).rows, '2026-10-01');
  assert.equal(r.counters.futur, 1);
  assert.equal(r.counters.tropAnciens, 1);
  assert.deepEqual([...r.byStation.keys()], [2]);
  assert.equal(ageDays(r.byStation.get(2).sp95.reportedUtcMs, snapshotUtcMs('2026-10-01')), 8);
});

test('fixture reelle : aucun dtComu futur, 387 prix de plus de 8 jours exclus (dont ceux de 2013)', () => {
  const c = builtFixture().report.normalisation;
  assert.equal(c.futur, 0);
  assert.equal(c.tropAnciens, 387);
});
