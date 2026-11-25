### 1. Règles communes à tous les fichiers CSV

* **Encodage & séparateur** : UTF-8, séparateur `,` ou `;` (le chargeur CSV peut accepter les deux, mais en fixer un à l'export évite les surprises).
* **Colonne `scenario**` : présente sur chaque ligne (ex. `actuel`, `scenario_2`, `extension_atelier`). Si vide, la valeur par défaut est `actuel`.
* **Colonne `statut**` : `existant` (par défaut) ou `projete` (pour distinguer visuellement une extension ou un ajout dans un scénario).
* **Clés d'identification (`*_id`)** : sans espaces ni accents de préférence (ex. `Z_CUISINE`, `TB_MAIN`, `DJ_04`, `PT_012`), uniques au sein d'un même `scenario`.

---

### 2. Liste exacte des colonnes CSV (4 fichiers)

#### Fichier 1 : `zones.csv` *(bâtiments, étages, pièces, volumes 3D)*

| Colonne | Type / Valeurs attendues | Obligatoire ? | Rôle |
| --- | --- | --- | --- |
| `scenario` | texte (ex. `actuel`, `extension_1`) | Non (défaut `actuel`) | Permet de faire varier le plan/les zones selon le scénario |
| `zone_id` | texte unique par scénario | **Oui** | Identifiant de la zone |
| `parent_zone_id` | texte (`zone_id`) ou vide | Non | Hiérarchie (ex. bâtiment → étage → pièce) pour isoler en 3D |
| `type_zone` | `batiment` | `etage` | `piece` | `exterieur` | Non | Catégorise le bloc et facilite les filtres |
| `nom` | texte | **Oui** | Nom affiché dans l'UI et la 3D |
| `statut` | `existant` | `projete` | Non (défaut `existant`) | Met en valeur une pièce/extension projetée |
| `x`, `y`, `z` | nombre (défaut `0`) | Non | Coordonnées du bloc 3D schématique |
| `largeur`, `profondeur`, `hauteur` | nombre positif (défauts raisonnables, ex. `4`, `4`, `2.5`) | Non | Dimensions du bloc 3D schématique |

#### Fichier 2 : `boitiers_disjoncteurs.csv` *(tableaux, hiérarchie, disjoncteurs)*

| Colonne | Type / Valeurs attendues | Obligatoire ? | Rôle |
| --- | --- | --- | --- |
| `scenario` | texte | Non (défaut `actuel`) | Scénario concerné |
| `element_type` | `boitier` | `disjoncteur` | **Oui** | Distingue un coffret/tableau d'un disjoncteur |
| `id` | texte unique par scénario | **Oui** | Identifiant du boîtier ou du disjoncteur |
| `nom` | texte | **Oui** | Libellé affiché dans la vue boîtier et les infos |
| `zone_id` | texte (`zone_id`) ou vide | Non | Où se trouve physiquement l'élément |
| `parent_id` | texte (`id`) ou vide | Non | Boîtier contenant le disjoncteur, ou élément amont alimentant un boîtier secondaire |
| `phases` | `L1` | `L2` | `L3` | `L1+L2` | `L2+L3` | `L1+L3` | `TRI` | vide | Non | Phase(s) alimentée(s) |
| `calibre_a` | nombre (ex. `10`, `16`, `20`, `32`) ou vide | Non | Calibre nominal en ampères |
| `statut` | `existant` | `projete` | Non (défaut `existant`) | Nouveau boîtier/disjoncteur dans un scénario |

#### Fichier 3 : `points_electriques.csv` *(prises, lumières, équipements, rallonges)*

| Colonne | Type / Valeurs attendues | Obligatoire ? | Rôle |
| --- | --- | --- | --- |
| `scenario` | texte | Non (défaut `actuel`) | Scénario concerné |
| `point_id` | texte unique par scénario | **Oui** | Identifiant du point électrique |
| `nom` | texte | **Oui** | Libellé court (ex. `Prise établi`) |
| `zone_id` | texte (`zone_id`) | **Oui** | Pièce/zone où se situe le point |
| `disjoncteur_id` | texte (`id` d'un disjoncteur) ou vide | Non | Circuit qui alimente ce point |
| `categorie` | `prise` | `lumiere` | `equipement_fixe` | `rallonge_multiprise` | Non | Type de point/usage |
| `type_appareil` | texte libre (ex. `eclairage`, `chargeur`, `scie`, `inconnu`) | Non | Ce que tu as déjà relevé sur le terrain |
| `phase_relevee` | `L1` | `L2` | `L3` | `INCONNU` | vide | Non | Phase relevée sur le terrain (utile pour croiser avec le disjoncteur) |
| `puissance_est_w` | nombre (watts) ou vide | Non | À remplir progressivement si tu estimes les puissances |
| `statut` | `existant` | `projete` | Non (défaut `existant`) | Point existant ou prévu dans un scénario |
| `note` | texte libre | Non | Remarque terrain (ex. `rallonge`, `à vérifier`) |

#### Fichier 4 : `medias_liaisons.csv` *(photos rattachées & distances/chemins de câbles)*

| Colonne | Type / Valeurs attendues | Obligatoire ? | Rôle |
| --- | --- | --- | --- |
| `scenario` | texte | Non (défaut `actuel`) | Scénario concerné |
| `media_id` | texte unique par scénario | **Oui** | Identifiant de la photo ou de la liaison |
| `type_entree` | `photo` | `liaison_cable` | **Oui** | Photo rattachée ou info de distance/chemin de câble |
| `cible_type` | `zone` | `boitier` | `disjoncteur` | `point` | **Oui** | Type d'élément auquel se rattache l'entrée |
| `cible_id` | texte (`id` correspondant) | **Oui** | Identifiant de la zone, du boîtier, du disjoncteur ou du point |
| `valeur` | texte (ex. `photos/atelier_1.jpg` ou `15m entre TB_MAIN et TB_ATELIER`) | **Oui** | Nom/chemin de fichier photo ou distance/chemin |
| `repere_x_pct`, `repere_y_pct` | nombre `0` à `100` ou vide | Non | Position d'une punaise cliquable sur la photo (`%` largeur / hauteur) |

---

### 3. Variables d'état partagé entre modules (le "bus")

Chaque module s'abonne aux changements de cet objet d'état et peut demander une mise à jour d'une ou plusieurs clés :

```js
const appState = {
  scenarioActif: "actuel",          // string : ex. "actuel", "extension_1"
  zoneSelectionneeId: null,        // string | null : déclenche isolation / focus zone en 3D + photos
  niveauIsolation: "tout",           // "tout" | "batiment" | "etage" | "piece"
  boitierSelectionneId: null,      // string | null : boîtier affiché dans la vue tableau
  disjoncteurSelectionneId: null,  // string | null : allume les points reliés en 3D + photos
  pointSelectionneId: null,        // string | null : remonte vers disjoncteur, boîtier, phase + photo
  filtrePhase: "TOUTES",             // "TOUTES" | "L1" | "L2" | "L3"
  modeColoration3D: "phases",        // "phases" | "circuits" | "statut" | "diagnostic"
  simulationAjout: null              // null | { zoneId, disjoncteurId, phase, puissanceW, label }
};

