import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePricesCsv, parseStationsCsv, parseDtComu, StructuralError, PRICES_HEADER } from '../src/mimit-parser.mjs';
import { buildIndex } from '../src/build-index.mjs';
import { fixtures, pricesCsv, stationsCsv, limits } from './helpers.mjs';

test('fixture reelle : 92 887 lignes de prix, toutes lisibles', () => {
  const r = parsePricesCsv(fixtures().prices);
  assert.equal(r.extraction, '2026-10-01');
  assert.equal(r.lineCount, 92887);
  assert.equal(r.rows.length, 92887);
  assert.deepEqual(r.rejected, { champs: 0, id: 0, prix: 0, isSelf: 0, dtComu: 0 });
});

test('fixture reelle : 23 930 stations, 113 lignes decalees, 3 coordonnees illisibles', () => {
  const r = parseStationsCsv(fixtures().stations);
  assert.equal(r.extraction, '2026-10-01');
  assert.equal(r.lineCount, 23930);
  assert.equal(r.shifted, 113);
  assert.equal(r.rejected.coordonnees, 3);
  assert.equal(r.stations.length, 23927);
});

test('station 40820 (un "|" dans le nom) : commune, province et coordonnees lues depuis la droite, nom absent', () => {
  const s = parseStationsCsv(fixtures().stations).stations.find(x => x.id === 40820);
  assert.equal(s.comune, 'ALESSANDRIA');
  assert.equal(s.provincia, 'AL');
  assert.equal(s.lat, 44.91704718250436);
  assert.equal(s.lng, 8.70067298412323);
  assert.equal(s.name, null);
});

test('en-tete de prix modifie : anomalie structurelle', () => {
  const t = fixtures().prices.replace(PRICES_HEADER, 'idImpianto|descCarburante|prezzo|isSelf|dtComu|extra');
  assert.throws(() => parsePricesCsv(t), e => e instanceof StructuralError && e.code === 'entete_prix_inattendu');
});

test('en-tete de stations modifie : anomalie structurelle', () => {
  const t = fixtures().stations.replace('|Comune|Provincia|', '|Comune|Prov|');
  assert.throws(() => parseStationsCsv(t), e => e instanceof StructuralError && e.code === 'entete_stations_inattendu');
});

test('ligne d extraction absente ou invalide : anomalie structurelle', () => {
  assert.throws(() => parsePricesCsv('Estrazione del 2026-13-01\n' + PRICES_HEADER + '\n'), e => e.code === 'date_extraction_invalide');
  assert.throws(() => parsePricesCsv('Extraction 2026-10-01\n' + PRICES_HEADER + '\n'), e => e.code === 'ligne_extraction_invalide');
});

test('dates d extraction differentes entre les deux fichiers : anomalie structurelle', () => {
  const p = pricesCsv([[1, 'Benzina', 1.9, 1, '30/09/2026 12:00:00']], '2026-10-01');
  const s = stationsCsv([[1, 'ROMA', 'RM', 41.9, 12.5]], '2026-09-30');
  assert.throws(() => buildIndex({ ...limits(), pricesText: p, stationsText: s, generatedAt: 'x' }), e => e.code === 'extractions_differentes');
});

test('prix : 5 champs exactement, isSelf 0 ou 1, dtComu au format JJ/MM/AAAA hh:mm:ss', () => {
  const t = pricesCsv([
    [1, 'Benzina', 1.9, 1, '30/09/2026 12:00:00'],
    [2, 'Benzina', 1.9, 1, '30/09/2026 12:00:00', 'en trop'],
    [3, 'Benzina', 'abc', 1, '30/09/2026 12:00:00'],
    [4, 'Benzina', 1.9, 2, '30/09/2026 12:00:00'],
    [5, 'Benzina', 1.9, 1, '2026-09-30 12:00:00'],
    [6, 'Benzina', 1.9, 1, '31/02/2026 12:00:00'],
  ]);
  const r = parsePricesCsv(t);
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.rejected, { champs: 1, id: 0, prix: 1, isSelf: 1, dtComu: 2 });
});

test('parseDtComu : composants exacts, heures et dates impossibles refusees', () => {
  assert.deepEqual(parseDtComu('30/09/2026 07:59:38'), { y: 2026, mo: 9, d: 30, h: 7, mi: 59, s: 38 });
  assert.equal(parseDtComu('30/09/2026 24:00:00'), null);
  assert.equal(parseDtComu('29/02/2026 10:00:00'), null);
});
