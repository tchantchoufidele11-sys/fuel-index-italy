#!/usr/bin/env node
// Conversion VOLONTAIRE (annuelle) des limites provinciales ISTAT vers vendor/istat/<annee>/provinces.geojson.
// Le job quotidien ne lit que le GeoJSON produit (aucune lecture de shapefile, aucune reprojection a l'execution).
// Usage : node scripts/convert-istat-provinces.mjs --dir vendor/istat/2026 --converted-at <ISO>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { convertProvinces } from '../src/istat-provinces.mjs';
import { sha256Hex } from '../src/sha256.mjs';
import { SARDINIA_SIGLE, SARDINIA_REGION_CODE } from '../src/province-boundaries.mjs';

export const SOURCE_2026 = Object.freeze({
  dataset: 'Istat — Confini delle unità amministrative a fini statistici (versione generalizzata)',
  referenceDate: '2026-01-01',
  archiveUrl: 'https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip',
  archiveSha256: 'b011a590656c3a3ebc297fba80726a376aa843b6f164641cf6a4a990021a81d6',
  archiveBytes: 10450609,
  layer: 'ProvCM01012026_g/ProvCM01012026_g_WGS84 (province e città metropolitane)',
  sourceProjection: 'WGS 84 / UTM zone 32N (EPSG:32632)',
  license: 'CC BY 4.0',
  attribution: 'Confini amministrativi 2026 — Istat, CC BY 4.0. Données converties et normalisées pour Magot.',
});
const BASE = 'ProvCM01012026_g_WGS84';

export async function convert(dir, convertedAt) {
  const src = path.join(dir, 'source');
  const files = {};
  for (const ext of ['shp', 'dbf', 'prj', 'shx']) files[ext] = new Uint8Array(await readFile(path.join(src, `${BASE}.${ext}`)));
  const { geojson, stats } = convertProvinces({ shp: files.shp, dbf: files.dbf, prj: new TextDecoder().decode(files.prj) });
  const text = JSON.stringify(geojson);
  await writeFile(path.join(dir, 'provinces.geojson'), text);
  const source = {
    ...SOURCE_2026,
    sourceFiles: Object.fromEntries(Object.entries(files).map(([ext, u8]) => [`${BASE}.${ext}`, sha256Hex(u8)])),
    // Deux notions DISTINCTES : ce que contient reellement le fichier ISTAT, et ce que Magot accepte en compatibilite.
    istatSnapshotSigle: {
      all: geojson.features.map(f => f.properties.sigla),
      sardinia: geojson.features.filter(f => f.properties.cod_reg === SARDINIA_REGION_CODE).map(f => f.properties.sigla),
    },
    magotCompatibility: {
      sardiniaAcceptedSigle: [...SARDINIA_SIGLE].sort(),
      rule: 'Station de sigle sarde (ancien ou nouveau) controlee contre l union des unites sardes ISTAT',
      note: 'Sulcis Iglesiente porte le sigle CI dans le fichier ISTAT au 01/01/2026 et SU selon SITUAS/Istat (18/06/2026). '
        + 'La donnee source n est pas reecrite : SU est un alias de compatibilite accepte par Magot.',
    },
    derived: true,
    derivation: 'Shapefile UTM 32N reprojeté en WGS 84 longitude/latitude (Transverse Mercator, séries de Krüger), '
      + 'coordonnées arrondies à 6 décimales, anneaux classés par orientation (trous rattachés à leur contour), '
      + 'orientation RFC 7946, unités triées par sigle.',
    output: { file: 'provinces.geojson', format: 'GeoJSON (RFC 7946), WGS 84 longitude/latitude', sha256: sha256Hex(text), bytes: Buffer.byteLength(text), ...stats },
    convertedAt,
  };
  await writeFile(path.join(dir, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
  return source;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (i % 2 ? acc : acc.concat([[v.replace(/^--/, ''), arr[i + 1]]])), []));
  if (!a.dir || !a['converted-at']) { console.error('Usage : --dir <dossier> --converted-at <ISO>'); process.exit(1); }
  convert(a.dir, a['converted-at']).then(s => console.log(JSON.stringify(s.output))).catch(e => { console.error('ECHEC : ' + e.message); process.exit(2); });
}
