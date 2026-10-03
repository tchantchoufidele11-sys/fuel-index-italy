// Limites provinciales ISTAT (GeoJSON WGS84 deja normalise) -- fonctions pures, aucune reprojection a l'execution.
import { StructuralError } from './mimit-parser.mjs';

export const PROVINCE_BUFFER_KM = 5;   // choix d'ingenierie mesure (IT-1b), pas une propriete annoncee par l'ISTAT
export const SARDINIA_REGION_CODE = 20;
// Sigles sardes anciens (MIMIT) et nouveaux (reforme en vigueur au 01/01/2026 ; CI dans le fichier ISTAT, SU annonce par SITUAS).
export const SARDINIA_SIGLE = Object.freeze(new Set(['SS', 'NU', 'OR', 'CA', 'SU', 'OT', 'OG', 'VS', 'CI']));
const KM_PER_DEG = 6371.0088 * Math.PI / 180;

/** GeoJSON -> index { bySigla: Map<sigle, unite>, sardinia: unite[] } ; unite = { sigla, codReg, bbox, rings }. */
export function indexBoundaries(geojson) {
  if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) throw new StructuralError('limites_format_invalide');
  const bySigla = new Map();
  for (const f of geojson.features) {
    const p = f && f.properties, g = f && f.geometry;
    if (!p || !/^[A-Z]{2}$/.test(p.sigla) || !Number.isInteger(p.cod_reg) || !g || g.type !== 'MultiPolygon') throw new StructuralError('limites_unite_invalide', p && p.sigla);
    if (bySigla.has(p.sigla)) throw new StructuralError('limites_sigle_duplique', p.sigla);
    const rings = g.coordinates.flat();   // contours et trous : la regle pair-impair suffit
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const r of rings) for (const [lon, lat] of r) {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    bySigla.set(p.sigla, { sigla: p.sigla, codReg: p.cod_reg, bbox: [minLon, minLat, maxLon, maxLat], rings });
  }
  const sardinia = [...bySigla.values()].filter(u => u.codReg === SARDINIA_REGION_CODE);
  return { bySigla, sardinia };
}

/**
 * Unites ISTAT contre lesquelles controler une station de sigle MIMIT donne.
 * Sardaigne : union de toutes les unites sardes (compatibilite transitoire, MIMIT en retard sur la reforme).
 * Retourne null si aucune limite ne correspond (la station sera mise en quarantaine).
 */
export function candidatesFor(index, mimitSigla) {
  if (SARDINIA_SIGLE.has(mimitSigla)) return index.sardinia.length ? { units: index.sardinia, sardiniaCompat: true } : null;
  const u = index.bySigla.get(mimitSigla);
  return u ? { units: [u], sardiniaCompat: false } : null;
}

function inRings(rings, lon, lat) {
  let c = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

export function insideAny(units, lon, lat) {
  for (const u of units) {
    const [a, b, c, d] = u.bbox;
    if (lon >= a && lon <= c && lat >= b && lat <= d && inRings(u.rings, lon, lat)) return true;
  }
  return false;
}

/** Distance (km) du point au contour le plus proche des unites ; arret des qu'elle est <= stopKm. Projection locale equirectangulaire. */
export function distanceKmToAny(units, lon, lat, stopKm = 0) {
  const kx = KM_PER_DEG * Math.cos(lat * Math.PI / 180), ky = KM_PER_DEG;
  let best = Infinity;
  for (const u of units) {
    const [a, b, c, d] = u.bbox;
    const bx = lon < a ? (a - lon) * kx : lon > c ? (lon - c) * kx : 0, by = lat < b ? (b - lat) * ky : lat > d ? (lat - d) * ky : 0;
    if (Math.hypot(bx, by) >= best) continue;   // la boite entiere est plus loin que le meilleur trouve
    for (const r of u.rings) {
      for (let i = 0; i < r.length - 1; i++) {
        const x1 = (r[i][0] - lon) * kx, y1 = (r[i][1] - lat) * ky, x2 = (r[i + 1][0] - lon) * kx, y2 = (r[i + 1][1] - lat) * ky;
        const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / L)) : 0;
        const dd = Math.hypot(x1 + t * dx, y1 + t * dy);
        if (dd < best) { best = dd; if (best <= stopKm) return best; }
      }
    }
  }
  return best;
}

/** Hors de sa province de plus de bufferKm ? */
export function outsideProvince(units, lon, lat, bufferKm = PROVINCE_BUFFER_KM) {
  if (insideAny(units, lon, lat)) return false;
  return distanceKmToAny(units, lon, lat, bufferKm) > bufferKm;
}
