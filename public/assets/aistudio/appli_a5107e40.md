# Compte rendu de réflexion (version mise à jour) — Application web de cartographie et d'analyse électrique (3D schématique & triphasé)

## 1. Vision et objectifs de l'application

L'objectif est de concevoir une application web légère, lisible et pragmatique pour **comprendre, surveiller et faire évoluer l'installation électrique triphasée (`L1`, `L2`, `L3`) d'une propriété**, en s'appuyant sur le relevé terrain déjà réalisé (prises, lumières, phases, types d'appareils, boîtiers/disjoncteurs).

Les trois axes d'usage retenus :

1. **Comprendre le montage** : visualiser la répartition par phase (`L1`, `L2`, `L3`), la hiérarchie des tableaux/boîtiers et la correspondance entre disjoncteurs, prises et lumières.
2. **Détecter les risques et points de vigilance** : identifier les déséquilibres entre phases, les circuits déjà sollicités et les situations exposant à un **risque de surcharge lié aux rallonges / multiprises**.
3. **Préparer les extensions** : anticiper l'ajout d'équipements, de circuits ou de nouveaux raccordements en tenant compte de la charge, des phases disponibles et des distances/chemins de câbles.

---

## 2. Choix d'architecture : modularité et standard avant tout

Pour construire l'application pas à pas dans **Google AI Studio** et pouvoir faire évoluer une brique sans tout recoder, la réflexion a convergé vers une **architecture modulaire pilotée par un standard commun** :

* **Découpage en modules indépendants et testables séparément** :
* *Chargement & modèle pivot* : lecture des CSV, normalisation des données et contrôle de cohérence (identifiants manquants, liens cassés, données partielles).
* *Vue 3D schématique* : génération des volumes, isolation par zone, coloration/mise en évidence selon les phases, circuits ou scénarios.
* *Vue boîtier / tableau électrique* : affichage complet d'un boîtier, de sa hiérarchie (tableau principal / secondaires) et de ses disjoncteurs.
* *Photos terrain rattachées* : affichage des photos associées à une zone ou un point, avec repères/punaises cliquables.
* *Diagnostic & scénarios* : repérage des déséquilibres/surcharges, alertes liées aux rallonges et comparaison entre scénarios.


* **Standard de communication (modèle pivot + état partagé)** : les modules ne dépendent pas du code interne les uns des autres ; ils partagent une structure de données homogène et un état global (sélection de zone, de boîtier, de disjoncteur ou de point, filtre de phase, scénario actif).
* **Tolérance aux données incomplètes** : le relevé actuel (phase + type d'appareil, complété progressivement) sert déjà de base exploitable ; les champs non encore renseignés (ampérages/puissances estimées, photos, distances) sont gérés proprement sans bloquer l'application.

---

## 3. Fabrication de la 3D schématique et lien avec les photos terrain

### 3.1. Une 3D schématique construite pour l'efficacité

* **Pas de 3D réaliste ni de modélisation lourde** : les bâtiments, étages et pièces sont représentés par des **volumes simples (blocs/boîtes)** épurés, où la couleur et la mise en surbrillance servent à lire l'information électrique.
* **Fabrication en 4 étapes** :
1. **Décrire les volumes dans un tableur/CSV** (`zone_id`, parent/hiérarchie, type de zone, position `X, Y, Z`, dimensions `largeur, profondeur, hauteur`, statut `existant` / `projete`).
2. **Générer les blocs automatiquement** à partir de ces lignes, avec possibilité d'**isoler ou filtrer** un bâtiment, un étage ou une pièce pour éviter que les volumes ne se cachent entre eux.
3. **Rattacher les points électriques et les photos** à la zone/au circuit concerné (et/ou positionner des repères au clic).
4. **Réagir aux sélections et filtres** (clic sur un disjoncteur dans la fenêtre boîtier → mise en avant des points concernés en 3D ; clic sur un point ou une zone en 3D → remontée vers le disjoncteur, le boîtier, la phase et les photos associées).



### 3.2. Articulation 3D schématique + photos ("lien par repère / étiquette")

Plutôt que de chercher à reconstruire une 3D complexe à partir de photos :

* **La 3D schématique** donne la repérabilité spatiale globale, la logique des phases/circuits et l'analyse des charges.
* **Les photos terrain** sont rattachées par identifiant/étiquette à la pièce, au boîtier ou au point (avec possibilité de placer des repères cliquables sur l'image) afin de reconnaître visuellement l'endroit sur le terrain.

---

## 4. Scénarios et extensions pilotés par le tableur/CSV (sans retoucher au code)

L'intégration d'un champ de **scénario** (ex. `actuel`, `scenario_2`, `extension_atelier`) et d'un **statut** (`existant` vs `projete`) dans les fichiers CSV permet de :

* Dupliquer et adapter l'état d'un circuit, d'une phase, d'un boîtier, d'un point ou d'un bloc de plan directement dans le tableur (Excel / Google Sheets / LibreOffice) et dans les paramètres du plan.
* Basculer d'un scénario à l'autre dans l'application et visualiser l'impact (répartition des phases, charge des circuits, nouveaux volumes/raccordements) **sans modifier le code de l'application**.
* Veiller à deux règles simples lors de la duplication dans le tableur : garder des identifiants cohérents par scénario et vérifier que chaque point/sous-élément référence un parent ou disjoncteur existant dans ce scénario.

---

## 5. Prochaines étapes recommandées

1. **Finaliser le standard exact** (noms de colonnes des CSV, valeurs autorisées pour les phases/statuts/scénarios, clés de liaison et variables d'état partagé).
2. **Préparer un petit jeu de données CSV de test** (quelques zones, 1–2 boîtiers, quelques disjoncteurs, prises/lumières, 1 scénario d'extension et 1–2 photos).
3. **Démarrer le premier module dans Google AI Studio** en imposant le standard et le périmètre strict du module.