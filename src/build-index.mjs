// Orchestrateur PUR : textes CSV -> index (tuiles + manifeste) + rapport. Aucune entree/sortie, aucun reseau.
// Les anomalies structurelles levent StructuralError (le script appelant sort en erreur, rien n'est publie).
import { parsePricesCsv, parseStationsCsv, StructuralError } from './mimit-parser.mjs';
import { normalizePrices, countRetained } from './normalize.mjs';
import { qualifyStations } from './geographic-quality.mjs';
import { buildTiles } from './tiles.mjs';
import { buildManifest, evaluateGuards, assertValidPreviousManifest } from './manifest.mjs';
import { snapshotUtcMs } from './freshness.mjs';

/**
 * @param o.pricesText, o.stationsText  contenus des deux CSV
 * @param o.generatedAt                 ISO, fourni par l'appelant (seul champ temporel variable)
 * @param o.previousManifest            dernier manifeste publie, ou null
 * @param o.inputs                      { prices: {sha256, bytes}, stations: {sha256, bytes} }
 * @returns { status: 'OK' | 'NO_CHANGE' | 'GUARD_FAIL', extraction, manifest?, tiles?, report }
 */
export function buildIndex({ pricesText, stationsText, generatedAt, previousManifest = null, inputs = null, boundaries = null, boundariesMeta = null }) {
  if (!boundaries || !boundaries.bySigla) throw new StructuralError('limites_absentes');   // IT-1b : controle provincial obligatoire
  if (!boundariesMeta || !/^[0-9a-f]{64}$/.test(String(boundariesMeta.geojsonSha256))) throw new StructuralError('limites_metadonnees_absentes');
  if (previousManifest !== null) assertValidPreviousManifest(previousManifest);   // echec ferme : jamais de garde-fou partiel
  const prices = parsePricesCsv(pricesText);
  const stations = parseStationsCsv(stationsText);
  if (prices.extraction !== stations.extraction) {
    throw new StructuralError('extractions_differentes', `${prices.extraction} / ${stations.extraction}`);
  }
  const extraction = prices.extraction;
  const report = { extraction, previousExtraction: previousManifest ? previousManifest.extraction : null, inputs,
    parse: { prix: { lignes: prices.lineCount, rejets: prices.rejected }, stations: { lignes: stations.lineCount, decalees: stations.shifted, rejets: stations.rejected } } };

  if (previousManifest && !(extraction > previousManifest.extraction)) {   // jamais de retour en arriere, rien a faire si identique
    return { status: 'NO_CHANGE', extraction, report: { ...report, status: 'NO_CHANGE' } };
  }

  const norm = normalizePrices(prices.rows, extraction);
  const geo = qualifyStations(stations.stations, { boundaries });
  const built = buildTiles(geo.kept, norm.byStation, extraction);
  const indexedIds = [...geo.kept.keys()].filter(id => norm.byStation.has(id));
  const retained = countRetained(norm.byStation, indexedIds);
  const counts = {
    stationsValid: geo.counters.retenues,
    stationsIndexed: built.stationsIndexed,
    retainedByFuel: retained.byFuel,
    retainedByMode: retained.byMode,
    keys: norm.counters.cles,
    conflicts: norm.counters.conflits,
    tiles: built.keys.length,
  };
  const guards = evaluateGuards(counts, previousManifest);
  Object.assign(report, { normalisation: norm.counters, geographie: geo.counters, counts, guards });

  if (!guards.ok) return { status: 'GUARD_FAIL', extraction, report: { ...report, status: 'GUARD_FAIL' } };

  const manifest = buildManifest({
    extraction,
    snapshotAtUtc: new Date(snapshotUtcMs(extraction)).toISOString(),
    generatedAt,
    keys: built.keys,
    counts,
    inputs,
    boundaries: boundariesMeta,
  });
  return { status: 'OK', extraction, manifest, tiles: built.tiles, report: { ...report, status: 'OK' } };
}
