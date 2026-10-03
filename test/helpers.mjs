// Aides de test : fixtures reelles du 2026-10-01 (en cache) et petits CSV synthetiques.
import { readFileSync } from 'node:fs';
import { buildIndex } from '../src/build-index.mjs';
import { buildManifest } from '../src/manifest.mjs';
import { sha256Hex } from '../src/sha256.mjs';
import { loadBoundaries } from '../scripts/fetch-and-build.mjs';

// Limites ISTAT versionnees, chargees UNE fois avec verification d'empreinte (comme le script).
const LIMITS = await loadBoundaries();
export function limits() { return { boundaries: LIMITS.index, boundariesMeta: LIMITS.meta }; }
export const BOUNDARIES_META = LIMITS.meta;
import { PRICES_HEADER, STATIONS_HEADER } from '../src/mimit-parser.mjs';

const FIX = new URL('./fixtures/', import.meta.url);
export const PRICES_FIXTURE = new URL('prezzo_alle_8_2026-10-01.csv', FIX).pathname;
export const STATIONS_FIXTURE = new URL('anagrafica_impianti_attivi_2026-10-01.csv', FIX).pathname;
export const PRICES_SHA256 = 'd274db0cea67267ddd770c834d7aa47bc35af106591235de9cf1144273e55b72';
export const STATIONS_SHA256 = 'a33db58b57b7c634cdbbddba2abdd3116d4006aa23188ee3ab80e55816d1f26c';

let cache = null;
export function fixtures() {
  if (!cache) cache = { prices: readFileSync(PRICES_FIXTURE, 'utf8'), stations: readFileSync(STATIONS_FIXTURE, 'utf8') };
  return cache;
}

/** inputs EXACTEMENT comme le script publie (SHA-256 + taille des fichiers bruts). */
export function fixtureInputs() {
  const p = readFileSync(PRICES_FIXTURE), s = readFileSync(STATIONS_FIXTURE);
  return { prices: { sha256: sha256Hex(p), bytes: p.length }, stations: { sha256: sha256Hex(s), bytes: s.length } };
}

let built = null;
export function builtFixture() {
  if (!built) {
    const f = fixtures();
    built = buildIndex({ ...limits(), pricesText: f.prices, stationsText: f.stations, generatedAt: '2026-10-02T00:00:00.000Z', inputs: fixtureInputs() });
  }
  return built;
}

export function allIndexedStations(result) {
  return [...result.tiles.values()].flatMap(s => JSON.parse(s).stations);
}
/** Manifeste precedent COMPLET, valide et publiable (coherent par construction), pour les tests. */
export function previousManifest(extraction, retainedByFuel = { sp95: 20000, diesel: 20000, gpl: 4500 }, servedGpl = 4300) {
  const sum = retainedByFuel.sp95 + retainedByFuel.diesel + retainedByFuel.gpl;
  return buildManifest({
    extraction, snapshotAtUtc: `${extraction}T06:00:00.000Z`, generatedAt: `${extraction}T09:00:00.000Z`, keys: ['168_49', '169_50'],
    counts: { stationsValid: 23500, stationsIndexed: 20300, retainedByFuel, retainedByMode: { SELF: sum - servedGpl, SERVED: servedGpl },
      keys: 45000, conflicts: 0, tiles: 2 },
    inputs: null,
    boundaries: BOUNDARIES_META,
  });
}

/** Petit CSV de prix synthetique. rows : [id, desc, prix, isSelf(0|1), "JJ/MM/AAAA hh:mm:ss"] */
export function pricesCsv(rows, extraction = '2026-10-01') {
  return [`Estrazione del ${extraction}`, PRICES_HEADER, ...rows.map(r => r.join('|')), ''].join('\n');
}

/** Petit CSV de stations synthetique. rows : [id, comune, provincia, lat, lng, nom?] */
export function stationsCsv(rows, extraction = '2026-10-01') {
  return [`Estrazione del ${extraction}`, STATIONS_HEADER,
    ...rows.map(([id, comune, prov, lat, lng, nom = 'STAZIONE']) => [id, 'GESTORE', 'Bandiera', 'Stradale', nom, 'VIA ROMA 1', comune, prov, lat, lng].join('|')), ''].join('\n');
}
