// Conversion des limites provinciales ISTAT (shapefile UTM 32N) en GeoJSON WGS84 longitude/latitude.
// Fonction pure et deterministe : memes octets en entree -> meme GeoJSON en sortie.
import { readDbf, readPolygonShp } from './istat-shapefile.mjs';
import { fromUtm32 } from './utm32.mjs';
import { StructuralError } from './mimit-parser.mjs';

export const EXPECTED_PRJ = 'PROJCS["WGS_1984_UTM_Zone_32N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",9.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
export const COORD_DECIMALS = 6;   // environ 0,1 m

function signedArea(ring) {   // > 0 : sens anti-horaire
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}
function inRing(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const round = v => Math.round(v * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS;
function toLonLat(ring) {
  const out = ring.map(([E, N]) => { const [lon, lat] = fromUtm32(E, N); return [round(lon), round(lat)]; });
  const [f, l] = [out[0], out[out.length - 1]];
  if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);   // anneau ferme
  return out;
}

/**
 * @returns { geojson, stats } ; geojson : FeatureCollection triee par sigle, une Feature MultiPolygon par unite.
 * Orientation RFC 7946 : contour exterieur anti-horaire, trous horaires.
 */
export function convertProvinces({ shp, dbf, prj }) {
  if (String(prj).trim() !== EXPECTED_PRJ) throw new StructuralError('projection_inattendue', String(prj).slice(0, 80));
  const records = readDbf(dbf), shapes = readPolygonShp(shp);
  if (records.length !== shapes.length) throw new StructuralError('dbf_shp_desaccord', `${records.length} / ${shapes.length}`);
  const stats = { unites: records.length, anneaux: 0, trous: 0, sommets: 0 };
  const features = [];
  const seen = new Set();
  records.forEach((r, i) => {
    const sigla = r.SIGLA;
    if (!/^[A-Z]{2}$/.test(sigla) || seen.has(sigla)) throw new StructuralError('sigle_invalide_ou_duplique', sigla);
    seen.add(sigla);
    const outers = [], holes = [];
    for (const ring of shapes[i].rings) {
      stats.anneaux++; stats.sommets += ring.length;
      (signedArea(ring) < 0 ? outers : holes).push(ring);   // shapefile : exterieur horaire, trou anti-horaire
    }
    if (!outers.length) throw new StructuralError('unite_sans_contour', sigla);
    const polys = outers.map(o => [o]);
    for (const h of holes) {
      stats.trous++;
      const k = outers.findIndex(o => inRing(o, h[0][0], h[0][1]));
      if (k < 0) throw new StructuralError('trou_sans_contour', sigla);
      polys[k].push(h);
    }
    const coordinates = polys.map(([outer, ...hs]) => [toLonLat(outer).reverse(), ...hs.map(h => toLonLat(h).reverse())]);
    features.push({
      type: 'Feature',
      properties: { sigla, cod_uts: +r.COD_UTS, cod_reg: +r.COD_REG, cod_prov: +r.COD_PROV, cod_cm: +r.COD_CM, den_uts: r.DEN_UTS, tipo_uts: r.TIPO_UTS },
      geometry: { type: 'MultiPolygon', coordinates },
    });
  });
  features.sort((a, b) => (a.properties.sigla < b.properties.sigla ? -1 : 1));
  return { geojson: { type: 'FeatureCollection', features }, stats };
}
