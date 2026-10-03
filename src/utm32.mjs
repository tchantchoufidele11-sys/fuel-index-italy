// Projection Transverse Mercator UTM zone 32N (WGS84), series de Kruger a 3 termes (precision millimetrique).
// Utilisee UNIQUEMENT pour convertir les limites ISTAT (publiees en UTM 32N) vers longitude/latitude ;
// le job quotidien ne reprojette rien.
const a = 6378137.0, f = 1 / 298.257223563, k0 = 0.9996, FE = 500000.0, lon0 = 9 * Math.PI / 180;
const n = f / (2 - f);
const A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64);
const alpha = [n / 2 - 2 / 3 * n * n + 5 / 16 * n ** 3, 13 / 48 * n * n - 3 / 5 * n ** 3, 61 / 240 * n ** 3];
const beta = [n / 2 - 2 / 3 * n * n + 37 / 96 * n ** 3, 1 / 48 * n * n + 1 / 15 * n ** 3, 17 / 480 * n ** 3];
const delta = [2 * n - 2 / 3 * n * n - 2 * n ** 3, 7 / 3 * n * n - 8 / 5 * n ** 3, 56 / 15 * n ** 3];
const e = 2 * Math.sqrt(n) / (1 + n);

/** (latitude, longitude) en degres -> [E, N] en metres. */
export function toUtm32(lat, lon) {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180 - lon0;
  const t = Math.sinh(Math.atanh(Math.sin(p)) - e * Math.atanh(e * Math.sin(p)));
  const xi = Math.atan2(t, Math.cos(l)), eta = Math.atanh(Math.sin(l) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 3; j++) {
    E += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    N += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [FE + k0 * A * E, k0 * A * N];
}

/** [E, N] en metres -> [longitude, latitude] en degres. */
export function fromUtm32(E, N) {
  const xi = N / (k0 * A), eta = (E - FE) / (k0 * A);
  let xp = xi, ep = eta;
  for (let j = 1; j <= 3; j++) {
    xp -= beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    ep -= beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += delta[j - 1] * Math.sin(2 * j * chi);
  const lambda = lon0 + Math.atan2(Math.sinh(ep), Math.cos(xp));
  return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
}
