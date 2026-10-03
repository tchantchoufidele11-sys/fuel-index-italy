// Manifeste et garde-fous de publication -- fonctions pures.
import { TILE_DEG } from './tiles.mjs';
import { SOURCE_TZ, TZ_CONFIRMED } from './freshness.mjs';
import { SERVICE_POLICY, FUEL_MAP, PRICE_MIN, PRICE_MAX } from './fuel-policy.mjs';
import { PROVINCE_BUFFER_KM } from './province-boundaries.mjs';

export const SCHEMA_VERSION = 1;

/** Manifeste precedent invalide : arret (code 4), jamais de continuation avec des garde-fous partiels. */
export class ManifestError extends Error {
  constructor(problems) {
    super('manifeste_precedent_invalide : ' + problems.join(', '));
    this.name = 'ManifestError';
    this.code = 'manifeste_precedent_invalide';
    this.problems = problems;
    this.exitCode = 4;
  }
}

const isNonNegInt = v => Number.isInteger(v) && v >= 0;
function isCivilDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Validation stricte d'un manifeste publie. Retourne la liste des problemes (vide = valide). */
export function validateManifest(m) {
  const p = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['objet_attendu'];
  if (m.schema !== SCHEMA_VERSION) p.push('schema');
  if (m.country !== 'IT') p.push('country');
  if (!isCivilDate(m.extraction)) p.push('extraction');
  if (m.dir !== m.extraction) p.push('dir');
  if (m.tileDeg !== TILE_DEG) p.push('tileDeg');
  if (!Array.isArray(m.tiles) || !m.tiles.every(k => typeof k === 'string' && /^-?\d+_-?\d+$/.test(k))) p.push('tiles');
  else if (m.tiles.some((k, i) => i > 0 && m.tiles[i - 1] >= k)) p.push('tiles_ordre');
  if (typeof m.snapshotAt !== 'string' || !Number.isFinite(Date.parse(m.snapshotAt))) p.push('snapshotAt');
  if (typeof m.generatedAt !== 'string' || !m.generatedAt) p.push('generatedAt');
  if (!m.tz || m.tz.dtComu !== SOURCE_TZ || typeof m.tz.confirmed !== 'boolean') p.push('tz');
  const b = m.boundaries;
  if (!b || typeof b !== 'object' || !/^[0-9a-f]{64}$/.test(String(b.geojsonSha256)) || b.bufferKm !== PROVINCE_BUFFER_KM || !isCivilDate(b.referenceDate)) p.push('boundaries');
  const c = m.counts;
  if (!c || typeof c !== 'object') p.push('counts');
  else {
    for (const k of ['stationsValid', 'stationsIndexed', 'keys', 'conflicts', 'tiles']) if (!isNonNegInt(c[k])) p.push('counts.' + k);
    const r = c.retainedByFuel;
    if (!r || typeof r !== 'object') p.push('counts.retainedByFuel');
    else for (const f of ['sp95', 'diesel', 'gpl']) if (!isNonNegInt(r[f])) p.push('counts.retainedByFuel.' + f);
    if (isNonNegInt(c.tiles) && Array.isArray(m.tiles) && c.tiles !== m.tiles.length) p.push('counts.tiles_incoherent');
  }
  return p;
}

/**
 * Coherences vraies PAR CONSTRUCTION d'un manifeste produit par ce constructeur.
 * Une violation revele une corruption (ou un manifeste qui n'a pas pu etre publie).
 */
export function manifestCoherenceProblems(m) {
  const p = [], c = m.counts, r = c.retainedByFuel, mode = c.retainedByMode;
  const sumFuel = r.sp95 + r.diesel + r.gpl;
  if (c.stationsIndexed > c.stationsValid) p.push('coherence.stationsIndexed>stationsValid');
  for (const f of ['sp95', 'diesel', 'gpl']) if (r[f] > c.stationsIndexed) p.push(`coherence.${f}>stationsIndexed`);   // au plus un prix par station et carburant
  if (c.stationsIndexed > sumFuel) p.push('coherence.stationsIndexed>prix');                                         // une station indexee a au moins un prix
  if (c.tiles < 1 || c.tiles > c.stationsIndexed) p.push('coherence.zones');
  if (c.conflicts > c.keys || sumFuel > c.keys) p.push('coherence.cles');
  if (!mode || !Number.isInteger(mode.SELF) || !Number.isInteger(mode.SERVED) || mode.SELF < 0 || mode.SERVED < 0) p.push('counts.retainedByMode');
  else {
    if (mode.SELF + mode.SERVED !== sumFuel) p.push('coherence.modes!=prix');
    if (mode.SERVED > r.gpl) p.push('coherence.servi>gpl');                                                          // seul le GPL peut etre servi
  }
  return p;
}

/**
 * Manifeste precedent acceptable = structurellement valide + garde-fous ABSOLUS satisfaits (ceux qui ont permis sa
 * publication) + coherences de construction. Sinon ManifestError (code 4) : jamais de controle de chute neutralise.
 */
export function assertValidPreviousManifest(m) {
  let problems = validateManifest(m);
  if (!problems.length) {
    problems = manifestCoherenceProblems(m);
    const g = evaluateGuards(m.counts, null);   // seuils absolus : stations, carburants, ratio de conflits
    if (!g.ok) problems = problems.concat(g.failures.map(f => 'garde_fou.' + f));
  }
  if (problems.length) throw new ManifestError(problems);
  return m;
}
export const SOURCE = 'MIMIT – Osservaprezzi carburanti';
export const LICENSE = 'IODL 2.0';
// Texte d'attribution PROVISOIRE : point ouvert de la specification (texte exact a valider avant mise en service).
export const ATTRIBUTION = 'Fonte: Ministero delle Imprese e del Made in Italy – Osservaprezzi carburanti (IODL 2.0)';

// Seuils de la specification gelee. Fixture du 2026-10-01 : 23 753 stations valides apres controle geographique
// (20 432 indexees avec au moins un prix) ; prix retenus apres filtre geographique 20 018 / 20 022 / 4 518 ; 0 conflit.
export const GUARDS = Object.freeze({
  minStations: 20000,        // stations VALIDES apres controle geographique (pas seulement celles ayant un prix)
  minByFuel: Object.freeze({ sp95: 15000, diesel: 15000, gpl: 3500 }),
  maxDropRatio: 0.20,       // chute par carburant vs dernier index publie
  maxConflictRatio: 0.01,   // cles rejetees pour conflit / cles
});

/**
 * @param counts { stationsValid, retainedByFuel, keys, conflicts }
 * @param previousManifest manifeste publie (ou null)
 * @returns { ok, failures: string[] }
 */
export function evaluateGuards(counts, previousManifest) {
  const failures = [];
  if (!(counts.stationsValid >= GUARDS.minStations)) failures.push(`stations_insuffisantes:${counts.stationsValid}<${GUARDS.minStations}`);
  for (const [fuel, min] of Object.entries(GUARDS.minByFuel)) {
    const n = counts.retainedByFuel[fuel] || 0;
    if (!(n >= min)) failures.push(`prix_${fuel}_insuffisants:${n}<${min}`);
  }
  const ratio = counts.keys ? counts.conflicts / counts.keys : 0;
  if (ratio > GUARDS.maxConflictRatio) failures.push(`conflits_excessifs:${counts.conflicts}/${counts.keys}`);
  const prev = previousManifest && previousManifest.counts && previousManifest.counts.retainedByFuel;
  if (prev) {
    for (const fuel of Object.keys(GUARDS.minByFuel)) {
      const before = prev[fuel], now = counts.retainedByFuel[fuel] || 0;
      if (before > 0 && (before - now) / before > GUARDS.maxDropRatio) failures.push(`chute_${fuel}:${before}->${now}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Manifeste : ordre des cles fixe. generatedAt est le seul champ temporel variable. */
export function buildManifest({ extraction, snapshotAtUtc, generatedAt, keys, counts, inputs, boundaries }) {
  return {
    schema: SCHEMA_VERSION,
    country: 'IT',
    extraction,
    snapshotAt: snapshotAtUtc,                 // 8 h 00 du jour d'extraction, heure de Rome, exprime en UTC
    snapshotLocal: `${extraction}T08:00:00`,
    generatedAt,
    tileDeg: TILE_DEG,
    dir: extraction,
    tiles: keys,
    counts,
    inputs,
    source: SOURCE,
    license: LICENSE,
    attribution: ATTRIBUTION,
    tz: { dtComu: SOURCE_TZ, confirmed: TZ_CONFIRMED },
    fuels: FUEL_MAP,
    servicePolicy: SERVICE_POLICY,
    priceRange: [PRICE_MIN, PRICE_MAX],
    boundaries: {                               // IT-1b : controle provincial ISTAT
      rule: 'POINT_PARTAGE_INTERCOMMUNAL + POLYGONE_PROVINCE_ISTAT',
      bufferKm: PROVINCE_BUFFER_KM,
      sardiniaCompatibility: 'UNION_DES_UNITES_SARDES',
      dataset: boundaries.dataset,
      referenceDate: boundaries.referenceDate,
      geojsonSha256: boundaries.geojsonSha256,
      license: boundaries.license,
      attribution: boundaries.attribution,
    },
  };
}
