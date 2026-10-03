# fuel-index-italy — IT-1 + IT-1b, constructeur de l'index carburant Italie

Construit chaque jour l'index des prix carburant **par station** à partir des deux CSV officiels du MIMIT
(Osservaprezzi carburanti), et le publie en fichiers statiques (zones de 0,25°, manifeste).
Spécification : « Spécification gelée — F2 Italie (P1 station MIMIT, option B) ».

- Node.js 22, modules ESM, **aucune dépendance** (pas de `node_modules`).
- Cœur en fonctions pures (`src/`, sans fichiers ni réseau) ; entrées/sorties dans `scripts/fetch-and-build.mjs`.
- Aucune API Cloudflare, aucune modification de Magot.

## Commandes

```
node --test "test/*.test.mjs"                     # 76 tests, sans réseau, sur la fixture réelle du 2026-10-01
node scripts/fetch-and-build.mjs --out site --reports reports                              # téléchargement MIMIT
node scripts/fetch-and-build.mjs --out site --reports reports \
     --prices test/fixtures/prezzo_alle_8_2026-10-01.csv \
     --stations test/fixtures/anagrafica_impianti_attivi_2026-10-01.csv                    # fichiers locaux
```

## Contrôle géographique (IT-1b, règle gelée)

1. Point partagé (4 décimales) par des stations de **communes différentes** (clé commune + province) → rejet.
2. Sinon, station à **plus de 5 km à l'extérieur du polygone de sa province** ISTAT 2026 → rejet.
3. **Sardaigne** (sigles `SS NU OR CA SU OT OG VS CI`) : contrôle contre l'**union** des unités sardes ISTAT
   (compatibilité transitoire : le MIMIT n'a pas repris la réforme). Compteurs `geoSardiniaCompatibilityCount` et
   `siglesSardesObserves` dans le rapport. À supprimer quand le MIMIT documentera son alignement.

Remplace la règle IT-1 de la médiane de commune (25 km), qui rejetait des îles (Stromboli) et ne contrôlait pas les
communes de moins de 3 stations (Monghidoro, à 269 km de sa province, passait).

### Mesure des 5 km : métrique, jamais en degrés

- Exécution : distance en **kilomètres** au contour, dans un repère local centré sur la station
  (longitude × 111,195 × cos(latitude), latitude × 111,195). Aucun tampon en degrés, aucune distance latitude/longitude brute.
- Contre-vérification permanente (`test/metric-distance.test.mjs`) : distance recalculée **en mètres dans le plan UTM 32N
  sur les polygones du shapefile source**, corrigée du facteur d'échelle UTM local. Sur les 23 927 stations de la fixture :
  **même verdict dedans/dehors et même verdict à 5 km pour toutes** (66 rejets) ; écart maximal **11 m** entre 2 et 10 km
  (zone décisive). L'approximation locale se dégrade au-delà de 200 km (jusqu'à 25 km d'écart), sans effet : ces
  stations sont rejetées de toute façon.

## Limites provinciales versionnées (`vendor/istat/2026/`)

- `source/` : fichiers provinciaux ISTAT exacts (`ProvCM01012026_g_WGS84.*`, version généralisée, UTM 32N).
- `provinces.geojson` : dérivé normalisé en WGS 84 longitude/latitude (seul fichier lu par le job quotidien).
- `SOURCE.json` : URL, date de référence 01/01/2026, SHA-256 de l'archive et de chaque fichier, SHA-256 du GeoJSON,
  licence **CC BY 4.0**, projection source, méthode et date de conversion, mention « dérivé ». Deux notions distinctes :
  `istatSnapshotSigle` (sigles réellement présents dans le fichier : `CI` pour Sulcis Iglesiente, pas de `SU`) et
  `magotCompatibility` (alias acceptés par Magot, dont `SU` annoncé par SITUAS/Istat le 18/06/2026). La donnée source
  n'est jamais réécrite.
- Le job vérifie l'empreinte du GeoJSON contre `SOURCE.json` avant usage (sinon code 2).
- Attribution : « Confini amministrativi 2026 — Istat, CC BY 4.0. Données converties et normalisées pour Magot. »
- Mise à jour annuelle, acte volontaire : nouvelle source → audit → `node scripts/convert-istat-provinces.mjs
  --dir vendor/istat/<année> --converted-at <ISO>` → nouvelles empreintes et références → GO.

## Codes de sortie (rien n'est publié sauf code 0 avec statut OK)

| Code | Signification |
| --- | --- |
| 0 | `OK` (index publié) ou `NO_CHANGE` (extraction déjà publiée ou plus ancienne : rien n'est modifié) |
| 1 | erreur inattendue ou réseau |
| 2 | anomalie structurelle (en-têtes, ligne d'extraction, dates d'extraction différentes, encodage non UTF-8, limites ISTAT illisibles ou d'empreinte invalide) |
| 3 | garde-fous de publication non satisfaits (l'index précédent reste en ligne) |
| 4 | manifeste publié illisible ou invalide (schéma, pays, date civile, répertoire, taille de zone, liste des zones, compteurs entiers) : intervention manuelle, jamais de garde-fou partiel |

## Sortie publiée

```
it/v1/manifest.json                 # écrit en DERNIER (bascule atomique)
it/v1/<extraction>/z_<iLat>_<iLon>.json
```

Entrée carburant : `[prix, "AAAA-MM-JJThh:mm:ss", "SELF" | "SERVED"]` (heure murale brute de `dtComu`).
Les 3 dernières extractions sont conservées.

## Résultats sur la fixture réelle du 2026-10-01 (références IT-1b)

| Mesure | Valeur IT-1b | Historique IT-1 |
| --- | --- | --- |
| SHA-256 prix | `d274db0cea67267ddd770c834d7aa47bc35af106591235de9cf1144273e55b72` | |
| SHA-256 stations | `a33db58b57b7c634cdbbddba2abdd3116d4006aa23188ee3ab80e55816d1f26c` | |
| SHA-256 GeoJSON des limites | `bc4e63342540eae93dd7b622759dc45fd7dd0d0fda85513ca705abd074e0d8bd` | |
| Rejets géographiques | **134** (84 points partagés, 66 hors province, dont 16 en commun) | 174 |
| Sardaigne en compatibilité | 674 stations (CA 147, NU 95, OR 74, SS 205, SU 153) | |
| Stations valides / indexées | **23 793 / 20 461** | 23 753 / 20 432 |
| Prix retenus | SP95 **20 045** · diesel **20 049** · GPL **4 523** (dont 4 372 servis) | 20 018 / 20 022 / 4 518 |
| Zones | **655** | 653 |
| Empreinte fonctionnelle publiée | `ec927f56a870c54cb9dabee2a1eabd00143e855f76bb613fca15d24e92faf4fb` | `4cd0b2b0…414f` |
| Stations retenues (SP95 self, 3 j au plus) | Rome 0,88 km (16807) · Milan 0,49 km (61903) · Pienza 0,35 km (7727) | identiques |
| Stromboli (37410) | indexée ; aucun prix valide à 40 km, retrouvée en secours (prix de 5 j) | rejetée |

## Points à valider à l'audit

1. **Seuil « stations »** : appliqué aux stations **valides après contrôle géographique** (23 753), valeur donnée par la
   spécification. L'index n'en contient que 20 432 (celles ayant au moins un prix retenu) : un seuil de 20 000 sur ce
   nombre ne laisserait que 2 % de marge.
2. **Chiffres de prix de la spécification** (20 130 / 20 134 / 4 534) : mesurés **avant** le filtre géographique.
   Après filtre : 20 018 / 20 022 / 4 518. Les seuils (15 000 / 15 000 / 3 500) restent valables.
3. **Clé de commune** = commune + province (et non le nom seul). Sans effet sur la fixture (aucun homonyme),
   mais évite de fusionner deux communes homonymes de provinces différentes.
4. **Liste des 107 sigles** : identique à celle observée dans la fixture ; non recoupée avec une liste officielle
   ISTAT. Une province inconnue met la station en quarantaine (échec fermé).
5. **Texte d'attribution** : provisoire (`src/manifest.mjs`), point ouvert de la spécification.
6. **Heure d'été** (`Europe/Rome`, hypothèse non confirmée) : heure répétée → première occurrence ;
   heure inexistante → décalée vers l'avant.
7. **Défaut corrigé avant livraison** : sous Node 22, `node --test test/` ne parcourt pas le dossier ; le motif
   `"test/*.test.mjs"` est utilisé dans `package.json` et dans le workflow.

## Correctifs après audit (IT-1 v2)

- **Manifeste précédent** : validation stricte dans le cœur (`assertValidPreviousManifest`) et dans la couche E/S ;
  tout écart → `ManifestError`, code 4, rien n'est publié. Avant : `{"extraction":"2026-09-30"}` publiait sans
  contrôle de chute, et `"2026-99-99"` renvoyait `NO_CHANGE` indéfiniment.
- **Empreinte** : les tests construisent la fixture avec les vrais `inputs` ; la référence est celle de la sortie
  écrite sur disque par le script (test dédié).

## Correctif après audit (IT-1 v3)

- **Manifeste précédent publiable** : en plus de sa structure, il doit satisfaire les garde-fous absolus qui ont permis
  sa publication (≥ 20 000 stations valides, SP95 et diesel ≥ 15 000, GPL ≥ 3 500, conflits ≤ 1 %) et les cohérences
  vraies par construction (indexées ≤ valides, prix ≤ stations indexées, SELF + SERVED = prix retenus, servi ≤ GPL,
  1 ≤ zones ≤ stations indexées, conflits et prix ≤ clés). Sinon code 4. Avant : un manifeste à zéro neutralisait
  silencieusement le contrôle de chute.

## Ancienne règle « plus de 25 km de la médiane de la commune » (IT-1, remplacée par IT-1b)

Implémentée telle que gelée et conservée comme référence déterministe d'IT-1. Faux rejet connu et mesuré : 37410
(Stromboli, commune de Lipari ; la station SP95 exploitable suivante est à 41,67 km, hors du rayon de 40 km). Angle mort
connu : communes de moins de 3 stations non contrôlées (ex. Monghidoro, BO, à 309 km). Traité dans IT-1b (limites
administratives officielles, commune et province comparées), avant IT-2.

## Mise en service (hors IT-1)

Créer le dépôt, activer GitHub Pages sur la branche `gh-pages`, puis lancer le workflow
`.github/workflows/italy-fuel-index.yml` à la main une première fois.
