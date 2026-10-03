// Tuilage de l'index -- fonctions pures, sortie deterministe (ordre des cles et des stations fixe).
import { FUEL_ORDER } from './normalize.mjs';

export const TILE_DEG = 0.25;

export function tileIndex(lat, lng, deg = TILE_DEG) {
  return [Math.floor(lat / deg), Math.floor(lng / deg)];
}
export function tileKey(iLat, iLon) { return `${iLat}_${iLon}`; }
export function tileFileName(key) { return `z_${key}.json`; }

/**
 * @param kept      Map<id, station> (stations retenues apres qualite geographique)
 * @param byStation Map<id, {fuel: {price, reported, mode}}> (prix retenus)
 * @returns { tiles: Map<key, jsonString>, keys: string[] tries, stationsIndexed }
 * Une station n'entre dans l'index que si elle a au moins un carburant retenu.
 * Entree carburant : [prix, "AAAA-MM-JJThh:mm:ss", "SELF" | "SERVED"].
 */
export function buildTiles(kept, byStation, extraction, deg = TILE_DEG) {
  const groups = new Map();
  let stationsIndexed = 0;
  const ids = [...kept.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const prices = byStation.get(id);
    if (!prices) continue;
    const s = kept.get(id);
    const f = {};
    for (const fuel of FUEL_ORDER) if (prices[fuel]) f[fuel] = [prices[fuel].price, prices[fuel].reported, prices[fuel].mode];
    if (!Object.keys(f).length) continue;
    const entry = { id, lat: s.lat, lng: s.lng };
    if (s.name) entry.name = s.name;
    entry.f = f;
    const key = tileKey(...tileIndex(s.lat, s.lng, deg));
    (groups.get(key) || groups.set(key, []).get(key)).push(entry);
    stationsIndexed++;
  }
  const keys = [...groups.keys()].sort();
  const tiles = new Map();
  for (const k of keys) tiles.set(k, JSON.stringify({ extraction, tile: k, stations: groups.get(k) }));
  return { tiles, keys, stationsIndexed };
}
