# DataAuditor — Manuel utilisateur

**Version 3.0 · data/auditor server**

---

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Démarrage rapide](#2-démarrage-rapide)
3. [Workflow en 7 étapes](#3-workflow-en-7-étapes)
4. [Formats de fichiers supportés](#4-formats-de-fichiers-supportés)
5. [Configuration YAML](#5-configuration-yaml)
6. [Règles de contrôle](#6-règles-de-contrôle)
7. [Filtres](#7-filtres)
8. [Résultats et exports](#8-résultats-et-exports)
9. [Fichiers exemples](#9-fichiers-exemples)

---

## 1. Vue d'ensemble

DataAuditor est un outil d'audit de cohérence de données entre deux sources hétérogènes. Il compare, ligne par ligne, des fichiers de référence et des fichiers cibles afin de détecter :

| Type d'écart | Signification |
|---|---|
| **ORPHELIN_A** | Enregistrement présent dans la référence, absent dans la cible |
| **ORPHELIN_B** | Enregistrement présent dans la cible, absent dans la référence |
| **KO** | Enregistrement commun mais valeurs divergentes selon au moins une règle |

Le flux de résultats est diffusé en temps réel (Server-Sent Events) pendant l'audit.

---

## 2. Démarrage rapide

```bash
# Prérequis
python -m pip install -r requirements.txt

# Lancer le serveur
python server.py
# → http://localhost:5000
```

Pour tester immédiatement, utilisez les [fichiers exemples](#9-fichiers-exemples) fournis.

---

## 3. Workflow en 7 étapes

Le bandeau en haut de l'écran guide l'utilisateur à travers 7 étapes numérotées. Les étapes se déverrouillent progressivement.

```
⓪ Config → ① Référence → ② Cible → ③ Jointure → ④ Règles → ⑤ Filtres & Rapport → ⑥ Résultats
```

### ⓪ Config *(optionnel)*

Chargez un fichier YAML existant pour **pré-remplir automatiquement** toutes les étapes suivantes. Glissez-déposez le fichier `.yaml` ou `.yml` dans la zone prévue.

> Vous pouvez ignorer cette étape et configurer manuellement à partir de l'étape ①.

---

### ① Référence

Chargez le fichier **source de référence** (ex. : export WMS, fichier comptable).

- Formats acceptés : CSV, TXT, DAT, JSON, XLSX
- Après chargement, configurez la source (délimiteur, encodage, colonnes, type de chaque champ)
- Le bouton **Prévisualiser** affiche les premières lignes du fichier
- Le bouton **Vérifier les colonnes** valide la compatibilité entre le fichier et la configuration déclarée

---

### ② Cible

Chargez le fichier **source cible** (ex. : export ERP, fichier de rapprochement).

Même fonctionnement qu'à l'étape ①.

---

### ③ Jointure

Définissez les **clés de jointure** : les colonnes qui permettent d'identifier et d'apparier les lignes entre les deux sources.

Exemple : `SKU` (référence) ↔ `sku` (cible), `Site` (référence) ↔ `site` (cible)

> Au moins une clé de jointure est obligatoire. Vous pouvez en définir plusieurs (clé composite).

Le bouton **Tester la jointure** vérifie le taux de couverture avant de lancer l'audit complet.

---

### ④ Règles

Définissez les **règles de contrôle** appliquées sur les enregistrements appariés.

Chaque règle a :
- Un **nom** libre
- Une **logique** : `AND` (toutes les conditions doivent échouer) ou `OR` (au moins une)
- Un **type** : `coherence` (règle verte) ou `incoherence` (règle rouge) — voir [§6](#6-règles-de-contrôle)
- Un ou plusieurs **champs** à comparer, avec opérateur et tolérance optionnelle

---

### ⑤ Filtres & Rapport

- **Filtres** : restreignez l'audit à un sous-ensemble de lignes (ex. : site = "PAR")
- **Rapport** : activez/désactivez l'affichage des lignes conformes, ajustez le nombre max de lignes prévisualisées
- **‹/› YAML** : ouvre l'éditeur YAML complet pour édition directe de la configuration

Cliquez sur **▶ Lancer l'audit** pour démarrer.

---

### ⑥ Résultats

Affichage en streaming des résultats pendant l'audit :

- **Barre de filtres** : filtrez par type d'orphelin, par type de contrôle (Cohérence / Incohérence), par règle individuelle
- **Clic sur une règle** dans le tableau : isole les lignes de cette règle (clic à nouveau pour tout réafficher)
- **Clic sur l'œil** 👁 : ouvre le panneau de revue côte à côte (enregistrement référence vs cible, avec contexte)
- **Exporter CSV / HTML** : télécharge les résultats dans le format choisi

---

## 4. Formats de fichiers supportés

### CSV / TXT / DAT

| Paramètre | Description | Exemple |
|---|---|---|
| `delimiter` | Séparateur de colonnes | `;`, `,`, `\|`, `\t` |
| `encoding` | Encodage | `utf-8`, `utf-8-sig`, `latin-1` |
| `has_header` | Première ligne = en-tête | `true` / `false` |
| `skip_rows` | Nombre de lignes à ignorer avant l'en-tête | `0`, `1`, `2`… |
| `record_filter.marker` | Regex de filtrage des lignes (ex. : lignes commençant par `1`) | `^1` |
| `max_columns` | Limite du nombre de colonnes lors du split | entier |

### Format positionnel (fixed_width)

Utilisez `fixed_width: true` et déclarez les colonnes avec `column_positions` :

```yaml
fixed_width: true
column_positions:
  - name: SKU
    position: 7   # position du premier caractère (0-indexé)
    width: 10     # nombre de caractères
    type: string
  - name: Qty
    position: 38
    width: 7
    type: integer
```

### JSON

L'auto-détection des colonnes est effectuée au parsing. Aucune déclaration de colonnes requise.

### XLSX (Excel)

```yaml
format: xlsx
sheet_name: Feuil1   # optionnel, 1ère feuille par défaut
```

---

## 5. Configuration YAML

La configuration est générée automatiquement par l'interface. Vous pouvez l'éditer directement via **‹/› YAML**.

### Schéma complet

```yaml
meta:
  name: "Nom de l'audit"
  version: "1.0"

sources:
  reference:
    label: "Nom affiché de la source A"
    format: csv            # csv | txt | dat | json | xlsx
    encoding: utf-8
    delimiter: ";"
    has_header: true
    skip_rows: 0           # lignes à ignorer avant l'en-tête
    fixed_width: false
    record_filter:
      marker: "^1"         # regex filtre de lignes
    fields:
      - { name: SKU,   type: string  }
      - { name: Qty,   type: integer }
      - { name: Prix,  type: decimal }
      - { name: Date,  type: date,   date_format: "%Y-%m-%d" }
    unpivot:               # dépivotage (format large → long)
      anchor_fields: [SKU]
      location_field: depot
      value_field: qty
      pivot_fields:
        - { source: qty_A, location: depot_A }
        - { source: qty_B, location: depot_B }

  target:
    # même structure que reference

join:
  keys:
    - { source_field: SKU, target_field: sku }
    - { source_field: Site, target_field: site }   # clé composite

filters:
  - field: Site
    source: reference
    values: [PAR, LYO, MAR]

rules:
  - name: "Stock incohérent"
    logic: AND
    rule_type: incoherence
    fields:
      - source_field: Qty
        target_field: qty
        operator: differs
        tolerance: 0

comparison:            # syntaxe legacy (préférer rules)
  fields:
    - { source_field: Qty, target_field: qty, tolerance: 0 }
  ignore_fields: [RecordType]

report:
  show_matching: false
  max_diff_preview: 500
```

### Types de champs

| Type | Description |
|---|---|
| `string` | Chaîne de caractères (défaut) |
| `integer` | Entier |
| `decimal` | Décimal (float) |
| `date` | Date — nécessite `date_format` (ex. `%Y%m%d`) |
| `boolean` | Booléen |

---

## 6. Règles de contrôle

### Opérateurs disponibles

| Opérateur YAML | Symbole | Déclenchement |
|---|---|---|
| `equals` | = | Valeurs différentes (écart détecté) |
| `differs` | ≠ | Valeurs identiques (incohérence détectée) |
| `greater` | > | A > B (condition mathématique vraie) |
| `less` | < | A < B (condition mathématique vraie) |
| `contains` | ∋ | B est contenu dans A |
| `not_contains` | ∌ | B n'est pas contenu dans A |

> **Compatibilité** : les anciens symboles `=`, `<>`, `>`, `<` sont encore acceptés dans les fichiers YAML existants.

### Logique AND / OR

- **AND** : la règle se déclenche (KO) si **au moins un** champ est en écart
- **OR** : comportement identique (AND et OR ont le même effet dans la version actuelle — réservé pour évolution)

### rule_type

| Valeur | Couleur | Signification |
|---|---|---|
| `coherence` | 🟢 Vert | La règle vérifie que A et B sont identiques |
| `incoherence` | 🔴 Rouge | La règle vérifie que A et B sont différents |

> Le `rule_type` est uniquement visuel : il ne modifie pas la logique de détection.

### Tolérance numérique

```yaml
- source_field: Prix
  target_field: prix
  operator: equals
  tolerance: 0.05   # écart acceptable de ±0,05
```

### Normalisation textuelle

```yaml
- source_field: Libelle
  target_field: libelle
  normalize: both   # lowercase + trim avant comparaison
```

Options : `none` (défaut), `lowercase`, `trim`, `both`

### Syntaxe longue (source_data / target_data)

Pour des comparaisons avec valeur fixe ou normalisation asymétrique :

```yaml
- source_data:
    field: Libelle
    normalize: both
  target_data:
    field: libelle
    value: "ACTIF"   # valeur fixe côté cible
    tolerance: 0
```

---

## 7. Filtres

Les filtres restreignent l'audit à un sous-ensemble de lignes **avant la jointure**.

```yaml
filters:
  - field: Site
    source: reference
    values: [PAR, LYO, MAR]
  - field: site
    source: target
    values: [PAR, LYO, MAR]
```

- `source` : `reference` ou `target`
- `values` : liste de valeurs à conserver (liste blanche)
- Si `values` est absent : le filtre est déclaré comme pill UI sans filtrage de lignes

> Les orphelins restent détectables après filtrage : une clé filtrée dans A mais pas dans B apparaît en ORPHELIN_A.

---

## 8. Résultats et exports

### Tableau des résultats

| Colonne | Description |
|---|---|
| Clé de jointure | Valeur(s) de la clé qui identifient l'enregistrement |
| Type | ORPHELIN_A, ORPHELIN_B, KO |
| Règle | Nom de la règle déclenchée |
| Valeur référence | Valeur du champ dans la source A |
| Valeur cible | Valeur du champ dans la source B |
| 👁 | Ouvre la revue côte à côte |

### Revue côte à côte

Le panneau de revue affiche l'enregistrement complet (référence + cible) avec les enregistrements voisins (contexte configurable : 0 à 10 lignes avant/après).

### Export

- **CSV** : toutes les colonnes, encodage UTF-8 avec BOM (compatible Excel)
- **HTML** : rapport stylisé avec résumé et tableau complet

### Historique

L'onglet **Historique** liste les audits précédents. Chaque audit est sauvegardé automatiquement dans `reports/`.

---

## 9. Fichiers exemples

Téléchargez les fichiers ci-dessous pour tester DataAuditor immédiatement :

| Fichier | Description | Télécharger |
|---|---|---|
| `test_audit_demo.yaml` | Configuration complète — audit positionnel vs CSV | [⬇ Télécharger](/sample/test_audit_demo.yaml) |
| `test_reference.dat` | Fichier de référence — format positionnel 65 caractères, 100 lignes | [⬇ Télécharger](/sample/test_reference.dat) |
| `test_target.csv` | Fichier cible — CSV délimité `;`, 100 lignes | [⬇ Télécharger](/sample/test_target.csv) |

### Anomalies injectées dans les exemples

| SKU | Type attendu | Description |
|---|---|---|
| SKU00006 | ORPHELIN_A | Absent du fichier CSV |
| SKU99999 | ORPHELIN_B | Absent du fichier DAT |
| SKU00016 | KO | Quantité +10 |
| SKU00021 | KO | Quantité = -999 |
| SKU00026 | KO | Statut = 99 |
| SKU00031 | OK | Prix +0,03 (dans tolérance) |
| SKU00036 | KO | Prix +2,50 (hors tolérance) |
| SKU00041 | KO | EAN décalé |
| SKU00046 | KO | Type invalide |
| SKU00051 | KO | Statut + Qty (multi-champs) |

### Procédure de test

1. Étape ⓪ : chargez `test_audit_demo.yaml`
2. Étape ① : chargez `test_reference.dat`
3. Étape ② : chargez `test_target.csv`
4. Étape ③–⑤ : la configuration est déjà pré-remplie, cliquez **Suivant**
5. Étape ⑤ : cliquez **▶ Lancer l'audit**
6. Étape ⑥ : vérifiez que les anomalies listées ci-dessus sont détectées

---

*DataAuditor v3.0 — [Signaler un problème](https://github.com/anthropics/claude-code/issues)*
