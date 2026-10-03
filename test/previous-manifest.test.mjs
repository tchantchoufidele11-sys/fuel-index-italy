import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../src/build-index.mjs';
import { ManifestError, assertValidPreviousManifest } from '../src/manifest.mjs';
import { fixtures, builtFixture, previousManifest, limits } from './helpers.mjs';

const rejects = (m, pattern, label) => {
  const f = fixtures();
  assert.throws(
    () => buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: 'x', previousManifest: m }),
    e => e instanceof ManifestError && e.exitCode === 4 && pattern.test(e.problems.join(',')),
    label,
  );
};
const withCounts = (patch, base = previousManifest('2026-09-30')) => ({ ...base, counts: { ...base.counts, ...patch } });

test('TEMOIN : manifeste precedent structurellement parfait mais a zero -> refuse (le controle de chute ne peut plus etre neutralise)', () => {
  const m = withCounts({ stationsValid: 0, stationsIndexed: 0, retainedByFuel: { sp95: 0, diesel: 0, gpl: 0 }, retainedByMode: { SELF: 0, SERVED: 0 }, keys: 0, tiles: 0 },
    { ...previousManifest('2026-09-30'), tiles: [] });
  rejects(m, /garde_fou\.stations_insuffisantes.*garde_fou\.prix_sp95_insuffisants.*prix_diesel_insuffisants.*prix_gpl_insuffisants/, 'zero');
});

test('seuils absolus exiges du manifeste precedent : stations, SP95, diesel, GPL', () => {
  rejects(withCounts({ stationsValid: 19999 }), /stations_insuffisantes/, 'stations');
  const base = previousManifest('2026-09-30', { sp95: 14999, diesel: 20000, gpl: 4500 });
  rejects(base, /prix_sp95_insuffisants/, 'sp95');
  rejects(previousManifest('2026-09-30', { sp95: 20000, diesel: 14999, gpl: 4500 }), /prix_diesel_insuffisants/, 'diesel');
  rejects(previousManifest('2026-09-30', { sp95: 20000, diesel: 20000, gpl: 3499 }, 3000), /prix_gpl_insuffisants/, 'gpl');
});

test('ratio de conflits du manifeste precedent > 1 % : refuse', () => {
  rejects(withCounts({ conflicts: 451 }), /conflits_excessifs/, 'conflits');   // 451 / 45 000 > 1 %
});

test('coherences de construction : chaque violation est refusee', () => {
  rejects(withCounts({ stationsIndexed: 23501 }), /stationsIndexed>stationsValid/, 'indexees > valides');
  rejects(withCounts({ stationsIndexed: 19999 }), /sp95>stationsIndexed/, 'prix > stations');
  rejects(withCounts({ retainedByMode: { SELF: 40000, SERVED: 4300 } }), /modes!=prix/, 'modes');
  rejects(withCounts({ retainedByMode: { SELF: 39700, SERVED: 4800 } }), /servi>gpl/, 'servi > gpl');
  rejects(withCounts({ keys: 44000 }), /coherence\.cles/, 'cles');
  rejects(withCounts({ retainedByMode: undefined }), /retainedByMode/, 'modes absents');
});

test('enchainement reel : le manifeste du 2026-10-01 est un precedent valide', () => {
  const real = builtFixture().manifest;
  assert.equal(assertValidPreviousManifest(real), real);
  const f = fixtures();
  const r = buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: 'x', previousManifest: real });
  assert.equal(r.status, 'NO_CHANGE');   // meme extraction : rien a faire
});
