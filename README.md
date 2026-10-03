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
3. **Sardaigne** (sigles `SS NU OR CA SU OT OG VS CI`) : contrôle contre l'**union** des unités sardes ISTAT.
   Compteurs `geoSardiniaCompatibilityCount` et `siglesSardesObserves` dans le rapport.

**Deux nomenclatures sardes différentes, sans correspondance 1:1** (vérifié le 2026-10-03). Dans la fixture de
référence, le MIMIT emploie encore l'organisation de 2016 — `CA`, `NU`, `OR`, `SS`, `SU` — où **`SU` = Provincia del
Sud Sardegna**, sigle fixée par le D.P.R. 140/2017. Vérification sur les données : les 153 stations `SU` couvrent le
Sulcis Iglesiente (Carbonia, Iglesias), le Medio Campidano (Villacidro, Guspini, Sanluri) et l'ex-Cagliari hors ville
métropolitaine (Muravera, Isili). Le fichier ISTAT 2026 porte la nouvelle organisation en huit unités : `SS`, `OT`,
`NU`, `OR`, `OG`, `VS`, `CA`, `CI`. **`SU` n'est donc pas un alias de Sulcis Iglesiente** : aucune correspondance 1:1
n'est cherchée, et l'union géométrique est le seul traitement correct. `CI`, `OG`, `OT` et `VS` sont acceptés par
avance ; `siglesSardesObserves` détectera le jour où le MIMIT adoptera la nouvelle organisation.

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
  `magotCompatibility` (sigles acceptés par Magot, dont `SU`). La donnée source n'est jamais réécrite.
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
| Sigles de provinces | **111 acceptés, dont 107 observés** (jamais observés : CI, OG, OT, VS) | |
| Stations valides / indexées | **23 793 / 20 461** | 23 753 / 20 432 |
| Prix retenus | SP95 **20 045** · diesel **20 049** · GPL **4 523** (dont 4 372 servis) | 20 018 / 20 022 / 4 518 |
| Zones | **655** | 653 |
| Empreinte fonctionnelle publiée | `377a6ca394af0772fefbf9dc5ee99ee56042a87dde87fab45d6378d939c623e4` (avant l'attribution définitive : `ec927f56…faf4fb`) | `4cd0b2b0…414f` |
| Stations retenues (SP95 self, 3 j au plus) | Rome 0,88 km (16807) · Milan 0,49 km (61903) · Pienza 0,35 km (7727) | identiques |
| Stromboli (37410) | indexée ; aucun prix valide à 40 km, retrouvée en secours (prix de 5 j) | rejetée |

## Décisions validées et points restant ouverts

Validés à l'audit (IT-1 puis IT-1b) :

1. **Seuil « stations »** : appliqué aux stations **valides après lecture, quarantaine et filtres géographiques**
   (référence IT-1b : 23 793), et non aux stations présentes dans les zones (20 461).
2. **Références de prix** : mesurées **après** le filtre géographique (IT-1b : 20 045 / 20 049 / 4 523). Les chiffres
   de la spécification d'origine (20 130 / 20 134 / 4 534) étaient mesurés avant filtre. Seuils : 15 000 / 15 000 / 3 500.
3. **Clé de commune** = commune + province (et non le nom seul), pour le filtre des points partagés.
4. **Heure d'été** (`Europe/Rome`, hypothèse non confirmée) : heure répétée → première occurrence ;
   heure inexistante → décalée vers l'avant.
5. **Test runner** : sous Node 22, `node --test test/` ne parcourt pas le dossier ; le motif `"test/*.test.mjs"` est
   utilisé dans `package.json` et dans le workflow.

Restant ouverts (bloquants pour la mise en service, pas pour le code) :

- **Sigles de provinces** : **111 acceptés, dont 107 observés** sur la fixture de référence, recoupés le 2026-10-03
  avec le fichier ISTAT 2026 versionné : les 107 sigles observés sont tous couverts, aucune station en quarantaine, et
  les 110 unités ISTAT figurent toutes dans la liste acceptée. Province inconnue → quarantaine (échec fermé).
- **Texte d'attribution MIMIT** : figé le 2026-10-03 (`src/manifest.mjs`), d'après la page officielle du jeu de
  données (licence IODL 2.0, publié par le Ministero delle Imprese e del Made in Italy) :
  « Fonte: Ministero delle Imprese e del Made in Italy — Osservaprezzi carburanti · Licenza IODL 2.0 ·
  http://www.dati.gov.it/iodl/2.0/ ». La IODL 2.0 exige la source, le nom du fournisseur et, si possible, le lien
  vers la licence.
- **Fuseau de `dtComu`** : convention `Europe/Rome`, `tzConfirmed: false`. Les métadonnées officielles ne documentent
  pas le fuseau. Preuve opérationnelle (2026-10-03) : sur la fixture, les communications du jour d'extraction s'arrêtent
  à 08:04:33, en cohérence avec la référence « alle ore 8 » du MIMIT et difficilement compatible avec une lecture UTC
  le 1er octobre. Inférence, pas confirmation : `tzConfirmed` ne passera à `true` que sur réponse officielle du MIMIT,
  après audit.

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

## Historique IT-1 : règle « plus de 25 km de la médiane de la commune » (remplacée par IT-1b)

Règle d'IT-1, conservée ici à titre historique uniquement (elle n'existe plus dans le code). Faux rejet connu et mesuré : 37410
(Stromboli, commune de Lipari ; la station SP95 exploitable suivante est à 41,67 km, hors du rayon de 40 km). Angle mort
connu : communes de moins de 3 stations non contrôlées (ex. Monghidoro, BO, à 309 km). Traité dans IT-1b (polygone
provincial ISTAT 2026, tolérance 5 km).

## Mise en service (hors IT-1)

Créer le dépôt, activer GitHub Pages sur la branche `gh-pages`, puis lancer le workflow
`.github/workflows/italy-fuel-index.yml` à la main une première fois.
