// Normalisation des prix -- fonctions pures.
// Ordre : filtres par ligne -> dedoublonnage par cle (station, carburant, mode) -> exclusion > 8 jours -> politique de mode.
import { magotFuel, modeAllowed, priceInRange, selectByPolicy } from './fuel-policy.mjs';
import { wallToUtcMs, snapshotUtcMs, isFutureVsSnapshot, ageDays, FALLBACK_DAYS } from './freshness.mjs';
import { formatComponents } from './mimit-parser.mjs';

export const FUEL_ORDER = ['sp95', 'diesel', 'gpl'];

/**
 * @param rows   lignes issues de parsePricesCsv
 * @param extraction "AAAA-MM-JJ"
 * @returns { byStation: Map<id, {fuel: {price, reported, reportedUtcMs, mode}}>, counters }
 */
export function normalizePrices(rows, extraction) {
  const snapMs = snapshotUtcMs(extraction);
  const counters = {
    lignes: rows.length,
    carburantIgnore: 0,        // libelle hors Benzina / Gasolio / GPL
    modeNonAdmis: 0,           // ex. SP95 ou diesel servis
    prixHorsPlage: 0,
    futur: 0,                  // dtComu apres 8 h 15 le jour d'extraction
    cles: 0,                   // cles (station, carburant, mode) distinctes avant dedoublonnage
    doublonsIdentiques: 0,     // lignes strictement identiques fusionnees
    plusRecenteRetenue: 0,     // cles ou plusieurs dates existaient
    conflits: 0,               // meme dtComu, prix differents -> cle rejetee
    tropAnciens: 0,            // > 8 jours au moment du releve
    retenusParCarburant: { sp95: 0, diesel: 0, gpl: 0 },
    retenusParMode: { SELF: 0, SERVED: 0 },
  };
  const groups = new Map();
  for (const r of rows) {
    const fuel = magotFuel(r.desc);
    if (!fuel) { counters.carburantIgnore++; continue; }
    const mode = r.isSelf ? 'SELF' : 'SERVED';
    if (!modeAllowed(fuel, mode)) { counters.modeNonAdmis++; continue; }
    if (!priceInRange(r.price)) { counters.prixHorsPlage++; continue; }
    const utc = wallToUtcMs(r.dtComu);
    if (isFutureVsSnapshot(utc, snapMs)) { counters.futur++; continue; }
    const key = `${r.id}|${fuel}|${mode}`;
    let g = groups.get(key);
    if (!g) { g = { id: r.id, fuel, mode, items: [] }; groups.set(key, g); }
    g.items.push({ price: r.price, reported: formatComponents(r.dtComu), reportedUtcMs: utc });
  }
  counters.cles = groups.size;

  // Dedoublonnage deterministe
  const kept = new Map();   // id -> fuel -> { SELF?, SERVED? }
  for (const g of groups.values()) {
    const uniq = new Map();
    for (const it of g.items) {
      const k = it.reported + '|' + it.price;
      if (uniq.has(k)) counters.doublonsIdentiques++; else uniq.set(k, it);
    }
    const items = [...uniq.values()];
    const latest = Math.max(...items.map(i => i.reportedUtcMs));
    const atLatest = items.filter(i => i.reportedUtcMs === latest);
    if (new Set(atLatest.map(i => i.price)).size > 1) { counters.conflits++; continue; }   // jamais de choix arbitraire
    if (new Set(items.map(i => i.reportedUtcMs)).size > 1) counters.plusRecenteRetenue++;
    const rec = atLatest[0];
    if (ageDays(rec.reportedUtcMs, snapMs) > FALLBACK_DAYS) { counters.tropAnciens++; continue; }
    let byFuel = kept.get(g.id);
    if (!byFuel) { byFuel = {}; kept.set(g.id, byFuel); }
    (byFuel[g.fuel] ||= {})[g.mode] = rec;
  }

  // Politique de mode par carburant (configuration du fournisseur)
  const byStation = new Map();
  for (const [id, byFuel] of kept) {
    const out = {};
    for (const fuel of FUEL_ORDER) {
      if (!byFuel[fuel]) continue;
      const sel = selectByPolicy(fuel, byFuel[fuel]);
      if (sel) { out[fuel] = sel; counters.retenusParCarburant[fuel]++; counters.retenusParMode[sel.mode]++; }
    }
    if (Object.keys(out).length) byStation.set(id, out);
  }
  return { byStation, counters };
}

/** Compte les prix retenus par carburant et par mode, pour un ensemble de stations donne. */
export function countRetained(byStation, stationIds) {
  const byFuel = { sp95: 0, diesel: 0, gpl: 0 }, byMode = { SELF: 0, SERVED: 0 };
  for (const id of stationIds) {
    const f = byStation.get(id);
    if (!f) continue;
    for (const fuel of FUEL_ORDER) if (f[fuel]) { byFuel[fuel]++; byMode[f[fuel].mode]++; }
  }
  return { byFuel, byMode };
}
