# DataAuditor — Manuel utilisateur

**Version 3.31.0 · data/auditor server**

---

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Installation et démarrage](#2-installation-et-démarrage)
3. [Workflow en 6 étapes](#3-workflow-en-6-étapes)
4. [Formats de fichiers supportés](#4-formats-de-fichiers-supportés)
5. [Configuration YAML](#5-configuration-yaml)
6. [Règles de contrôle](#6-règles-de-contrôle)
7. [Filtres](#7-filtres)
8. [Dépivotage (unpivot)](#8-dépivotage-unpivot)
9. [Champs calculés](#9-champs-calculés)
10. [Résultats et exports](#10-résultats-et-exports)
11. [Fichiers exemples](#11-fichiers-exemples)

---

## 1. Vue d'ensemble

DataAuditor est un outil d'audit de cohérence de données entre deux sources hétérogènes. Il compare les enregistrements de deux fichiers (référence et cible) pour détecter :

| Type d'écart | Signification |
|---|---|
| **ORPHELIN_A** | Enregistrement présent dans la référence, absent dans la cible |
| **ORPHELIN_B** | Enregistrement présent dans la cible, absent dans la référence |
| **KO** | Enregistrement commun, condition d'une règle déclenchée |
| **OK** | Enregistrement commun et conforme (affiché si `show_matching: true`) |
| **PRESENT** | Enregistrement commun, aucune règle ne s'applique (pas de KO ni OK) |

Les résultats sont diffusés en temps réel (Server-Sent Events) et affichés **une ligne par clé** — plusieurs règles peuvent se déclencher sur la même clé et apparaissent sous forme de badges colorés.

---

## 2. Installation et démarrage

### Linux / macOS

```bash
bash install.sh
bash run.sh
```

### Windows

Double-cliquez sur `install.bat`, puis sur `run.bat`.

Le script d'installation :
1. Vérifie que Python 3.10+ est disponible
2. Crée un environnement virtuel `.venv/`
3. Installe les dépendances (`requirements.txt`)
4. Génère un script de lancement (`run.sh` / `run.bat`)

### Lancement manuel

```bash
source .venv/bin/activate   # Linux/macOS
python server.py
# → http://localhost:5000
```

### Persistance de session

À chaque fermeture ou rechargement, DataAuditor sauvegarde automatiquement dans le navigateur :
- Le contenu de la dernière configuration YAML
- Les noms des derniers fichiers utilisés

Ces informations sont restaurées à l'ouverture suivante.

---

## 3. Workflow en 6 étapes

Le bandeau en haut guide à travers 6 étapes numérotées. Les étapes se déverrouillent progressivement.

```
⓪ Config → ① Datasets → ② Jointure → ③ Règles → ④ Filtres → ⑤ Résultats
```

---

### ⓪ Config *(optionnel)*

Chargez un fichier YAML existant pour **pré-remplir automatiquement** toutes les étapes suivantes. Glissez-déposez le fichier `.yaml` ou `.yml` dans la zone prévue.

> Les fichiers YAML encodés en ANSI/Windows-1252 sont automatiquement détectés.

> Vous pouvez ignorer cette étape et configurer manuellement à partir de l'étape ①.

---

### ① Datasets

L'étape Datasets présente un **panneau divisé** en deux moitiés côte à côte :

- **Gauche — Source A** (vert) : votre fichier de référence (ex. : export WMS, fichier comptable)
- **Droite — Source B** (violet) : votre fichier cible (ex. : export ERP, fichier de rapprochement)

Cliquez sur une moitié pour l'**activer** : la configuration de cette source s'affiche dans la section en dessous, avec une bordure colorée indiquant quelle source est en cours d'édition.

**Pour chaque source :**
- Nommez la source (ex. : "Stock WMS") — ce nom s'affiche dans la barre de synthèse et les filtres
- Formats acceptés : **CSV, TXT, JSON, JSONL, XLSX**
- Configurez le format dans la section **Colonnes** :
  - **CSV** : délimité, avec détection automatique possible (bouton **🔍 Détecter la structure**)
  - **Positionnel** : colonnes à largeur fixe (position + largeur de chaque champ)
  - **JSON** / **JSONL** : avec configuration optionnelle des champs et chemins (voir §4)
  - **XLSX** : colonnes détectées automatiquement

**Boutons disponibles après chargement :**
- **Prévisualiser** : affiche les premières lignes du fichier brut
- **Vérifier les colonnes** : valide la compatibilité entre le fichier et la configuration déclarée

**Encodage** : UTF-8, UTF-8 avec BOM, Windows-1252, Latin-1. Changer l'encodage re-parse et met à jour les colonnes détectées.

**Réordonnancement des colonnes** : glissez les icônes ⠿ pour réordonner les champs. Pour le format positionnel, les positions sont recalculées automatiquement.

L'étape ② (Jointure) se déverrouille dès que les deux sources sont chargées.

---

### ② Jointure

Définissez les **clés de jointure** : les colonnes qui permettent d'apparier les enregistrements entre les deux sources.

Exemple : `SKU` (référence) ↔ `sku` (cible), `Site` (référence) ↔ `site` (cible)

> Au moins une clé de jointure est obligatoire. Vous pouvez en définir plusieurs (clé composite).

Le bouton **Tester la jointure** affiche un aperçu du taux de couverture (paires matchées, orphelins A et B) avant de lancer l'audit complet.

---

### ③ Règles

Définissez les **règles de contrôle** appliquées sur les enregistrements appariés.

Chaque règle a :
- Un **nom** libre
- Une **logique** : `AND` ou `OR`
- Un **type** : `incoherence` (KO si la condition est vraie) ou `coherence` (KO si la condition est fausse)
- Un ou plusieurs **champs** à comparer, avec opérateur et tolérance optionnelle

Chaque règle reçoit automatiquement une **couleur distincte** visible dans le tableau des résultats.

---

### ④ Filtres & Rapport

- **Filtres** : restreignez l'audit à un sous-ensemble de lignes (par valeur d'un champ)
- **Rapport** : `show_matching` active l'affichage des lignes conformes ; `max_diff_preview` limite la pagination
- **Méta** : nommez et versionnez votre configuration

Cliquez **▶ Lancer l'audit** : l'application bascule sur la page résultats avec barre de progression.

> La **barre d'actions** (en haut, persistante) regroupe : **💾** (enregistrer), **Save As…** (enregistrer sous), **‹/›** (éditeur YAML), le nom du fichier config, et les pills des fichiers chargés. À l'étape ⑤, les boutons d'export (CSV, HTML, XLS) s'y ajoutent également.

---

### ⑤ Résultats

Affichage en streaming des résultats, **une ligne par clé** :

**Barre de synthèse** (texte narratif) :
```
Source (WMS) : 98 enr. dont 2 absents de la cible  |  Cible (ERP) : 99 enr. dont 1 absent de la source
```

**Barre de filtres** :
- **Présence dans les deux** : enregistrements appariés — KO, OK et PRESENT (badge "Apparié")
- **Uniquement dans Source** : orphelins absents de la cible (ORPHELIN_A)
- **Uniquement dans Cible** : orphelins absents de la référence (ORPHELIN_B)
- **Chips de règle** : filtre secondaire par règle individuelle — **fond vert** = règle de cohérence, **fond rouge** = règle d'incohérence ; le point coloré identifie la règle précise
- **Bouton AND / OR** (entre le label "Règles" et les chips) : `OR` (défaut) = au moins une règle sélectionnée ; `AND` = toutes les règles sélectionnées doivent être présentes sur l'enregistrement
- **Recherche** : full-text sur toutes les colonnes affichées (clé, règles, valeurs réf./cible, colonnes supplémentaires)

> **Modèle additif** : chaque chip de type active son sous-ensemble indépendamment. "Présence dans les deux" + "Uniquement dans Source" affiche les appariés ET les orphelins source.

**Tableau** :

| Colonne | Description |
|---|---|
| 👁 | Ouvre la revue côte à côte |
| Clé | Valeur(s) de la clé de jointure |
| Règles | Badges colorés des règles déclenchées. Badge gris "Apparié" = clé matchée sans règle applicable |
| ⛶ | Bouton plein écran (dernière colonne de l'en-tête) |

> Les badges grisés correspondent aux règles non sélectionnées dans les filtres.

**Colonnes supplémentaires** : via le sélecteur de colonnes, ajoutez des champs bruts de la référence et/ou de la cible. Les colonnes affichent le nom du fichier et le format sur une première ligne fine, puis le nom du champ. Les colonnes sont **redimensionnables** (glisser le bord droit) et **réordonnables par glisser-déposer** — le mélange source/cible est autorisé.

**Mode plein écran** : cliquez sur ⛶ en haut à droite du tableau pour masquer le bandeau de navigation et la barre de filtres. Cliquez à nouveau pour quitter.

**Pagination serveur** : navigation par pages (taille configurable).

---

### Revue côte à côte (👁)

Ouvrez la revue d'un enregistrement :
- **En-tête** : clé de l'enregistrement + pills des règles déclenchées sur cette ligne
- **Deux panneaux** : référence (gauche) et cible (droite), avec 1 enregistrement de contexte par défaut (réglable)
- Les champs impliqués dans au moins une règle active sont **mis en évidence** (fond jaune) **des deux côtés**
- Des **points colorés** identifient les règles liées à chaque champ (couleur propre à chaque règle)
- **Pills interactives** : cliquez sur une pill de règle dans l'en-tête pour activer/désactiver la mise en évidence de cette règle (toutes sélectionnées par défaut)

---

## 4. Formats de fichiers supportés

### CSV (et fichiers délimités)

Accepte les extensions `.csv` et `.txt`. Le parsing est compatible RFC 4180.

| Paramètre YAML | Description | Exemple |
|---|---|---|
| `format` | Format du fichier | `csv` |
| `delimiter` | Séparateur de colonnes | `;`, `,`, `\|`, `\t` |
| `encoding` | Encodage | `utf-8`, `utf-8-sig`, `windows-1252`, `latin-1` |
| `has_header` | Première ligne = en-tête | `true` / `false` |
| `skip_rows` | Lignes à ignorer avant l'en-tête | `0`, `1`, `2`… |
| `record_filter.marker` | Regex de filtrage de lignes | `^1` |
| `max_columns` | Limite du nombre de colonnes lors du split | entier |

#### Mapping des colonnes

- **Lookup par nom** : si tous les noms config se retrouvent dans l'en-tête → chaque champ est sélectionné par son nom (permet de ne déclarer qu'un sous-ensemble d'un fichier large)
- **Mapping positionnel** : si au moins un nom ne correspond à aucun en-tête → les champs sont mappés dans l'ordre des colonnes du fichier

#### Détection automatique

Le bouton **🔍 Détecter la structure** lit l'en-tête du fichier et propose la liste des colonnes. Les types restent à renseigner manuellement.

---

### Positionnel (fixed_width)

Format à largeur fixe où chaque champ occupe un nombre exact de caractères.

Sélectionnez le format **Positionnel** dans le wizard. La table de colonnes affiche les champs **Position** et **Largeur** :

```yaml
format: csv
fixed_width: true
column_positions:
  - name: SKU
    position: 8     # position du premier caractère (1-indexé)
    width: 10       # nombre de caractères
    type: string
  - name: Qty
    position: 39
    width: 7
    type: integer
```

> Les positions sont **1-indexées** (le premier caractère de la ligne est à la position 1). Le wizard génère automatiquement le YAML `fixed_width: true` + `column_positions` lorsque le format **Positionnel** est sélectionné.

---

### JSON

Format JSON classique — un fichier, un objet ou un tableau racine.

```yaml
format: json
json_path: data.records   # optionnel : chemin dot-notation vers le tableau d'enregistrements
fields:
  - name: id
  - name: customer_name
    path: customer.name   # chemin dot-notation depuis chaque enregistrement
  - name: amount
    type: decimal
```

#### `json_path` — naviguer vers le tableau

Si le fichier JSON contient le tableau d'enregistrements à l'intérieur d'un objet imbriqué, utilisez `json_path` pour y accéder :

| Structure JSON | `json_path` |
|---|---|
| `[{...}, {...}]` | *(laisser vide)* |
| `{"records": [{...}]}` | *(laisser vide, auto-détecté)* |
| `{"data": {"items": [{...}]}}` | `data.items` |
| `{"payload": {"results": [{...}]}}` | `payload.results` |

Auto-détection des clés : si `json_path` est absent, DataAuditor cherche un tableau dans les clés `records`, `data`, `items`, `rows`.

#### `path` — extraire des champs imbriqués

Le `path` dot-notation permet d'extraire un champ imbriqué dans chaque enregistrement :

```json
{"id": "A01", "customer": {"name": "Dupont", "city": "Paris"}, "amount": 10.5}
```
```yaml
fields:
  - name: id                        # accès direct → rec["id"]
  - name: customer_name
    path: customer.name             # accès imbriqué → rec["customer"]["name"]
  - name: city
    path: customer.city
```

Si `path` est absent, le champ `name` est utilisé comme clé directe.

#### Champs optionnels

Si aucun champ n'est déclaré, **toutes les colonnes** du JSON sont chargées (comportement par défaut).

#### Détection automatique

Le bouton **🔍 Détecter la structure** lit les premières lignes du fichier :
- Applique `json_path` si renseigné
- Lit le premier enregistrement et propose toutes ses clés
- Les champs imbriqués à un niveau de profondeur sont proposés avec leur `path` pré-rempli

#### Vérification des colonnes

Le bouton **Vérifier les colonnes** affiche un tableau des champs déclarés dans la configuration (nom, type, chemin, ignoré) — de la même façon que pour les fichiers CSV.

---

### JSONL (JSON Lines)

Format où **chaque ligne** est un objet JSON indépendant (`.jsonl`, `.ndjson`).

```yaml
format: jsonl
fields:
  - name: id
  - name: amount
    type: decimal
  - name: customer_name
    path: customer.name
```

> Le `json_path` ne s'applique pas au JSONL (chaque ligne est déjà un enregistrement). Les champs avec `path` imbriqué fonctionnent de la même façon qu'en JSON.

Les lignes vides ou invalides sont ignorées silencieusement.

---

### XLSX (Excel)

```yaml
format: xlsx
sheet_name: Feuil1   # optionnel, 1ère feuille par défaut
```

Les colonnes sont détectées automatiquement depuis la première ligne (en-tête). Aucune déclaration de champs requise.

---

## 5. Configuration YAML

La configuration est générée automatiquement par le wizard. Vous pouvez l'éditer directement via **`</> YAML`**.

### Schéma complet

```yaml
meta:
  name: "Nom de l'audit"
  version: "1.0"

sources:
  reference:
    label: "Nom affiché de la source A"
    format: csv              # csv | positionnel → json | jsonl | xlsx
    encoding: utf-8          # utf-8 | utf-8-sig | windows-1252 | latin-1
    delimiter: ";"
    has_header: true
    skip_rows: 0
    max_columns: 5           # optionnel : limite le split des colonnes
    record_filter:
      marker: "^1"           # regex de filtrage de lignes
    # CSV avec largeur fixe (positions 1-indexées) :
    fixed_width: true
    column_positions:
      - { name: SKU,  position: 8,  width: 10, type: string  }
      - { name: Qty,  position: 39, width: 7,  type: integer }
    # CSV sans largeur fixe :
    fields:
      - { name: SKU,   type: string  }
      - { name: Prix,  type: decimal }
      - { name: Date,  type: date, date_format: "%Y-%m-%d" }
    # JSON / JSONL (optionnel) :
    json_path: data.records
    fields:
      - { name: id }
      - { name: customer_name, path: customer.name }
    # Dépivotage (format large → long) :
    unpivot:
      anchor_fields: [SKU]
      location_field: depot
      value_field: qty
      pivot_fields:
        - { source: qty_A, location: depot_A }
        - { source: qty_B, location: depot_B }
    # Champs calculés (expressions pandas/numpy) :
    calculated_fields:
      - { name: total_qty, expression: "qty_A + qty_B", type: integer }
      - { name: price_ttc, expression: "price * 1.20", type: decimal }

  target:
    # même structure que reference

join:
  keys:
    - { source_field: SKU,  target_field: sku  }
    - { source_field: Site, target_field: site }   # clé composite

filters:
  - field: Site
    source: reference
    operator: equals
    value: PAR

rules:
  - name: "Quantité incohérente"
    logic: AND
    rule_type: incoherence
    fields:
      - source_field: Qty
        target_field: qty
        operator: differs
        tolerance: 0

report:
  show_matching: false
  max_diff_preview: 500
```

---

### Types de champs

| Type | Description |
|---|---|
| `string` | Chaîne de caractères (défaut) |
| `integer` | Entier |
| `decimal` | Décimal (virgule flottante) |
| `date` | Date — nécessite `date_format` (ex. `%Y%m%d`, `%d/%m/%Y`) |
| `boolean` | Booléen |
| `skip` | Lu mais ignoré — utile pour ne pas décaler les colonnes positionnelles |

### Formats de date (`date_format`)

Le `date_format` utilise la syntaxe **strftime** de Python. Un aperçu dynamique de la date du jour est affiché dans le wizard dès que vous saisissez un format.

#### Codes de format

| Code | Description | Exemple |
|---|---|---|
| `%Y` | Année sur 4 chiffres | `2025` |
| `%y` | Année sur 2 chiffres | `25` |
| `%m` | Mois sur 2 chiffres (01–12) | `03` |
| `%d` | Jour sur 2 chiffres (01–31) | `23` |
| `%H` | Heure 24 h sur 2 chiffres (00–23) | `14` |
| `%M` | Minute sur 2 chiffres (00–59) | `07` |
| `%S` | Seconde sur 2 chiffres (00–59) | `45` |
| `%j` | Jour de l'année (001–366) | `082` |
| `%b` | Mois abrégé | `Mar` |
| `%B` | Mois complet | `Mars` |

#### Exemples courants

```yaml
date_format: "%Y-%m-%d"       # 2025-03-25  (ISO 8601, universel)
date_format: "%d/%m/%Y"       # 25/03/2025  (format FR courant)
date_format: "%d/%m/%Y %H:%M" # 25/03/2025 14:07
date_format: "%Y%m%d"         # 20250325    (compact, sans séparateur)
date_format: "%d%m%Y"         # 25032025    (compact FR)
date_format: "%d-%b-%Y"       # 25-Mar-2025 (avec mois abrégé)
date_format: "%Y/%m/%d"       # 2025/03/25
date_format: "%m/%d/%Y"       # 03/25/2025  (format US)
date_format: "%d.%m.%Y"       # 25.03.2025  (format allemand/suisse)
```

> **Conseil** : si vos deux sources ont des formats de date différents, normalisez-les dans leur configuration respective — la comparaison se fait toujours sur les valeurs normalisées.

---

## 6. Règles de contrôle

### Opérateurs disponibles

| Opérateur YAML | Condition vraie quand… |
|---|---|
| `equals` | A = B |
| `differs` | A ≠ B |
| `greater` | A > B |
| `less` | A < B |
| `contains` | B est contenu dans A |
| `not_contains` | B n'est pas contenu dans A |

> Alias legacy acceptés dans les YAML existants : `=` → `equals`, `<>` → `differs`.

---

### `rule_type` : logique KO / OK

| Valeur | Produit KO quand… | Usage typique |
|---|---|---|
| `incoherence` | La condition est **vraie** | Détecter des différences (A ≠ B) |
| `coherence` | La condition est **fausse** | Confirmer une conformité (A = B) |

> Une règle `coherence` ne produit **jamais de KO** dans le sens d'une erreur métier — elle confirme la conformité. Pour détecter des différences, utilisez `incoherence`.

---

### Logique AND / OR

- **AND** : la règle se déclenche si **toutes** les conditions sont satisfaites
- **OR** : la règle se déclenche si **au moins une** condition est satisfaite

---

### Tolérance numérique

```yaml
- source_field: Prix
  target_field: prix
  operator: equals
  tolerance: 0.05   # écart acceptable de ±0,05
```

---

### Normalisation textuelle

```yaml
- source_field: Libelle
  target_field: libelle
  normalize: both   # lowercase + trim avant comparaison
```

Options : `none` (défaut), `lowercase`, `trim`, `both`

---

### Valeur fixe côté référence ou cible

```yaml
- source_data:
    field: Statut
    normalize: trim
  target_data:
    value: "ACTIF"    # valeur fixe attendue côté cible
```

---

### Couleurs des règles

Chaque règle reçoit automatiquement une couleur unique (palette de 10 couleurs cycliques). Cette couleur est utilisée :
- Dans les **badges** du tableau des résultats
- Dans les **chips** de filtre règle
- Dans les **points** de la revue côte à côte (champs impliqués)

---

## 7. Filtres

Les filtres restreignent l'audit à un sous-ensemble de lignes **avant la jointure**.

```yaml
filters:
  - field: Site
    source: reference       # reference | target
    operator: equals        # equals | differs | contains | not_contains | greater | less
    value: PAR
```

### Opérateurs de filtre

| Opérateur | Comportement |
|---|---|
| `equals` | Conserve les lignes où `field` = `value` |
| `differs` | Conserve les lignes où `field` ≠ `value` |
| `contains` | Conserve les lignes où `field` contient `value` |
| `not_contains` | Conserve les lignes où `field` ne contient pas `value` |
| `greater` | Conserve les lignes où `field` > `value` |
| `less` | Conserve les lignes où `field` < `value` |

> Compat ascendante : l'ancien format `values: [PAR, LYO]` est automatiquement converti en filtre `equals` avec la première valeur.

> Les orphelins restent détectables après filtrage : une clé filtrée dans A mais présente dans B apparaît quand même en ORPHELIN_B.

---

## 8. Dépivotage (unpivot)

Le dépivotage transforme un fichier **large** (une colonne par dépôt, période…) en format **long** (une ligne par combinaison) avant la comparaison.

```yaml
sources:
  reference:
    fields:
      - { name: SKU,   type: string  }
      - { name: qty_A, type: integer }
      - { name: qty_B, type: integer }
      - { name: qty_C, type: integer }
    unpivot:
      anchor_fields: [SKU]          # colonnes conservées sur chaque ligne générée
      location_field: depot         # nouvelle colonne : nom du dépôt
      value_field: qty              # nouvelle colonne : valeur dépivotée
      pivot_fields:
        - { source: qty_A, location: depot_A }
        - { source: qty_B, location: depot_B }
        - { source: qty_C, location: depot_C }
```

Résultat : chaque ligne `SKU001, qty_A=100, qty_B=200` devient :
```
SKU001 | depot_A | 100
SKU001 | depot_B | 200
```

### Jointure avec dépivotage

Incluez `location_field` dans `join.keys` :

```yaml
join:
  keys:
    - { source_field: SKU,   target_field: SKU   }
    - { source_field: depot, target_field: depot }
```

---

## 9. Champs calculés

Les champs calculés permettent de créer des colonnes synthétiques basées sur **expressions pandas/numpy**, évaluées indépendamment pour chaque source (référence et cible). Ils sont utiles pour :

- Synthétiser des informations (somme, moyenne, concaténation)
- Normaliser avant comparaison (arrondi, extraction)
- Créer des clés dérivées pour audit
- Évaluer des formules métier

### Syntaxe YAML

```yaml
sources:
  reference:
    fields:
      - { name: qty_a, type: integer }
      - { name: qty_b, type: integer }
      - { name: price, type: decimal }
    calculated_fields:
      - name: total_qty
        expression: "qty_a + qty_b"
        type: integer
      - name: total_price
        expression: "price * 1.20"    # exemple : prix TTC
        type: decimal
```

Chaque champ calculé :
- Reçoit un **nom** unique
- Contient une **expression** (syntaxe pandas)
- Spécifie un **type** final (string, integer, decimal, date, boolean)
- Peut être ensuite utilisé dans les **règles**, **filtres** et **colonnes supplémentaires**

### Exemples classiques

#### 1. Somme de colonnes

```yaml
calculated_fields:
  - name: total_qty
    expression: "qty_stock + qty_reception"
    type: integer
```

**Cas d'usage :** réconciler les stocks (quantité totale = stock actuel + réception en cours).

---

#### 2. Concaténation (texte)

```yaml
calculated_fields:
  - name: full_code
    expression: "site + '-' + str(sku)"
    type: string
```

**Cas d'usage :** créer une clé composite pour recherche ou audit de doublets.

---

#### 3. Arrondi décimal

```yaml
calculated_fields:
  - name: price_rounded
    expression: "round(price, 2)"
    type: decimal
```

**Cas d'usage :** normaliser les décimales avant comparaison (éviter les écarts de précision).

---

#### 4. Extraction d'une partie de texte

```yaml
calculated_fields:
  - name: year
    expression: "date.astype(str).str[:4]"
    type: string
```

**Cas d'usage :** extraire l'année d'une date pour un audit par période.

---

#### 5. Condition/booléen

```yaml
calculated_fields:
  - name: is_expensive
    expression: "(price > 100).astype(int)"
    type: integer
    # résultat : 1 si price > 100, sinon 0
```

**Cas d'usage :** segmenter les enregistrements par catégorie de prix pour des règles spécifiques.

---

#### 6. Valeur absolue (éliminer les signes)

```yaml
calculated_fields:
  - name: amount_abs
    expression: "abs(amount)"
    type: decimal
```

**Cas d'usage :** comparer des montants indépendamment du sens (crédit/débit).

---

#### 7. Conversion de devise (exemple)

```yaml
calculated_fields:
  - name: amount_usd
    expression: "amount * 1.10"   # fictif : EUR → USD
    type: decimal
```

**Cas d'usage :** harmoniser les montants entre deux systèmes avant comparaison.

---

#### 8. Suppression d'espaces (trim)

```yaml
calculated_fields:
  - name: code_clean
    expression: "code.str.strip()"
    type: string
```

**Cas d'usage :** nettoyer les codes avant comparaison (évite les faux orphelins dus à des espaces).

---

#### 9. Longueur de texte

```yaml
calculated_fields:
  - name: name_length
    expression: "len(name)"
    type: integer
```

**Cas d'usage :** détecter des troncages ou dégradations de texte dans la cible.

---

#### 10. Maximum/Minimum entre colonnes

```yaml
calculated_fields:
  - name: max_qty
    expression: "max([qty_ref, qty_cible], axis=1)"
    type: integer
    # Note: utiliser plutôt numpy.maximum pour éviter ambiguïté

  - name: max_qty_correct
    expression: "np.maximum(qty_ref, qty_cible)"
    type: integer
```

**Cas d'usage :** prendre le pivot supérieur entre deux sources pour audit.

---

### Interaction avec les autres features

#### Utilisation dans les règles

```yaml
rules:
  - name: "Total discordant"
    logic: AND
    rule_type: incoherence
    fields:
      - source_field: total_qty        # champ calculé dans référence
        target_field: total_qty        # même champ calculé dans cible
        operator: differs
```

#### Utilisation dans les filtres

```yaml
filters:
  - field: is_expensive              # champ calculé
    source: reference
    operator: equals
    value: 1                          # filtre sur les articles chers
```

#### Utilisation dans les colonnes supplémentaires

Après le lancement de l'audit, ouvrez le **sélecteur de colonnes** et ajoutez le champ calculé comme colonne supplémentaire — il apparaîtra aux côtés des champs bruts.

---

### Notes et limitations

1. **Syntaxe pandas** : les expressions utilisent la syntaxe pandas/numpy. Consulter la [documentation pandas](https://pandas.pydata.org/docs/) pour les opérations disponibles.

2. **Différence source/cible** : les expressions sont évaluées **indépendamment** pour chaque source. Aucun croisement n'est possible (pas d'accès aux données de la cible depuis une expression référence).

3. **Typage** : le `type` final doit correspondre au résultat attendu de l'expression. Les conversions implicites (ex. `int(...)`, `str(...)`) peuvent être nécessaires.

4. **Performance** : les expressions complexes ralentissent l'audit. Privilégier les opérations simples.

5. **Null handling** : les valeurs vides (`NaN`, `None`) peuvent propager dans l'expression. Utiliser `.fillna()` ou `.isna()` pour les gérer.

   ```yaml
   calculated_fields:
     - name: qty_safe
       expression: "qty.fillna(0)"
       type: integer
   ```

6. **Évaluation** : les champs calculés sont évalués **après** la normalisation de type, donc les champs de base sont déjà typés (string, decimal, etc.).

---

## 10. Résultats et exports

### Tableau — une ligne par clé

Le tableau affiche **une ligne par clé de jointure**. Toutes les règles déclenchées sur une clé apparaissent comme des **badges colorés** dans la colonne *Règles* :

- **Badge ORPHELIN_A / ORPHELIN_B** : présence uniquement dans une source
- **Badge règle** (coloré) : nom de la règle déclenchée. Survol → détail (valeur réf. / valeur cible)
- **Badge "Apparié"** (gris neutre) : clé matchée sans résultat de règle (aucune règle ne s'applique)
- **Badge grisé** : règle non sélectionnée dans les filtres actifs

### Filtres de résultats

Les chips de type sont **additives** — chacune active un sous-ensemble indépendant :

| Chip | Types inclus |
|---|---|
| **Présence dans les deux** | KO + OK + DIVERGENT + PRESENT |
| **Uniquement dans Source** | ORPHELIN_A |
| **Uniquement dans Cible** | ORPHELIN_B |
| *Aucune chip active* | 0 lignes |

Les chips de règle filtrent **à l'intérieur** de la sélection de type. La recherche texte filtre sur la valeur de clé.

### Colonnes supplémentaires

Le sélecteur **Colonnes** permet d'ajouter des champs bruts de la source A (préfixe *Source :*) ou de la source B (préfixe *Cible :*).

### Pagination

Les résultats sont paginés côté serveur. La taille de page est configurable.

### Revue côte à côte

Cliquez sur 👁 pour ouvrir le panneau de revue d'un enregistrement :
- Navigation entre enregistrements voisins (contexte : 0 à 10 lignes)
- **Points colorés** à côté des champs impliqués dans au moins une règle
- **Fond jaune** sur les valeurs des champs impliqués dans une règle actuellement sélectionnée

### Exports

| Format | Description |
|---|---|
| **CSV** | Toutes les colonnes, encodage UTF-8 avec BOM (compatible Excel) |
| **XLSX** | Classeur Excel avec feuille *Résumé* (totaux) et feuille *Résultats* (lignes colorées) |
| **HTML** | Rapport interactif auto-contenu (chips, recherche, tri) — utilisable sans serveur |

> **CSV** et **XLSX** nécessitent un audit en cours de session. **HTML** reste disponible depuis l'historique.

### Historique

L'onglet **Historique** liste les audits précédents enregistrés dans `reports/`. Chaque audit peut être relu, supprimé ou purgé en masse.

---

## 11. Fichiers exemples

Téléchargez les fichiers ci-dessous pour tester DataAuditor immédiatement :

| Fichier | Description |
|---|---|
| `test_audit_demo.yaml` | Configuration complète — audit positionnel vs CSV avec règles et filtres |
| `test_reference.dat` | Fichier de référence — format positionnel 65 caractères, 100 lignes |
| `test_target.csv` | Fichier cible — CSV délimité `;`, 100 lignes |

### Anomalies injectées

| Clé | Type attendu | Description |
|---|---|---|
| SKU00006 | ORPHELIN_A | Absent du fichier CSV cible |
| SKU99999 | ORPHELIN_B | Absent du fichier DAT référence |
| SKU00056 | *filtré* | Site = ZZZ — exclu par le filtre de source |
| SKU00016 | KO | Quantité +10 |
| SKU00021 | KO | Quantité = -999 |
| SKU00026 | KO | Statut = 99 |
| SKU00031 | OK | Prix +0,03 (dans la tolérance de 0,05) |
| SKU00036 | KO | Prix +2,50 (hors tolérance) |
| SKU00041 | KO | EAN décalé d'une position |
| SKU00046 | KO | Type invalide |
| SKU00051 | KO | Statut + Quantité simultanément (multi-champs AND) |

### Procédure de test

1. **⓪** : chargez `test_audit_demo.yaml`
2. **①** : chargez `test_reference.dat` (Source A) et `test_target.csv` (Source B)
3. **② – ④** : la configuration est pré-remplie, cliquez **Suivant**
4. **④** : cliquez **▶ Lancer l'audit**
5. **⑤** : vérifiez les anomalies listées ci-dessus

---

*DataAuditor v3.31.0 — [Signaler un problème](https://github.com/nikomiko/data-auditor/issues)*
