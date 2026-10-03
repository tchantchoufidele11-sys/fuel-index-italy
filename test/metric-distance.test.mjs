// Contre-verification METRIQUE independante de la regle des 5 km.
// Methode A (execution) : GeoJSON WGS 84, distance en km dans un repere local centre sur la station
//   (longitude x 111,195 x cos(latitude), latitude x 111,195) -- jamais de tampon en degres.
// Methode B (reference) : polygones du SHAPEFILE SOURCE en UTM 32N (metres), station projetee en UTM 32N,
//   distance divisee par le facteur d'echelle UTM local (0,9996 au meridien central, ~1,0075 dans le Salento).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readPolygonShp, readDbf } from '../src/istat-shapefile.mjs';
import { toUtm32 } from '../src/utm32.mjs';
import { parseStationsCsv } from '../src/mimit-parser.mjs';
import { candidatesFor, insideAny, distanceKmToAny, SARDINIA_SIGLE, SARDINIA_REGION_CODE, PROVINCE_BUFFER_KM } from '../src/province-boundaries.mjs';
import { DEFAULT_BOUNDARIES_DIR } from '../scripts/fetch-and-build.mjs';
import { fixtures, limits } from './helpers.mjs';

const BASE = path.join(DEFAULT_BOUNDARIES_DIR, 'source', 'ProvCM01012026_g_WGS84');
const shp = readPolygonShp(new Uint8Array(readFileSync(BASE + '.shp')));
const dbf = readDbf(new Uint8Array(readFileSync(BASE + '.dbf')));
const utmUnits = new Map(dbf.map((r, i) => [r.SIGLA, { reg: +r.COD_REG, rings: shp[i].rings }]));
const utmSardinia = [...utmUnits.values()].filter(u => u.reg === SARDINIA_REGION_CODE);

function inRings(rings, x, y) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function distRingsM(rings, x, y) {
  let b = Infinity;
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
    const [x1, y1] = r[i], [x2, y2] = r[i + 1], dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
    b = Math.min(b, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
  }
  return b;
}

test('methode d execution et reference UTM independante : meme verdict a 5 km pour toutes les stations ; ecart < 50 m entre 2 et 10 km', () => {
  const b = limits().boundaries;
  const stations = parseStationsCsv(fixtures().stations).stations.filter(s => candidatesFor(b, s.provincia) && s.lat > 35 && s.lng > 6);
  let compared = 0, rejected = 0, worstDecisiveM = 0;
  for (const s of stations) {
    const units = candidatesFor(b, s.provincia).units;
    const inA = insideAny(units, s.lng, s.lat);
    const dA = inA ? 0 : distanceKmToAny(units, s.lng, s.lat, 0);
    const ref = SARDINIA_SIGLE.has(s.provincia) ? utmSardinia : [utmUnits.get(s.provincia)];
    const [x, y] = toUtm32(s.lat, s.lng);
    const k = 0.9996 * (1 + ((x - 500000) / 1000) ** 2 / (2 * 6371 ** 2));
    const inB = ref.some(u => inRings(u.rings, x, y));
    const dB = inB ? 0 : Math.min(...ref.map(u => distRingsM(u.rings, x, y))) / 1000 / k;
    assert.equal(inA, inB, `dedans/dehors, station ${s.id}`);
    assert.equal(dA > PROVINCE_BUFFER_KM, dB > PROVINCE_BUFFER_KM, `verdict 5 km, station ${s.id} (${dA} / ${dB} km)`);
    if (dA >= 2 && dA <= 10) worstDecisiveM = Math.max(worstDecisiveM, Math.abs(dA - dB) * 1000);
    if (dA > PROVINCE_BUFFER_KM) rejected++;
    compared++;
  }
  assert.equal(compared, 23927);
  assert.equal(rejected, 66);
  assert.ok(worstDecisiveM < 50, `ecart max dans la zone decisive : ${worstDecisiveM.toFixed(1)} m`);
});

test('pas de tampon en degres : a 46,5 deg N, un point a 0,06 deg de longitude du bord est a 4,6 km -> garde', async () => {
  const { outsideProvince } = await import('../src/province-boundaries.mjs');
  const ring = [[[9.0, 46.4], [9.1, 46.4], [9.1, 46.6], [9.0, 46.6], [9.0, 46.4]]];
  const units = [{ bbox: [9.0, 46.4, 9.1, 46.6], rings: ring }];
  const kmPerDegLon = 6371.0088 * Math.PI / 180 * Math.cos(46.5 * Math.PI / 180);
  const d = distanceKmToAny(units, 9.1 + 0.06, 46.5, 0);
  assert.ok(Math.abs(d - 0.06 * kmPerDegLon) < 0.001, `${d} km`);
  assert.ok(d > 4.5 && d < 4.7);
  assert.equal(outsideProvince(units, 9.1 + 0.06, 46.5), false);   // un tampon naif de 0,05 deg l'aurait rejete
  assert.equal(outsideProvince(units, 9.1 + 0.066, 46.5), true);   // 5,06 km reels -> rejete
});
