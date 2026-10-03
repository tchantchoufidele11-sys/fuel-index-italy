// Lecteurs minimaux shapefile (type 5, polygone) et DBF -- fonctions pures sur des octets.
// Format verifie sur les limites ISTAT au 01/01/2026 (version generalisee) : DBF encode en UTF-8
// alors que l'octet de page de code vaut 0 ; l'UTF-8 est donc IMPOSE (decodage strict).
import { StructuralError } from './mimit-parser.mjs';

const view = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

/** DBF -> tableau d'objets { CHAMP: texte }. */
export function readDbf(u8) {
  const dv = view(u8);
  const count = dv.getUint32(4, true), headerLen = dv.getUint16(8, true), recLen = dv.getUint16(10, true);
  const fields = [];
  for (let i = 32; u8[i] !== 0x0d; i += 32) {
    if (i + 32 > headerLen) throw new StructuralError('dbf_entete_invalide');
    let name = '';
    for (let k = 0; k < 11 && u8[i + k] !== 0; k++) name += String.fromCharCode(u8[i + k]);
    fields.push({ name, len: u8[i + 16] });
  }
  const dec = new TextDecoder('utf-8', { fatal: true });
  const out = [];
  for (let r = 0; r < count; r++) {
    let pos = headerLen + r * recLen + 1;
    const rec = {};
    for (const fl of fields) {
      try { rec[fl.name] = dec.decode(u8.subarray(pos, pos + fl.len)).trim(); }
      catch { throw new StructuralError('dbf_non_utf8', `${fl.name}, enregistrement ${r}`); }
      pos += fl.len;
    }
    out.push(rec);
  }
  return out;
}

/** Shapefile de polygones -> tableau de { rings: [[[x, y], ...], ...] } (un par enregistrement, dans l'ordre). */
export function readPolygonShp(u8) {
  const dv = view(u8);
  if (dv.getInt32(0, false) !== 9994) throw new StructuralError('shp_signature_invalide');
  if (dv.getInt32(32, true) !== 5) throw new StructuralError('shp_type_non_polygone');
  const fileLen = dv.getInt32(24, false) * 2;
  const out = [];
  let pos = 100;
  while (pos < fileLen) {
    const contentLen = dv.getInt32(pos + 4, false) * 2;
    const c = pos + 8;
    const type = dv.getInt32(c, true);
    if (type === 0) { out.push({ rings: [] }); pos = c + contentLen; continue; }
    if (type !== 5) throw new StructuralError('shp_enregistrement_non_polygone', String(type));
    const numParts = dv.getInt32(c + 36, true), numPoints = dv.getInt32(c + 40, true);
    const parts = [];
    for (let k = 0; k < numParts; k++) parts.push(dv.getInt32(c + 44 + 4 * k, true));
    parts.push(numPoints);
    const pts = c + 44 + 4 * numParts;
    const rings = [];
    for (let k = 0; k < numParts; k++) {
      const ring = [];
      for (let q = parts[k]; q < parts[k + 1]; q++) ring.push([dv.getFloat64(pts + 16 * q, true), dv.getFloat64(pts + 16 * q + 8, true)]);
      rings.push(ring);
    }
    out.push({ rings });
    pos = c + contentLen;
  }
  return out;
}
