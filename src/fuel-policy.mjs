// Politique carburants du fournisseur Italie -- configuration declarative, jamais codee dans un moteur generique.
// Decision du 02/10/2026 : SP95 et diesel en self uniquement ; GPL self prioritaire, sinon servi (normalement servi en Italie).
export const FUEL_MAP = Object.freeze({ Benzina: 'sp95', Gasolio: 'diesel', GPL: 'gpl' });   // libelles MIMIT EXACTS
export const SERVICE_POLICY = Object.freeze({
  sp95: 'SELF_ONLY',
  diesel: 'SELF_ONLY',
  gpl: 'SELF_PREFERRED_SERVED_ALLOWED',
});
export const PRICE_MIN = 0.40;   // EUR/L -- meme plage que la validation de l'app
export const PRICE_MAX = 4.00;

/** Libelle MIMIT -> carburant Magot ; tout autre libelle (marques, "speciale", Metano...) -> null. */
export function magotFuel(desc) {
  return Object.prototype.hasOwnProperty.call(FUEL_MAP, desc) ? FUEL_MAP[desc] : null;
}

export function priceInRange(p) {
  return Number.isFinite(p) && p >= PRICE_MIN && p <= PRICE_MAX;
}

/** Le mode est-il admissible pour ce carburant ? (sert aussi a la validation d'un record) */
export function modeAllowed(fuel, mode) {
  const pol = SERVICE_POLICY[fuel];
  if (pol === 'SELF_ONLY') return mode === 'SELF';
  if (pol === 'SELF_PREFERRED_SERVED_ALLOWED') return mode === 'SELF' || mode === 'SERVED';
  return false;
}

/**
 * Selection par station et carburant. byMode = { SELF?: rec, SERVED?: rec }, deja dedoublonnes et frais.
 * Retourne le record retenu avec son mode, ou null.
 */
export function selectByPolicy(fuel, byMode) {
  const pol = SERVICE_POLICY[fuel];
  if (pol === 'SELF_ONLY') return byMode.SELF ? { ...byMode.SELF, mode: 'SELF' } : null;
  if (pol === 'SELF_PREFERRED_SERVED_ALLOWED') {
    if (byMode.SELF) return { ...byMode.SELF, mode: 'SELF' };
    if (byMode.SERVED) return { ...byMode.SERVED, mode: 'SERVED' };
    return null;
  }
  return null;
}
