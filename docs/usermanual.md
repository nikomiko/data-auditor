---
title: Manuel utilisateur
nav_order: 2
---

# DataAuditor — Manuel utilisateur

**v4.1.0**

---

## Sommaire

1. [Démarrage rapide](#1-démarrage-rapide)
2. [Installation](#2-installation)
3. [Fonctionnalités principales](#3-fonctionnalités-principales)
4. [Workflow — vue d'ensemble](#4-workflow--vue-densemble)
5. [Écran des résultats](#5-écran-des-résultats)
6. [Référence des fonctionnalités](#6-référence-des-fonctionnalités)

---

## 1. Démarrage rapide

Une fois le serveur lancé, ouvrez **http://localhost:5000** dans votre navigateur.

**En 5 minutes :**

1. **⓪ Config** — chargez un fichier `.yaml` existant pour pré-remplir toutes les étapes *(ou ignorez et configurez manuellement)*
2. **① Datasets** — déposez votre fichier de référence (Source A) et votre fichier cible (Source B)
3. **② Jointure** — définissez les colonnes qui relient les deux sources
4. **③ Règles** — ajoutez les contrôles à appliquer sur les enregistrements appariés
5. **④ Filtres** — affinez l'audit si nécessaire, puis cliquez **▶ Lancer l'audit**

Les résultats s'affichent en temps réel. Exportez en CSV, XLSX ou HTML depuis la barre d'actions.

**Tester avec les fichiers exemples :** chargez `test_audit_demo.yaml`, `test_reference.dat`, `test_target.csv` (bouton *Exemples* disponible à l'étape ⓪).

---

## 2. Installation

### Linux / macOS

```bash
bash install.sh
bash run.sh
```

### Windows

Double-cliquez sur `install.bat`, puis `run.bat`.

Le script installe Python 3.10+, crée l'environnement `.venv/` et installe les dépendances.

### Lancement manuel

```bash
source .venv/bin/activate    # Windows : .venv\Scripts\activate
cd src
python server.py
# → http://localhost:5000
```

### Persistance de session

La configuration YAML et les noms de fichiers sont sauvegardés automatiquement dans le navigateur et restaurés à la prochaine ouverture.

---

## 3. Fonctionnalités principales

| Fonctionnalité | Description |
|---|---|
| **Formats** | CSV/TXT délimité, positionnel, JSON, JSONL, XLSX |
| **Jointure composite** | Plusieurs colonnes clés, noms différents par source |
| **Règles de contrôle** | Comparaison par champ avec opérateurs, tolérance, normalisation |
| **Deux types de règle** | `incoherence` (détecter les écarts) / `coherence` (confirmer la conformité) |
| **Détection de présence** | Orphelins source (ORPHELIN_A) et cible (ORPHELIN_B) automatiques |
| **Filtres de données** | Restriction de l'audit à un sous-ensemble avant la jointure |
| **Champs calculés** | Expressions pandas/numpy par source (somme, arrondi, concaténation…) |
| **Dépivotage** | Transformation format large → long avant comparaison |
| **Résultats en streaming** | Affichage temps réel via SSE, une ligne par clé |
| **Colonnes supplémentaires** | Données brutes ref/cible affichées à côté des résultats |
| **Revue côte à côte** | Détail d'un enregistrement avec mise en évidence des champs concernés |
| **Exports** | CSV (pivot-friendly), XLSX (coloré, autofiltre), HTML (interactif, autonome) |
| **Historique** | Conservation et consultation des audits passés |

---

## 4. Workflow — vue d'ensemble

DataAuditor guide l'utilisateur à travers **6 étapes** numérotées ⓪ → ⑤ dans le bandeau supérieur. Les étapes se déverrouillent au fur et à mesure.

```
⓪ Config → ① Datasets → ② Jointure → ③ Règles → ④ Filtres → ⑤ Résultats
```

### ⓪ Config

Point d'entrée optionnel. Chargez un fichier YAML existant pour pré-remplir automatiquement toutes les étapes. Permet de réutiliser des configurations existantes sans tout reconfigurer.

Accessible également via **`</> YAML`** dans la barre d'actions pour éditer le YAML généré à tout moment.

### ① Datasets

Chargement et configuration des deux sources de données. Pour chaque source :
- Déposez le fichier ou cliquez pour parcourir
- Donnez-lui un nom (affiché dans les résultats et exports)
- Configurez le format : délimiteur, encodage, colonnes, types

### ② Jointure

Définissez les paires de colonnes qui relient les enregistrements des deux sources. Une clé composite (plusieurs colonnes) est supportée. Le bouton **Tester la jointure** donne un aperçu du taux de couverture avant l'audit complet.

### ③ Règles

Définissez les contrôles à appliquer sur les enregistrements appariés (présents dans les deux sources). Chaque règle compare un ou plusieurs couples de champs. Les contrôles de présence (orphelins) sont automatiques et ne nécessitent pas de règle.

### ④ Filtres & Rapport

Affinez l'audit :
- **Filtres** : restreignez l'audit à un sous-ensemble de lignes par valeur de champ
- **Options rapport** : activez l'affichage des conformités (`show_matching`)
- **Méta** : nommez et versionnez la configuration

Cliquez **▶ Lancer l'audit** pour démarrer.

### ⑤ Résultats

Affichage en temps réel des écarts détectés. Une ligne par clé de jointure. Filtres interactifs, colonnes supplémentaires, revue côte à côte, exports.

---

## 5. Écran des résultats

### Barre de synthèse

Une ligne affichant en permanence :

```
[Titre de l'audit]  Source A : N enr. dont X absents de la cible  |  Source B : N enr. dont Y absents de la source  |  N KO  |  N OK  |  N lignes affichées
```

Le compteur **"N lignes affichées"** est mis à jour en temps réel selon les filtres actifs.

### Barre de filtres

**Présence** (boutons statiques à gauche) :

| Chip | Lignes incluses |
|---|---|
| *[Source A] uniq.* | Enregistrements présents dans A, absents de B (ORPHELIN_A) |
| *[Source B] uniq.* | Enregistrements présents dans B, absents de A (ORPHELIN_B) |
| **Clé OK** | Clés appariées sans aucune règle déclenchée |

**Règles** (chips dynamiques, une par règle configurée) :
- Fond **vert** = règle de cohérence · Fond **rouge** = règle d'incohérence
- Cliquer sur un chip active/désactive le filtre pour cette règle
- Cliquer sur un **badge dans le tableau** isole cette règle (un seul clic = solo, deuxième clic = tout réactiver)

**Bouton AND / OR** : contrôle la logique entre les chips de règle.
- `OR` *(défaut)* : affiche les lignes où **au moins une** règle sélectionnée est déclenchée
- `AND` : affiche uniquement les lignes où **toutes** les règles sélectionnées sont déclenchées simultanément

**Recherche** : filtre full-text sur la clé, les noms de règles, et les colonnes supplémentaires affichées.

### Tableau

Une ligne par clé de jointure. Colonnes :

| Colonne | Description |
|---|---|
| 👁 | Ouvre la revue côte à côte |
| *Clé(s)* | Valeur(s) de la clé de jointure (une colonne par champ) |
| **Règles** | Badges colorés des règles déclenchées sur cette clé. Survolez un badge pour voir les valeurs réf./cible impliquées. |
| *Colonnes supplémentaires* | Champs bruts ajoutés via le sélecteur (voir ci-dessous) |

Les **badges grisés** correspondent aux règles non sélectionnées dans les filtres actifs.

### Sélecteur de colonnes

Bouton **Colonnes** (en haut à droite du tableau) : ajoutez des champs bruts de la source A ou B comme colonnes supplémentaires.

- Les colonnes affichent le fichier source et le format en sous-titre, le nom du champ en gras
- **Redimensionnables** : glissez le bord droit de l'en-tête
- **Réordonnables** : glissez-déposez les en-têtes pour changer l'ordre — le mélange source A / source B est libre
- L'ordre est conservé dans les exports HTML

### Revue côte à côte (👁)

Panneau modal affichant l'enregistrement complet d'une clé :
- **En-tête** : clé + badges des règles déclenchées (cliquables pour filtrer la mise en évidence)
- **Deux colonnes** : valeurs source A (gauche) et source B (droite)
- **Fond coloré** sur les champs impliqués dans une règle active
- **Points colorés** identifient la règle liée à chaque champ
- **Contexte** : lignes voisines (0–10) affichées en dessous, réglables

### Mode plein écran

Bouton ⛶ (coin supérieur droit du tableau) : masque la navigation et la barre de filtres pour maximiser l'espace de lecture. Cliquez à nouveau pour revenir à la vue normale.

### Pagination

Navigation par pages côté serveur. Indicateur de page et navigation en bas du tableau.

---

## 6. Référence des fonctionnalités

---

### ⓪ Config — Chargement YAML

Glissez-déposez un fichier `.yaml` / `.yml` dans la zone de l'étape ⓪. Toutes les étapes suivantes sont pré-remplies automatiquement.

> Les fichiers encodés en Windows-1252 sont détectés automatiquement.

---

### ⓪ Config — Bibliothèque de configurations

Si un dossier de configurations est défini dans les **Paramètres**, les fichiers YAML qu'il contient apparaissent dans la bibliothèque (section dépliable sous la zone de dépôt). Recherchez par nom de fichier.

---

### ⓪ Config — Éditeur YAML

Le bouton **`</> YAML`** (barre d'actions, en haut) ouvre l'éditeur brut. Toute modification est répercutée dans le wizard. Le bouton **💾 Sauvegarder** écrit le fichier YAML directement sur disque si le handle de fichier est disponible (Chrome/Edge via File System Access API).

---

### ① Datasets — Formats de fichiers

| Format | Extensions | Notes |
|---|---|---|
| CSV délimité | `.csv`, `.txt`, `.dat` | Délimiteur configurable (`;`, `,`, `\t`, `\|`…) |
| Positionnel | `.csv`, `.txt`, `.dat` | Colonnes à largeur fixe, positions 1-indexées |
| JSON | `.json` | Objet ou tableau racine, `json_path` pour tableau imbriqué |
| JSONL | `.jsonl` | Une ligne = un enregistrement JSON |
| Excel | `.xlsx` | Colonnes auto-détectées, `sheet_name` optionnel |

---

### ① Datasets — Configuration CSV

| Paramètre | Description |
|---|---|
| `delimiter` | Séparateur de colonnes |
| `encoding` | `utf-8`, `utf-8-sig`, `windows-1252`, `latin-1` |
| `has_header` | Première ligne = noms de colonnes |
| `skip_rows` | Nombre de lignes à ignorer avant l'en-tête |
| `record_filter.marker` | Regex : ne conserver que les lignes correspondantes |
| `max_columns` | Limite le nombre de colonnes lors du split |

**Mapping des colonnes :**
- Si tous les noms déclarés correspondent à l'en-tête → mapping par nom (sous-ensemble possible)
- Sinon → mapping positionnel (dans l'ordre des colonnes du fichier)

---

### ① Datasets — Format positionnel

Sélectionnez **Positionnel** dans le wizard. Chaque champ déclare sa position (1-indexée) et sa largeur :

```yaml
fixed_width: true
column_positions:
  - { name: SKU,  position: 8,  width: 10, type: string  }
  - { name: Qty,  position: 39, width: 7,  type: integer }
  - { name: skip, position: 18, width: 5,  type: skip    }
```

Le type `skip` lit le champ sans le normaliser ni le comparer (utile pour ne pas décaler les positions).

---

### ① Datasets — JSON et JSONL

```yaml
format: json
json_path: data.records    # chemin vers le tableau (auto-détecté si absent)
fields:
  - { name: id }
  - { name: customer_name, path: customer.name }   # champ imbriqué
  - { name: amount, type: decimal }
```

- `json_path` : chemin dot-notation vers le tableau d'enregistrements (ex. `payload.items`)
- `path` par champ : extraction d'un champ imbriqué dans chaque enregistrement
- Si aucun champ n'est déclaré, toutes les colonnes sont chargées

JSONL : même configuration, sans `json_path` (chaque ligne est déjà un enregistrement).

---

### ① Datasets — Types de champs

| Type | Description |
|---|---|
| `string` | Texte (défaut) |
| `integer` | Entier |
| `decimal` | Décimal |
| `date` | Date — nécessite `date_format` (syntaxe strftime : `%Y-%m-%d`, `%d/%m/%Y`…) |
| `boolean` | Booléen |
| `skip` | Lu mais ignoré |

---

### ① Datasets — Détection automatique

Le bouton **🔍 Détecter la structure** lit l'en-tête du fichier et propose la liste des colonnes. Pour JSON, il explore le premier enregistrement et propose les champs imbriqués avec leur `path`.

---

### ① Datasets — Prévisualisation et vérification

- **👁 Prévisualiser** : affiche les premières lignes brutes, les colonnes parsées, et le résultat du dépivotage si configuré
- **✓ Vérifier les colonnes** : valide que les champs déclarés existent bien dans le fichier chargé

---

### ① Datasets — Champs calculés

Colonnes synthétiques créées à partir d'expressions pandas/numpy, évaluées après normalisation :

```yaml
calculated_fields:
  - { name: total_qty,   expression: "qty_a + qty_b",      type: integer }
  - { name: price_ttc,   expression: "price * 1.20",        type: decimal }
  - { name: code_clean,  expression: "code.str.strip()",    type: string  }
  - { name: qty_safe,    expression: "qty.fillna(0)",        type: integer }
```

Les champs calculés sont utilisables dans les règles, les filtres et les colonnes supplémentaires.

---

### ① Datasets — Dépivotage (unpivot)

Transforme un format **large** (N colonnes → N lignes) avant la comparaison :

```yaml
fields:
  - { name: SKU, type: string }
  - { name: qty_A, type: integer }
  - { name: qty_B, type: integer }
unpivot:
  anchor_fields: [SKU]          # colonnes conservées telles quelles
  location_field: depot         # nouvelle colonne : identifiant de la colonne pivotée
  value_field: qty              # nouvelle colonne : valeur dépivotée
  pivot_fields:
    - { source: qty_A, location: depot_A }
    - { source: qty_B, location: depot_B }
```

Incluez `location_field` dans `join.keys` pour la jointure.

---

### ② Jointure — Clés

Définissez une ou plusieurs paires source/cible. Les noms de colonnes peuvent différer entre les deux sources :

```yaml
join:
  keys:
    - { source_field: SKU,  target_field: sku  }
    - { source_field: Site, target_field: site }
```

---

### ② Jointure — Test de jointure

Le bouton **Tester la jointure** (étape ②) affiche sans lancer l'audit complet :
- Nombre d'enregistrements appariés
- Nombre d'orphelins A et B
- Taux de couverture

---

### ③ Règles — Structure

Chaque règle déclare :

| Paramètre | Valeurs | Description |
|---|---|---|
| `name` | texte libre | Nom affiché dans les résultats |
| `rule_type` | `incoherence` / `coherence` | Logique KO/OK (voir ci-dessous) |
| `logic` | `AND` / `OR` | Condition entre les champs de la règle |
| `fields` | liste | Champs comparés |

---

### ③ Règles — Types

| `rule_type` | KO quand… | Couleur badge |
|---|---|---|
| `incoherence` | La condition est **vraie** (ex. A ≠ B) | Rouge |
| `coherence` | La condition est **fausse** (ex. A ≠ B alors qu'on attend A = B) | Vert |

---

### ③ Règles — Opérateurs

| Opérateur | Condition vraie quand… |
|---|---|
| `equals` | A = B |
| `differs` | A ≠ B |
| `greater` | A > B |
| `less` | A < B |
| `contains` | B est contenu dans A |
| `not_contains` | B n'est pas contenu dans A |

---

### ③ Règles — Options par champ

**Tolérance numérique :**
```yaml
- source_field: Prix
  target_field: prix
  operator: equals
  tolerance: 0.05    # écart acceptable ±0,05
```

**Normalisation textuelle :**
```yaml
- source_field: Libelle
  target_field: libelle
  normalize: both    # none | lowercase | trim | both
```

**Valeur fixe (sans champ cible) :**
```yaml
- source_data:
    field: Statut
  target_data:
    value: "ACTIF"
```

---

### ③ Règles — Couleurs

Chaque règle reçoit automatiquement une couleur unique (10 couleurs cycliques). Cette couleur est cohérente entre les badges du tableau, les chips de filtre et les points dans la revue côte à côte.

---

### ④ Filtres

Restreignent l'audit à un sous-ensemble de lignes **avant la jointure**. Les orphelins restent détectables même après filtrage.

```yaml
filters:
  - field: Site
    source: reference    # reference | target
    operator: equals
    value: PAR
```

Opérateurs disponibles : `equals`, `differs`, `contains`, `not_contains`, `greater`, `less`.

---

### ④ Rapport

| Option | Description |
|---|---|
| `show_matching: true` | Inclut les lignes conformes (KO = 0) dans les résultats |
| `max_diff_preview: 500` | Limite le nombre de résultats paginés dans l'UI |

---

### ⑤ Exports

Les boutons CSV, XLSX et HTML apparaissent dans la barre d'actions à l'étape ⑤.

| Format | Contenu | Filtres appliqués |
|---|---|---|
| **CSV** | Tous les résultats, une ligne par écart, encodage UTF-8 BOM | Aucun — export complet |
| **XLSX** | Feuille DATA (colorée, autofiltre) | Aucun — export complet |
| **HTML** | Rapport interactif autonome (chips, recherche, tri) — fonctionne sans serveur | Filtres actifs au moment de l'export |

L'export **HTML** reproduit la vue courante :
- Une ligne par clé de jointure avec badges de règles
- Colonnes supplémentaires dans l'ordre configuré
- Chips de filtre, recherche et compteur de lignes dynamiques
- Cartes de synthèse par règle (KO/OK)

---

### ⑥ Historique

L'onglet **Historique** (barre de navigation) liste les audits enregistrés dans `reports/`. Pour chaque audit :
- Date, nom, durée, nombre de résultats
- Rechargement de la vue résultats
- Comparaison delta entre deux audits (sélectionnez-en deux, cliquez **⇄ Comparer**)
- Suppression individuelle ou purge en masse

---

### Barre d'actions (persistante)

Visible sur toutes les étapes :

| Élément | Description |
|---|---|
| **💾** | Sauvegarder le YAML (écrase le fichier source si disponible) |
| **Save As…** | Sauvegarder sous un nouveau nom |
| **`</> YAML`** | Ouvrir l'éditeur YAML brut |
| *Nom du fichier config* | Affiché en permanence |
| *Pills fichiers* | Noms des fichiers source A et B chargés |
| **CSV / HTML / XLS** | Exports (visibles à l'étape ⑤ uniquement) |

---

### Paramètres

Accessibles via l'icône ⚙ (barre d'actions) :

| Paramètre | Description |
|---|---|
| Dossier de configurations | Chemin vers un dossier de fichiers YAML (alimente la bibliothèque ⓪) |
| Dossier d'exports | Chemin où copier automatiquement les exports générés |

---

*DataAuditor v4.1.0 — [Signaler un problème](https://github.com/nikomiko/data-auditor/issues)*
