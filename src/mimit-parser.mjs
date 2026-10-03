// Lecture des deux CSV MIMIT -- fonctions pures, aucune entree/sortie.
// Format verifie sur l'extraction reelle du 2026-10-01 : UTF-8, separateur "|", point decimal,
// ligne 1 "Estrazione del AAAA-MM-JJ", ligne 2 en-tetes (compares mot pour mot).
export const PRICES_HEADER = 'idImpianto|descCarburante|prezzo|isSelf|dtComu';
export const STATIONS_HEADER = 'idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine';

/** Anomalie structurelle : arrete le job, rien n'est publie. */
export class StructuralError extends Error {
  constructor(code, detail) {
    super(code + (detail ? ' : ' + detail : ''));
    this.name = 'StructuralError';
    this.code = code;
    this.detail = detail;
  }
}

function splitLines(text) {
  if (typeof text !== 'string') throw new StructuralError('texte_attendu');
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return t.split(/\r?\n/);
}

export function parseExtractionLine(line) {
  const m = /^Estrazione del (\d{4})-(\d{2})-(\d{2})$/.exec(String(line ?? '').trim());
  if (!m) throw new StructuralError('ligne_extraction_invalide', String(line ?? '').slice(0, 60));
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new StructuralError('date_extraction_invalide', String(line));
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** "JJ/MM/AAAA hh:mm:ss" -> composants de l'heure murale. Aucune interpretation de fuseau ici. */
export function parseDtComu(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const c = { y: +m[3], mo: +m[2], d: +m[1], h: +m[4], mi: +m[5], s: +m[6] };
  const dt = new Date(Date.UTC(c.y, c.mo - 1, c.d));
  if (dt.getUTCFullYear() !== c.y || dt.getUTCMonth() !== c.mo - 1 || dt.getUTCDate() !== c.d) return null;
  if (c.h > 23 || c.mi > 59 || c.s > 59) return null;
  return c;
}

/** Composants -> "AAAA-MM-JJThh:mm:ss" (heure murale brute, sans decalage). */
export function formatComponents(c) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(c.y, 4)}-${p(c.mo)}-${p(c.d)}T${p(c.h)}:${p(c.mi)}:${p(c.s)}`;
}

const NUM = /^-?\d+(\.\d+)?$/;

/** Prix : exactement 5 champs ; toute ligne non conforme est rejetee et comptee. */
export function parsePricesCsv(text) {
  const lines = splitLines(text);
  const extraction = parseExtractionLine(lines[0]);
  if ((lines[1] ?? '').trim() !== PRICES_HEADER) {
    throw new StructuralError('entete_prix_inattendu', (lines[1] ?? '').slice(0, 120));
  }
  const rows = [];
  const rejected = { champs: 0, id: 0, prix: 0, isSelf: 0, dtComu: 0 };
  let lineCount = 0;
  for (let i = 2; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    lineCount++;
    const f = l.split('|');
    if (f.length !== 5) { rejected.champs++; continue; }
    const id = f[0].trim();
    if (!/^\d+$/.test(id)) { rejected.id++; continue; }
    const p = f[2].trim();
    if (!NUM.test(p)) { rejected.prix++; continue; }
    const s = f[3].trim();
    if (s !== '0' && s !== '1') { rejected.isSelf++; continue; }
    const dt = parseDtComu(f[4]);
    if (!dt) { rejected.dtComu++; continue; }
    rows.push({ id: +id, desc: f[1].trim(), price: +p, isSelf: s === '1', dtComu: dt });
  }
  return { extraction, rows, rejected, lineCount };
}

/**
 * Stations : lecture ANCREE AUX DEUX BOUTS. Des noms contiennent "|" (113 lignes dans la fixture du 2026-10-01).
 * id = 1er champ ; longitude = dernier ; latitude = avant-dernier ; province = 3e depuis la fin ; commune = 4e depuis la fin.
 * Le nom n'est repris que sur une ligne a exactement 10 champs ; sinon il reste null.
 */
export function parseStationsCsv(text) {
  const lines = splitLines(text);
  const extraction = parseExtractionLine(lines[0]);
  if ((lines[1] ?? '').trim() !== STATIONS_HEADER) {
    throw new StructuralError('entete_stations_inattendu', (lines[1] ?? '').slice(0, 160));
  }
  const stations = [];
  const rejected = { champs: 0, id: 0, coordonnees: 0 };
  let lineCount = 0, shifted = 0;
  for (let i = 2; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    lineCount++;
    const f = l.split('|');
    if (f.length < 10) { rejected.champs++; continue; }
    if (f.length > 10) shifted++;
    const id = f[0].trim();
    if (!/^\d+$/.test(id)) { rejected.id++; continue; }
    const latS = f[f.length - 2].trim(), lngS = f[f.length - 1].trim();
    if (!NUM.test(latS) || !NUM.test(lngS)) { rejected.coordonnees++; continue; }
    stations.push({
      id: +id,
      lat: +latS,
      lng: +lngS,
      comune: f[f.length - 4].trim(),
      provincia: f[f.length - 3].trim(),
      name: f.length === 10 ? (f[4].trim() || null) : null,
    });
  }
  return { extraction, stations, rejected, lineCount, shifted };
}
