---
tags: [spec, dataauditor]
updated: 2026-03-19
---

# DataAuditor — Spécification fonctionnelle

**Version de référence : v3.0.0**

---

## Introduction

DataAuditor est un serveur Flask + UI web permettant de comparer deux fichiers de données hétérogènes et de détecter des écarts selon une configuration YAML. Le flux de résultats est diffusé en Server-Sent Events (SSE) pendant le traitement.

**Flux principal :**
1. L'utilisateur charge les fichiers source (A = référence, B = cible) et une configuration YAML
2. Le serveur parse les deux sources en DataFrames pandas
3. Un générateur Python effectue la jointure et émet des événements SSE
4. L'UI reçoit les événements et affiche les résultats en temps réel

**Versions de référence :** Python 3.13, Flask 3.0, pandas 2.2.3, js-yaml 4.1.0

---

## Schéma de données

### Structure de configuration YAML

```
config
├── meta
│   ├── name: string
│   └── version: string
├── sources
│   ├── reference: SourceConfig
│   └── target: SourceConfig
├── join
│   └── keys[]: { source_field, target_field }
├── filters[]: { field, source, values[] }
├── rules[]: RuleConfig
├── comparison (legacy)
│   ├── fields[]: FieldRule
│   └── ignore_fields[]
└── report
    ├── show_matching: bool
    └── max_diff_preview: int
```

#### SourceConfig

| Champ | Type | Défaut | Description |
|---|---|---|---|
| `format` | enum | — | `csv`, `txt`, `dat`, `json`, `xlsx` |
| `label` | string | — | Libellé affiché dans l'UI |
| `encoding` | string | `utf-8` | Encodage du fichier |
| `delimiter` | string | `;` | Séparateur (CSV/TXT/DAT) |
| `has_header` | bool | `true` | Première ligne = en-tête |
| `skip_rows` | int | `0` | Lignes à ignorer avant l'en-tête |
| `fixed_width` | bool | `false` | Format positionnel |
| `record_filter.marker` | regex | — | Filtre de lignes avant parsing |
| `max_columns` | int | — | Limite de split des colonnes |
| `sheet_name` | string | première feuille | XLSX uniquement |
| `fields[]` | Field[] | — | Colonnes (CSV/TXT/DAT) |
| `column_positions[]` | ColumnPos[] | — | Colonnes positionnelles |
| `unpivot` | UnpivotConfig | — | Dépivotage |

#### Field / ColumnPos

| Champ | Type | Description |
|---|---|---|
| `name` | string | Nom de la colonne |
| `type` | enum | `string`, `integer`, `decimal`, `date`, `boolean` |
| `date_format` | string | Format strftime (requis si `type: date`) |
| `position` | int | *(ColumnPos)* Position 0-indexée |
| `width` | int | *(ColumnPos)* Largeur en caractères |

#### RuleConfig

| Champ | Type | Défaut | Description |
|---|---|---|---|
| `name` | string | — | Identifiant unique de la règle |
| `logic` | enum | `AND` | `AND` ou `OR` |
| `rule_type` | enum | `coherence` | `coherence` (vert) ou `incoherence` (rouge) |
| `fields[]` | FieldRule[] | — | Conditions de la règle |

#### FieldRule

| Champ | Type | Description |
|---|---|---|
| `source_field` | string | Champ source (syntaxe courte) |
| `target_field` | string | Champ cible (défaut = `source_field`) |
| `target_value` | any | Valeur fixe côté cible |
| `operator` | enum | `equals`, `differs`, `greater`, `less`, `contains`, `not_contains` |
| `tolerance` | number | Tolérance numérique |
| `normalize` | enum | `none`, `lowercase`, `trim`, `both` |
| `source_data` | object | Syntaxe longue — données source |
| `target_data` | object | Syntaxe longue — données cible |

#### Événements SSE

| Événement | Champs | Description |
|---|---|---|
| `progress` | `done`, `total`, `pct`, `step` | Avancement |
| `filter_counts` | `ref_count`, `tgt_count` | Tailles après filtrage |
| `result` | `join_key`, `type_ecart`, `rule_name`, `champ`, `valeur_reference`, `valeur_cible`, `detail` | Ligne d'écart |
| `summary` | `total_reference`, `total_cible`, `orphelins_a`, `orphelins_b`, `divergents`, `ok`, `rule_stats` | Récapitulatif final |
| `done` | `history_file`, `total_results` | Fin du traitement |
| `error` | `message` | Erreur fatale |

---

## Règles de gestion

### RG-NAV — Navigation

#### RG-NAV-01 — Déblocage progressif des étapes

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Les étapes du workflow se déverrouillent progressivement selon l'avancement de l'utilisateur.

**Algorithme :**
```
wfUnlocked = 1 au démarrage (⓪ et ① accessibles)
Après chargement fichier référence → wfUnlocked = max(wfUnlocked, 2)
Après chargement fichier cible     → wfUnlocked = max(wfUnlocked, 3)
Navigation manuelle ③→④→⑤         → wfUnlocked = max(wfUnlocked, n+1)
Après audit terminé                → wfUnlocked = 6
Étape ⓪ (Config) : toujours accessible
Étape ⑦ (Historique) : toujours accessible via onglet
```

#### RG-NAV-02 — Sauvegarde automatique de l'étape courante

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Avant toute navigation entre étapes, l'état du formulaire courant est sauvegardé dans l'état interne `WS`.

**Algorithme :**
```
goWFStep(n) → _saveCurrentWFStep()
_saveCurrentWFStep :
  wfCurrentStep === 1 → wizReadSourceForm('reference')
  wfCurrentStep === 2 → wizReadSourceForm('target')
  wfCurrentStep === 3 → wizReadJoinForm()
  wfCurrentStep === 4 → wizReadRulesForm()
  wfCurrentStep === 5 → wizReadFiltersForm()
```

---

### RG-SRC — Sources

#### RG-SRC-01 — Auto-détection des colonnes CSV

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Lors du chargement d'un fichier CSV/TXT/DAT avec en-tête, les colonnes sont détectées automatiquement à partir des 32 Ko du fichier.

**Algorithme :**
```
Si format ∈ {csv, txt, dat} ET has_header = true ET fixed_width = false :
  Lire les 32 premiers Ko du fichier
  Extraire la ligne d'en-tête (après skip_rows lignes)
  Splitter sur delimiter → noms de colonnes
  Peupler WS.sources[srcKey].fields avec type: 'string' par défaut
  Re-rendre le formulaire de colonnes
```

#### RG-SRC-02 — Dépivotage (unpivot)

| Métadonnée | Valeur |
|---|---|
| Commit | `v2.x` |
| Tests | `test_unpivot.yaml` |

**Résumé :** Une source au format large (1 colonne par dépôt) peut être transformée en format long (1 ligne par dépôt) avant la jointure.

**Algorithme :**
```
Pour chaque pivot_field { source, location } :
  Pour chaque ligne du DataFrame :
    Créer une nouvelle ligne avec :
      colonnes anchor_fields inchangées
      location_field = location
      value_field = valeur de la colonne source
Résultat : N lignes × P pivot_fields lignes
La jointure doit inclure location_field comme clé
```

#### RG-SRC-03 — Validation des colonnes

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Le bouton "Vérifier les colonnes" compare les colonnes déclarées dans la configuration avec celles détectées dans le fichier.

**Algorithme :**
```
Pour chaque colonne déclarée :
  OK  : colonne trouvée dans le fichier, position/largeur compatibles
  WARN: colonne déclarée manquante dans le fichier
  ERR : incompatibilité de position ou largeur (fixed_width)
Afficher un badge ✓ (vert) ou ⚠ (orange) sur le bouton
```

---

### RG-JOIN — Jointure

#### RG-JOIN-01 — Construction des index de jointure

| Métadonnée | Valeur |
|---|---|
| Commit | `v2.x` |
| Tests | — |

**Résumé :** La jointure est réalisée par construction d'une table de hachage (dict Python) sur les clés définies.

**Algorithme :**
```
Clé de jointure = "§".join(str(row[col]).strip() for col in key_cols)
En cas de doublon : seule la première occurrence est conservée (first-match)
Trois ensembles :
  ref_keys  = clés présentes dans la référence
  tgt_keys  = clés présentes dans la cible
  all_keys  = ref_keys ∪ tgt_keys (triées)
```

#### RG-JOIN-02 — Détection des orphelins

| Métadonnée | Valeur |
|---|---|
| Commit | `v2.x` |
| Tests | — |

**Résumé :** Toute clé présente dans une seule source génère un événement orphelin.

**Algorithme :**
```
clé ∈ ref_keys ET ∉ tgt_keys → ORPHELIN_A
clé ∈ tgt_keys ET ∉ ref_keys → ORPHELIN_B
```

---

### RG-RULE — Règles de contrôle

#### RG-RULE-01 — Évaluation d'une règle

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Une règle est évaluée champ par champ. Le résultat global (KO/OK) dépend du nombre de champs en écart et de la logique (AND/OR).

**Algorithme :**
```
field_diffs = [champs dont _values_differ() retourne True]
n_fail = len(field_diffs)

Si logic == "AND" : rule_ko = (n_fail > 0)
Si logic == "OR"  : rule_ko = (n_fail > 0)   # même comportement v3

Si rule_ko :
  → Émettre un événement result KO pour chaque champ en écart
  → Incrémenter rule_ko_keys[rule.name]
Sinon et show_matching :
  → Émettre un événement result OK avec détail "conforme" ou "aucune incohérence"
```

#### RG-RULE-02 — Sémantique des opérateurs

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Tous les opérateurs suivent la sémantique mathématique : `_values_differ()` retourne `True` quand la condition est vraie (et non quand elle est violée).

**Algorithme :**
```
equals      : True si A ≠ B (les valeurs diffèrent)
differs     : True si A = B (les valeurs sont identiques → incohérence)
greater     : True si float(A) > float(B)
less        : True si float(A) < float(B)
contains    : True si str(B) ∈ str(A)
not_contains: True si str(B) ∉ str(A)

Cas nuls (None, NaN, "", "nan", "NaT", "<NA>") :
  equals : null ≠ null → False ; null ≠ non-null → True
  autres : null → False (condition non évaluable)

Tolérance (uniquement pour equals) :
  True si |float(A) - float(B)| > tolerance
```

#### RG-RULE-03 — Alias d'opérateurs (compatibilité ascendante)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Les anciens symboles d'opérateurs (`=`, `<>`, `>`, `<`) sont normalisés en labels textuels avant évaluation.

**Algorithme :**
```
_OP_ALIAS = { "=": "equals", "<>": "differs", ">": "greater", "<": "less" }
op = _OP_ALIAS.get(operator, operator)
```

#### RG-RULE-04 — rule_type : logique KO/OK différenciée

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Le `rule_type` détermine si une règle peut produire un KO. Une règle `coherence` ne produit jamais de KO ; une règle `incoherence` produit KO dès qu'un écart est détecté.

**Algorithme :**
```
n_fail = nombre de champs en écart dans la règle

si rule_type == "incoherence" :
  rule_ko = n_fail > 0
  → KO si au moins un champ diffère
  → OK si aucun écart (et show_matching)

si rule_type == "coherence" :
  rule_ko = False  (jamais KO)
  → OK uniquement si n_fail == 0 et show_matching

Affichage UI :
  coherence   → chip verte, libellé "Cohérence"
  incoherence → chip rouge, libellé "Incohérence"
```

---

### RG-YAML — Configuration YAML

#### RG-YAML-01 — Parsing YAML avec opérateur `=` natif

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** PyYAML (1.1) traite le scalaire `=` comme `tag:yaml.org,2002:value`, ce qui provoque une erreur avec `SafeLoader`. Un chargeur personnalisé normalise ce token en chaîne `"="`.

**Algorithme :**
```python
class _Loader(yaml.SafeLoader): pass
_Loader.add_constructor("tag:yaml.org,2002:value", lambda l, n: "=")
config = yaml.load(yaml_text, Loader=_Loader)
```

#### RG-YAML-02 — Génération YAML depuis l'UI

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** `wizBuildYaml()` génère le YAML de configuration à partir de l'état interne `WS`. L'opérateur est toujours écrit explicitement dans les règles (même pour `equals`) pour garantir le round-trip stable.

**Algorithme :**
```
Pour chaque champ d'une règle :
  o.operator = op   # toujours écrit, jamais omis
jsyaml.dump() cite automatiquement "=" entre guillemets → valide YAML
```

#### RG-YAML-03 — Normalisation des opérateurs à l'import

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Lors du chargement d'un fichier YAML dans l'UI, les anciens symboles d'opérateurs sont normalisés en labels textuels.

**Algorithme :**
```javascript
const _OP_ALIAS = {'=':'equals','<>':'differs','>':'greater','<':'less'};
const _normOp = op => _OP_ALIAS[op] || op || 'equals';
```

---

### RG-FILT — Filtres résultats

#### RG-FILT-01 — Barre de filtres

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** La barre de filtres permet de masquer/afficher les résultats par type d'orphelin et par règle (individuelle ou groupe par `rule_type`).

**Algorithme :**
```
activeFilters = Set{'ORPHELIN_A', 'ORPHELIN_B'}   // orphelins toujours visibles par défaut
activeRuleFilters = null                           // null = toutes les règles visibles

appendRow(r) :
  Si ORPHELIN_A|B ET ∉ activeFilters → masquer
  Si activeRuleFilters ≠ null ET r.rule_name ∉ activeRuleFilters → masquer
  Sinon → afficher
```

#### RG-FILT-02 — Isolation d'une règle (solo)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** Un clic sur le nom d'une règle dans le tableau isole les résultats de cette règle. Un second clic restaure l'affichage complet.

**Algorithme :**
```
filterToRule(name) :
  isSolo = (activeRuleFilters.size === 1 ET activeRuleFilters.has(name))
  Si isSolo → activeRuleFilters = Set(toutes les règles)   // toggle off
  Sinon     → activeRuleFilters = Set{name}                // isoler
  Sync chips UI + rebuildTable()
```

---

### RG-SSE — Streaming

#### RG-SSE-01 — Architecture SSE

| Métadonnée | Valeur |
|---|---|
| Commit | `v2.x` |
| Tests | — |

**Résumé :** Chaque audit s'exécute dans un thread daemon séparé. Les résultats sont mis en queue et consommés par le générateur SSE Flask.

**Algorithme :**
```
POST /api/audit → crée session (token UUID) + lance thread
GET  /api/stream/<token> → consomme queue.get() → émission SSE
Session expirée après 1h (cleanup automatique)
Format SSE : data: <json>\n\n
```

#### RG-SSE-02 — Progression

| Métadonnée | Valeur |
|---|---|
| Commit | `v2.x` |
| Tests | — |

**Résumé :** Un événement `progress` est émis au maximum tous les 0,5% d'avancement (BATCH = total // 200).

**Algorithme :**
```
BATCH = max(1, total // 200)
Si i % BATCH == 0 ou i == total-1 :
  yield { event: "progress", done: i+1, total, pct, step }
```

---

### RG-EXPORT — Exports

#### RG-EXPORT-01 — Export CSV

| Métadonnée | Valeur |
|---|---|
| Commit | `v2.x` |
| Tests | — |

**Résumé :** L'export CSV produit un fichier UTF-8 avec BOM (utf-8-sig) compatible Excel, contenant toutes les colonnes de résultat.

**Algorithme :**
```
Colonnes : join_key, type_ecart, rule_name, champ, valeur_reference, valeur_cible, detail
Encodage : utf-8-sig
Séparateur : ,
Content-Disposition : attachment; filename="audit_<timestamp>.csv"
```

#### RG-EXPORT-02 — Historisation

| Métadonnée | Valeur |
|---|---|
| Commit | `v2.x` |
| Tests | — |

**Résumé :** À la fin de chaque audit, un fichier JSON est créé dans `reports/` avec les métadonnées et les résultats.

**Algorithme :**
```
Fichier : reports/audit_<YYYYMMDD_HHMMSS>.json
Contenu : { timestamp, config_name, summary, results[] }
Accessible via GET /api/history et GET /api/history/<filename>
```
