#!/usr/bin/env node
// Couche entrees/sorties du constructeur d'index Italie (le coeur, src/build-index.mjs, reste pur).
//
// Usage : node scripts/fetch-and-build.mjs --out <dossier publie> --reports <dossier rapports>
//                                           [--prices <fichier|url>] [--stations <fichier|url>] [--generated-at <ISO>]
//                                           [--boundaries <dossier vendor/istat/AAAA>]
// Codes de sortie (aucune publication sauf 0 avec statut OK) :
//   0  OK (index publie) ou NO_CHANGE (extraction deja publiee ou plus ancienne : rien n'est modifie)
//   1  erreur inattendue ou reseau
//   2  anomalie structurelle des CSV (en-tetes, dates d'extraction, encodage...)
//   3  garde-fous de publication non satisfaits
//   4  manifeste publie illisible (intervention manuelle requise ; on ne publie pas a l'aveugle)
import { readFile, writeFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { buildIndex } from '../src/build-index.mjs';
import { StructuralError } from '../src/mimit-parser.mjs';
import { sha256Hex } from '../src/sha256.mjs';
import { tileFileName } from '../src/tiles.mjs';
import { ManifestError, assertValidPreviousManifest } from '../src/manifest.mjs';
import { indexBoundaries } from '../src/province-boundaries.mjs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BOUNDARIES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'istat', '2026');

/** Charge le GeoJSON versionne et verifie son empreinte contre SOURCE.json AVANT tout usage (echec ferme). */
export async function loadBoundaries(dir = DEFAULT_BOUNDARIES_DIR) {
  let source, bytes;
  try { source = JSON.parse(await readFile(path.join(dir, 'SOURCE.json'), 'utf8')); bytes = await readFile(path.join(dir, 'provinces.geojson')); }
  catch (e) { throw new StructuralError('limites_illisibles', e.message); }
  const sha = sha256Hex(bytes);
  if (!source.output || sha !== source.output.sha256) throw new StructuralError('limites_empreinte_invalide', sha);
  const index = indexBoundaries(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  return { index, meta: { dataset: source.dataset, referenceDate: source.referenceDate, geojsonSha256: sha, license: source.license, attribution: source.attribution } };
}

export const DEFAULT_PRICES_URL = 'https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv';
export const DEFAULT_STATIONS_URL = 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv';
export const INDEX_ROOT = path.join('it', 'v1');
export const KEEP_EXTRACTIONS = 3;
const FETCH_TIMEOUT_MS = 120000;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error('argument inattendu : ' + argv[i]);
    a[argv[i].slice(2)] = argv[i + 1];
  }
  if (!a.out || !a.reports) throw new Error('--out et --reports sont obligatoires');
  return a;
}

async function loadBytes(src) {
  if (/^https?:\/\//.test(src)) {
    const r = await fetch(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'MagotVoyage-fuel-index/1.0' } });
    if (r.status !== 200) throw new Error(`telechargement ${src} : HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  return new Uint8Array(await readFile(src));
}

function decodeUtf8Strict(bytes, label) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new StructuralError('encodage_non_utf8', label); }
}

async function readPreviousManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  let m;
  try { m = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (e) { throw new ManifestError(['json_illisible']); }
  return assertValidPreviousManifest(m);   // schema, pays, date civile, repertoire, zones, compteurs : sinon code 4
}

async function writeAtomic(file, content) {
  const tmp = file + '.tmp';
  await writeFile(tmp, content);
  await rename(tmp, file);
}

async function pruneOldExtractions(indexDir, keep) {
  const entries = (await readdir(indexDir, { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name).sort();
  const removed = entries.slice(0, Math.max(0, entries.length - keep));
  for (const name of removed) await rm(path.join(indexDir, name), { recursive: true, force: true });
  return removed;
}

export async function run(argv) {
  const args = parseArgs(argv);
  const indexDir = path.join(args.out, INDEX_ROOT);
  const manifestPath = path.join(indexDir, 'manifest.json');
  await mkdir(args.reports, { recursive: true });

  const previousManifest = await readPreviousManifest(manifestPath);
  const limits = await loadBoundaries(args.boundaries || DEFAULT_BOUNDARIES_DIR);
  const pricesBytes = await loadBytes(args.prices || DEFAULT_PRICES_URL);
  const stationsBytes = await loadBytes(args.stations || DEFAULT_STATIONS_URL);
  const inputs = {
    prices: { sha256: sha256Hex(pricesBytes), bytes: pricesBytes.length },
    stations: { sha256: sha256Hex(stationsBytes), bytes: stationsBytes.length },
  };
  const result = buildIndex({
    pricesText: decodeUtf8Strict(pricesBytes, 'prix'),
    stationsText: decodeUtf8Strict(stationsBytes, 'stations'),
    generatedAt: args['generated-at'] || new Date().toISOString(),
    previousManifest,
    inputs,
    boundaries: limits.index,
    boundariesMeta: limits.meta,
  });
  const reportFile = path.join(args.reports, `rapport-${result.extraction}-${result.status}.json`);
  await writeFile(reportFile, JSON.stringify(result.report, null, 2));

  if (result.status === 'NO_CHANGE') return { code: 0, status: 'NO_CHANGE', extraction: result.extraction, reportFile };
  if (result.status === 'GUARD_FAIL') return { code: 3, status: 'GUARD_FAIL', extraction: result.extraction, reportFile, failures: result.report.guards.failures };

  // Publication atomique : zones dans un repertoire neuf, manifeste en DERNIER (bascule), puis menage.
  const dir = path.join(indexDir, result.extraction);
  await rm(dir, { recursive: true, force: true });   // residu eventuel d'un essai interrompu (jamais reference : extraction plus recente que le manifeste)
  await mkdir(dir, { recursive: true });
  for (const [key, json] of result.tiles) await writeFile(path.join(dir, tileFileName(key)), json);
  await writeAtomic(manifestPath, JSON.stringify(result.manifest, null, 2));
  const removed = await pruneOldExtractions(indexDir, KEEP_EXTRACTIONS);
  return { code: 0, status: 'OK', extraction: result.extraction, reportFile, tiles: result.tiles.size, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then(r => {
    console.log(JSON.stringify(r));
    process.exit(r.code);
  }).catch(e => {
    const code = e instanceof StructuralError ? 2 : (e.exitCode || 1);
    console.error(`ECHEC (code ${code}) : ${e.message}`);
    process.exit(code);
  });
}
