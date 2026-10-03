// Qualite geographique des stations (IT-1b) -- fonctions pures.
// Regle gelee : point partage entre communes differentes -> rejet ; sinon station a plus de 5 km a l'exterieur
// du polygone de sa province ISTAT 2026 -> rejet. Sardaigne : controle contre l'union des unites sardes.
// (Remplace la regle IT-1 de la mediane de commune a 25 km : faux rejets d'iles et angle mort des petites communes.)
import { candidatesFor, outsideProvince, PROVINCE_BUFFER_KM, SARDINIA_SIGLE } from './province-boundaries.mjs';

// Les 107 sigles du MIMIT (fixture du 2026-10-01, liste derivee a recouper officiellement)
export const MIMIT_PROVINCES = Object.freeze(new Set(
  ('AG AL AN AO AP AQ AR AT AV BA BG BI BL BN BO BR BS BT BZ CA CB CE CH CL CN CO CR CS CT CZ EN FC FE FG FI FM FR GE GO GR ' +
   'IM IS KR LC LE LI LO LT LU MB MC ME MI MN MO MS MT NA NO NU OR PA PC PD PE PG PI PN PO PR PT PU PV PZ RA RC RE RG RI RM ' +
   'RN RO SA SI SO SP SR SS SU SV TA TE TN TO TP TR TS TV UD VA VB VC VE VI VR VT VV').split(' ')));
// Sigles acceptes en entree : MIMIT + nouveaux sigles sardes (une migration progressive du MIMIT ne casse rien)
export const ACCEPTED_PROVINCES = Object.freeze(new Set([...MIMIT_PROVINCES, ...SARDINIA_SIGLE]));
export const ITALY_BOUNDS = Object.freeze({ latMin: 35.2, latMax: 47.2, lngMin: 6.5, lngMax: 18.6 });
export const SHARED_POINT_DECIMALS = 4;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dp = (lat2 - lat1) * rad, dl = (lng2 - lng1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const communeKey = s => s.comune + '|' + s.provincia;   // jamais le nom seul

/**
 * @param stations   sortie de parseStationsCsv
 * @param boundaries index des limites (indexBoundaries) -- OBLIGATOIRE
 * @returns { kept: Map<id, station>, counters, rejected: { coords, quarantine, sharedPoint, outsideProvince } }
 */
export function qualifyStations(stations, { boundaries, provinces = ACCEPTED_PROVINCES, bounds = ITALY_BOUNDS, bufferKm = PROVINCE_BUFFER_KM } = {}) {
  if (!boundaries || !boundaries.bySigla) throw new TypeError('limites provinciales obligatoires');
  const counters = { entree: stations.length, coordonneesRejetees: 0,
    quarantaine: { province: 0, commune: 0, idDuplique: 0, provinceSansLimite: 0 },
    pointPartage: 0, horsProvince: 0, rejetsGeographiques: 0, retenues: 0,
    geoSardiniaCompatibilityCount: 0, siglesSardesObserves: {} };
  const rejected = { coords: new Set(), quarantine: new Set(), sharedPoint: new Set(), outsideProvince: new Set() };

  const idCount = new Map();
  for (const s of stations) idCount.set(s.id, (idCount.get(s.id) || 0) + 1);

  const base = [];
  for (const s of stations) {
    if (idCount.get(s.id) > 1) { counters.quarantaine.idDuplique++; rejected.quarantine.add(s.id); continue; }
    if (!provinces.has(s.provincia)) { counters.quarantaine.province++; rejected.quarantine.add(s.id); continue; }
    if (!s.comune) { counters.quarantaine.commune++; rejected.quarantine.add(s.id); continue; }
    const cand = candidatesFor(boundaries, s.provincia);
    if (!cand) { counters.quarantaine.provinceSansLimite++; rejected.quarantine.add(s.id); continue; }
    const okCoords = Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat !== 0 && s.lng !== 0 &&
      s.lat >= bounds.latMin && s.lat <= bounds.latMax && s.lng >= bounds.lngMin && s.lng <= bounds.lngMax;
    if (!okCoords) { counters.coordonneesRejetees++; rejected.coords.add(s.id); continue; }
    if (cand.sardiniaCompat) {
      counters.geoSardiniaCompatibilityCount++;
      counters.siglesSardesObserves[s.provincia] = (counters.siglesSardesObserves[s.provincia] || 0) + 1;
    }
    base.push({ s, units: cand.units });
  }

  // Filtre 1 : meme point (4 decimales) partage par des stations de communes differentes -> toutes rejetees
  const byPoint = new Map();
  for (const { s } of base) {
    const k = s.lat.toFixed(SHARED_POINT_DECIMALS) + ',' + s.lng.toFixed(SHARED_POINT_DECIMALS);
    (byPoint.get(k) || byPoint.set(k, []).get(k)).push(s);
  }
  for (const group of byPoint.values()) {
    if (group.length > 1 && new Set(group.map(communeKey)).size > 1) for (const s of group) rejected.sharedPoint.add(s.id);
  }

  // Filtre 2 : plus de bufferKm a l'exterieur du polygone de sa province (union sarde pour la Sardaigne)
  for (const { s, units } of base) if (outsideProvince(units, s.lng, s.lat, bufferKm)) rejected.outsideProvince.add(s.id);

  counters.pointPartage = rejected.sharedPoint.size;
  counters.horsProvince = rejected.outsideProvince.size;
  const kept = new Map();
  for (const { s } of base) {
    if (rejected.sharedPoint.has(s.id) || rejected.outsideProvince.has(s.id)) { counters.rejetsGeographiques++; continue; }
    kept.set(s.id, s);
  }
  counters.retenues = kept.size;
  counters.siglesSardesObserves = Object.fromEntries(Object.entries(counters.siglesSardesObserves).sort());
  return { kept, counters, rejected };
}
