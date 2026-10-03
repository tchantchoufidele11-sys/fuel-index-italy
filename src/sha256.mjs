// Empreinte SHA-256 (hexadecimal) d'un contenu binaire ou texte.
import { createHash } from 'node:crypto';

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}
