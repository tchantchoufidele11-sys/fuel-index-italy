import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePricesCsv } from '../src/mimit-parser.mjs';
import { normalizePrices } from '../src/normalize.mjs';
import { pricesCsv, builtFixture } from './helpers.mjs';

const norm = rows => normalizePrices(parsePricesCsv(pricesCsv(rows)).rows, '2026-10-01');

test('lignes strictement identiques : une seule gardee', () => {
  const r = norm([[1, 'Benzina', 1.9, 1, '30/09/2026 12:00:00'], [1, 'Benzina', 1.9, 1, '30/09/2026 12:00:00']]);
  assert.equal(r.counters.doublonsIdentiques, 1);
  assert.equal(r.byStation.get(1).sp95.price, 1.9);
});

test('plusieurs dates : la plus recente est gardee', () => {
  const r = norm([[1, 'Gasolio', 2.10, 1, '28/09/2026 09:00:00'], [1, 'Gasolio', 2.05, 1, '30/09/2026 18:00:00']]);
  assert.equal(r.counters.plusRecenteRetenue, 1);
  assert.equal(r.byStation.get(1).diesel.price, 2.05);
  assert.equal(r.byStation.get(1).diesel.reported, '2026-09-30T18:00:00');
});

test('meme dtComu, prix differents : cle rejetee et comptee, jamais de choix arbitraire', () => {
  const r = norm([[1, 'Benzina', 1.90, 1, '30/09/2026 12:00:00'], [1, 'Benzina', 1.95, 1, '30/09/2026 12:00:00'], [1, 'Gasolio', 2.0, 1, '30/09/2026 12:00:00']]);
  assert.equal(r.counters.conflits, 1);
  assert.equal(r.byStation.get(1).sp95, undefined);
  assert.equal(r.byStation.get(1).diesel.price, 2.0);
});

test('conflit seulement sur une date ancienne : la date la plus recente, unique, est gardee', () => {
  const r = norm([[1, 'Benzina', 1.90, 1, '28/09/2026 12:00:00'], [1, 'Benzina', 1.99, 1, '28/09/2026 12:00:00'], [1, 'Benzina', 1.95, 1, '30/09/2026 12:00:00']]);
  assert.equal(r.counters.conflits, 0);
  assert.equal(r.byStation.get(1).sp95.price, 1.95);
});

test('fixture reelle : aucun doublon ni conflit (45 284 cles)', () => {
  const c = builtFixture().report.normalisation;
  assert.equal(c.cles, 45284);
  assert.equal(c.doublonsIdentiques, 0);
  assert.equal(c.plusRecenteRetenue, 0);
  assert.equal(c.conflits, 0);
});
