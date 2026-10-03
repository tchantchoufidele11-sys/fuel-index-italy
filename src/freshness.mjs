// Temps et fraicheur -- fonctions pures.
// Regle : une heure murale MIMIT (sans fuseau) est convertie EXPLICITEMENT en instant UTC selon un fuseau IANA,
// heure d'ete comprise. Jamais de new Date("AAAA-MM-JJThh:mm:ss") ni de Date.parse sur une date sans fuseau :
// le resultat ne depend jamais du fuseau de la machine qui execute le code.
export const SOURCE_TZ = 'Europe/Rome';   // hypothese operationnelle, NON confirmee par le MIMIT -> tzConfirmed: false
export const TZ_CONFIRMED = false;
export const VALID_DAYS = 3;
export const FALLBACK_DAYS = 8;
export const FUTURE_TOLERANCE_MIN = 15;
export const SNAPSHOT_HOUR = 8;
const DAY_MS = 86400000;

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Decalage (ms) du fuseau a un instant donne : heure murale - UTC. */
export function tzOffsetMs(utcMs, tz) {
  const parts = {};
  for (const x of formatterFor(tz).formatToParts(new Date(utcMs))) if (x.type !== 'literal') parts[x.type] = +x.value;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - utcMs;
}

/**
 * Heure murale (composants) -> instant UTC dans le fuseau tz.
 * Heure repetee (fin de l'heure d'ete) : la PREMIERE occurrence est retenue.
 * Heure inexistante (debut de l'heure d'ete) : decalee vers l'avant de la duree du saut.
 */
export function wallToUtcMs(c, tz = SOURCE_TZ) {
  const wall = Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s);
  const offsets = [...new Set([tzOffsetMs(wall - DAY_MS, tz), tzOffsetMs(wall, tz), tzOffsetMs(wall + DAY_MS, tz)])];
  const hits = offsets.map(o => wall - o).filter(u => u + tzOffsetMs(u, tz) === wall).sort((a, b) => a - b);
  if (hits.length) return hits[0];
  return wall - Math.min(...offsets);
}

/** Instant du releve : 8 h 00 du jour d'extraction, heure de Rome. */
export function snapshotUtcMs(extraction, tz = SOURCE_TZ) {
  const [y, mo, d] = extraction.split('-').map(Number);
  return wallToUtcMs({ y, mo, d, h: SNAPSHOT_HOUR, mi: 0, s: 0 }, tz);
}

export function ageDays(reportedUtcMs, nowUtcMs) {
  return (nowUtcMs - reportedUtcMs) / DAY_MS;
}

/** VALID (0 a 3 j), FALLBACK (plus de 3 et jusqu'a 8 j), EXPIRED (au-dela, ou age negatif). */
export function freshnessClass(age) {
  if (!(age >= 0) || age > FALLBACK_DAYS) return 'EXPIRED';
  return age <= VALID_DAYS ? 'VALID' : 'FALLBACK';
}

/** dtComu posterieur a 8 h 15 le jour d'extraction : rejete. */
export function isFutureVsSnapshot(reportedUtcMs, snapshotMs) {
  return reportedUtcMs > snapshotMs + FUTURE_TOLERANCE_MIN * 60000;
}
