---
tags: [spec, dataauditor]
updated: 2026-03-28
---

# DataAuditor — Spécification fonctionnelle

**Version de référence : v3.7.0**

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
| `calculated_fields[]` | CalcFieldDef[] | — | Colonnes virtuelles calculées (évaluées après normalisation) |

#### CalcFieldDef

| Champ | Type | Description |
|---|---|---|
| `name` | string | Nom de la colonne virtuelle résultante |
| `formula` | string | Expression Python/pandas. Les colonnes de la source sont des variables. `np` (numpy) est disponible. |

**Exemples de formules :**

```yaml
calculated_fields:
  - name: total_ttc
    formula: "Qty * Prix * 1.2"
  - name: has_stock
    formula: "np.where(Qty > 0, 1, 0)"        # IF vectorisé
  - name: ecart_prix
    formula: "Prix - PrixMinimum"              # comparaison intra-source
  - name: weighted_avg
    formula: "(Qty * Prix).sum() / Qty.sum()"  # agrégat → broadcasté
```

**Fonctions disponibles :** `np.*`, `abs`, `round`, `where`, `clip`, `sqrt`, `log`, `exp`, `str`, `int`, `float`, `bool`, `len`

**Pipeline :** les champs calculés sont évalués après `normalize_dataframe` et avant `apply_filters`. Les colonnes calculées précédentes sont accessibles dans les formules suivantes. Les champs calculés sont utilisables dans les règles comme n'importe quel champ.

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

#### RG-SRC-04 — Champs calculés

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.30.0` |
| Tests | — |

**Résumé :** Des colonnes virtuelles peuvent être définies par source, via des expressions Python/pandas évaluées après normalisation. Elles sont utilisables dans les filtres et les règles comme tout autre champ.

**Algorithme :**
```
Pour chaque calculated_field (dans l'ordre de déclaration) :
  ns = { col: df[col] for col in df.columns }
  ns += { np, abs, round, where, clip, sqrt, log, exp, str, int, float, bool, len }
  ns["__builtins__"] = {}   # pas d'accès système
  result = eval(formula, ns)
  Si result est une Series → df[name] = result.values
  Si result est un scalaire → df[name] = result  (broadcast)
  Si eval() lève une exception → ConfigError avec message lisible

Les champs calculés déclarés avant sont accessibles dans les formules suivantes.
Évaluation : après normalize_dataframe, avant apply_filters.

Validation syntaxique : /api/validate applique evaluate_calculated_fields sur le fichier
réel → erreur de formule remontée avant le lancement de l'audit.
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

**Résumé :** Une règle est "passante" quand ses champs satisfont la condition de l'opérateur selon la logique AND/OR. Le `type_ecart` émis dépend du `rule_type`.

**Algorithme :**
```
field_evals = [(resolved, check_field_condition(resolved)) pour chaque champ]
n_pass  = nombre de champs dont la condition est satisfaite
n_total = nombre de champs évalués

Si logic == "AND" : rule_passes = (n_pass == n_total)   # toutes les conditions satisfaites
Si logic == "OR"  : rule_passes = (n_pass > 0)           # au moins une condition satisfaite

Si rule_passes :
  type_ecart = "KO" si rule_type == "incoherence", sinon "OK"
  → Émettre un événement result pour chaque champ dont la condition est satisfaite
  → Si type_ecart == "KO" : incrémenter rule_ko_keys[rule.name]

Sinon et show_matching :
  → Émettre un événement result résumé (règle non passante)
```

#### RG-RULE-02 — Sémantique des opérateurs

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.0.0` |
| Tests | — |

**Résumé :** `check_field_condition()` retourne `True` quand la condition mathématique de l'opérateur est **satisfaite**.

**Algorithme :**
```
equals      : True si A = B
differs     : True si A ≠ B
greater     : True si float(A) > float(B)
less        : True si float(A) < float(B)
contains    : True si str(B) ∈ str(A)
not_contains: True si str(B) ∉ str(A)

Cas nuls (None, NaN, "", "nan", "NaT", "<NA>") :
  equals  : null = null → True ; null ≠ non-null → False
  differs : null ≠ null → False ; null ≠ non-null → True
  autres  : null → False (condition non évaluable)

Tolérance :
  equals  : True si |float(A) - float(B)| ≤ tolerance
  differs : True si |float(A) - float(B)| > tolerance
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

**Résumé :** Le `rule_type` détermine le `type_ecart` émis quand une règle est passante. Il détermine également dans quel pill UI les résultats sont affichés.

**Algorithme :**
```
rule_passes = True  (voir RG-RULE-01)

si rule_type == "incoherence" :
  type_ecart = "KO"  → pill "Contrôles KO" (rouge)

si rule_type == "coherence" :
  type_ecart = "OK"  → pill "Contrôles OK" (vert)

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
activeFilters = Set{'BOTH'}    // "Présence dans les deux" sélectionné par défaut (v3.6)
activeRuleFilters = null       // null = toutes les règles visibles

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

---

### RG-RES — Écran résultats (v3.6)

#### RG-RES-01 — Barre de navigation unifiée

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** À partir de la v3.6.0, la barre YAML et la barre de navigation sont fusionnées en une seule barre globale persistante. Les boutons d'export CSV/HTML/XLSX y apparaissent uniquement à l'étape ⑥ (résultats).

**Algorithme :**
```
global-nav-bar contient (gauche → droite) :
  ← Précédent | ① … ⑥ | → Suivant / Lancer
  [separator]
  💾 Sauvegarder | Enregistrer sous… | ‹/› (basculer vue YAML) | <nom config>
  [separator]
  chip ref | chip tgt | message d'erreur wizard
  [spacer flex]
  [boutons export : CSV, HTML, XLSX — visibles uniquement step === 6]

updateGlobalNav(n) :
  n === 6 → exports.style.display = 'flex'
  n ≠ 6  → exports.style.display = 'none'
```

#### RG-RES-02 — Filtre par défaut "Présence dans les deux"

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Au démarrage d'un audit et après réinitialisation, le filtre actif par défaut est `BOTH` (enregistrements présents dans les deux sources), pas les orphelins.

**Algorithme :**
```
Au démarrage de l'audit (client + server) :
  activeFilters = Set{'BOTH'}
  → Seuls les résultats KO/OK sont affichés par défaut
  → Les chips ORPHELIN_A et ORPHELIN_B sont désactivées par défaut
```

#### RG-RES-03 — Chips de règles colorées par rule_type

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Les chips de règles dans la barre de filtres sont colorées selon le `rule_type` de la règle : fond vert pour `coherence`, fond rouge pour `incoherence`. Un point de couleur distinctif identifie chaque règle.

**Algorithme :**
```
ruleType(ruleName) → lastConfig.rules.find(r => r.name === ruleName)?.rule_type || 'incoherence'

Pour chaque chip de règle :
  rule_type === 'coherence'   → classe .cr-coh (fond vert)
  rule_type === 'incoherence' → classe .cr-inc (fond rouge)
  Un cercle coloré (ruleColor()) distingue visuellement chaque règle individuelle
  État non-sélectionné : opacity réduite (dimmed)
```

#### RG-RES-04 — Filtre AND/OR entre règles

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Un bouton toggle entre l'intitulé "Règles" et les chips permet de basculer entre OR (au moins une règle) et AND (toutes les règles sélectionnées).

**Algorithme :**
```
ruleFilterLogic = 'OR'  // défaut

Clic bouton → basculer OR ↔ AND → fetchPage()

Requête API : rule_logic=AND|OR

Côté serveur (key_matches) :
  OR  : au moins un écart de la ligne appartient à active_rules
  AND : active_rules.issubset(matched_rules) — toutes les règles sélectionnées
        présentes dans les écarts de la ligne (les orphelins bypassent cette règle)
```

#### RG-RES-05 — Recherche plein texte

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Le champ de recherche filtre sur l'ensemble des colonnes affichées : clé de jointure, nom de règle, valeurs ref/cible, nom de champ, et valeurs des colonnes supplémentaires.

**Algorithme :**
```
Paramètre API : q=<texte>

Côté serveur (_row_matches_q) :
  Chercher q (insensible à la casse) dans :
    join_key
    Pour chaque écart : rule_name, valeur_reference, valeur_cible, champ
    Pour chaque colonne extra ref  : ref_rows_map[key].get(col)
    Pour chaque colonne extra tgt  : tgt_rows_map[key].get(col)
  Retourne True si trouvé dans au moins un champ
```

#### RG-RES-06 — Colonnes supplémentaires : ordre mixte et en-têtes deux lignes

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Les colonnes supplémentaires ref et cible peuvent être librement mélangées. L'ordre est géré par `_extraColOrder`. Les en-têtes s'affichent sur deux lignes : source (petit, fin) au-dessus, nom du champ (gras) en dessous.

**Algorithme :**
```
_extraColOrder = [{side:'ref'|'tgt', col:string}]

_syncExtraHeaders() :
  1. Purger de _extraColOrder les colonnes décochées
  2. Ajouter en fin les colonnes nouvellement cochées
  3. Pour chaque {side, col} dans _extraColOrder :
     Rendre <th> avec :
       .th-meta  = "<nomFichier> · <format>"  (petit, police fine)
       .th-field = col                         (gras, majuscules)
     Attacher handle de redimensionnement + drag HTML5

Redimensionnement : mousedown sur .col-resize-handle → track deltaX → th.style.width
Réorganisation    : HTML5 drag-and-drop ; cross-side autorisé ; met à jour _extraColOrder
```

#### RG-RES-07 — Mode plein écran résultats

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Un bouton ⛶ dans la colonne de droite des en-têtes permet de basculer un mode plein écran qui masque toutes les zones hors tableau.

**Algorithme :**
```
toggleResultsFS() :
  body.classList.toggle('results-fs')

body.results-fs :
  header               → display:none
  .summary-bar         → display:none
  .filter-bar          → display:none
  #col-picker          → display:none
  .wf-view.active      → height: 100vh (pleine hauteur)
```

---

### RG-CTX — Vue contextuelle (œil)

#### RG-CTX-01 — Enregistrements de contexte

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Le modal de vue contextuelle affiche par défaut 1 enregistrement de contexte avant et après la clé sélectionnée (au lieu de 2 précédemment).

**Algorithme :**
```
Valeur par défaut du champ "Contexte" : 1
Requête API : GET /api/context/{token}/{key}?ctx=1
```

#### RG-CTX-02 — Pills de règles interactives

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.6.0` |
| Tests | — |

**Résumé :** Le header du modal contextuel affiche des pills interactives pour chaque règle déclenchée sur la clé. Sélectionner/désélectionner une pill filtre les bullets et surlignages dans les deux panneaux (ref et cible).

**Algorithme :**
```
openCtxModal(key, ecarts) :
  _ctxActiveRules = Set(tous les rule_name dans ecarts)  // tout sélectionné par défaut
  _ctxEcarts = ecarts (écarts de la ligne)
  Rendre pills :
    ORPHELIN_A|B → badge statique (non interactif)
    KO/OK avec rule_name → <button> pill interactif
      État actif   : fond coloré (vert coherence / rouge incoherence)
      État inactif : bordure seule, texte coloré

_ctxToggleRule(btn, ruleName) :
  Si ruleName ∈ _ctxActiveRules → retirer, inactif
  Sinon                         → ajouter, actif
  Re-rendre les panneaux avec _ctxLastData

_renderCtxPanels(data) :
  srcFieldRuleMap = {} // champ source → Set(rule_names actifs)
  tgtFieldRuleMap = {} // champ cible  → Set(rule_names actifs)
  Pour chaque écart dont rule_name ∈ _ctxActiveRules :
    parser champ (format "src_field op tgt_field") :
      srcFieldRuleMap[src_field].add(rule_name)
      tgtFieldRuleMap[tgt_field].add(rule_name)
  Chaque cellule avec ≥1 règle active → bullet + surlignage
```

---

## Tooling & CI/CD

Cette section décrit les scripts de développement, la chaîne de build et le pipeline de release automatisé mis en place à partir de la v3.7.0.

---

### RG-TOOL — Scripts de développement

#### RG-TOOL-01 — Gestion des versions (`tools/bump_version.py`)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.7.0` |
| Tests | — |

**Résumé :** Script unique responsable de la synchronisation de la version dans tous les fichiers du projet. À appeler avant chaque commit qui change un comportement visible.

**Algorithme :**
```
Invocation : python3 tools/bump_version.py <X.Y.Z>

Fichiers mis à jour (substitution regex) :
  server.py          APP_VERSION = "X.Y.Z"
  static/js/state.js UI_VERSION  = 'X.Y.Z'
  static/sw.js       CACHE_VERSION = 'vX.Y.Z'
  index.html         <span id="logo-ver">vX.Y.Z</span>
  installer.iss      #define AppVersion "X.Y.Z"
```

**Convention de bump :**

| Préfixe commit | Bump | Exemple |
|---|---|---|
| `fix:` | PATCH — `x.y.Z+1` | correction de bug, ajustement mineur |
| `feat:` | MINOR — `x.Y+1.0` | nouvelle fonctionnalité |
| breaking change | MAJOR — `X+1.0.0` | rupture de schéma YAML ou API |

**Workflow type :**
```bash
python3 tools/bump_version.py 3.8.0
git add -p
git commit -m "feat: v3.8.0 — description"
git push && git tag v3.8.0 && git push origin v3.8.0
```

---

#### RG-TOOL-02 — Tests automatisés (`sample/run_tests.py`)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.5.0` |
| Tests | auto-référentiel |

**Résumé :** Suite de tests de non-régression qui lance des audits réels via l'API HTTP et vérifie les résultats attendus. Chaque scénario couvre un format de fichier ou une combinaison de formats.

**Algorithme :**
```
Prérequis : serveur lancé sur localhost:5000

Pour chaque scénario dans sample/jdd/ :
  1. POST /api/upload  → upload des deux fichiers source
  2. POST /api/audit   → soumettre le YAML de configuration
  3. GET  /api/stream  → consommer les événements SSE jusqu'à "done"
  4. Comparer summary { orphelins_a, orphelins_b, divergents, ok }
     avec les valeurs attendues déclarées dans le scénario
  5. Afficher ✓ ou ✗ avec détail en cas d'échec

Invocation :
  python3 sample/run_tests.py [--url http://localhost:5000] [--filter <nom>]
```

**Scénarios couverts (sample/jdd/) :**

| Config YAML | Formats | Couverture |
|---|---|---|
| `cfg_csv.yaml` | CSV ↔ CSV | format de base, règles standard |
| `cfg_txt.yaml` | TXT positionnel ↔ TXT positionnel | format fixe |
| `cfg_txt_vs_csv.yaml` | TXT ↔ CSV | cross-format |
| `cfg_json.yaml` | JSON ↔ JSON | json_path, fields avec path imbriqué |
| `cfg_jsonl.yaml` | JSONL ↔ JSONL | une ligne = un enregistrement |
| `cfg_csv_vs_jsonl.yaml` | CSV ↔ JSONL | cross-format |
| `cfg_json_vs_csv.yaml` | JSON ↔ CSV | cross-format |
| `cfg_xlsx.yaml` | XLSX ↔ XLSX | tableur Excel |
| `cfg_xlsx_vs_jsonl.yaml` | XLSX ↔ JSONL | cross-format |
| `cfg_wide_csv.yaml` | CSV large ↔ CSV large | dépivotage unpivot |
| `cfg_wide_txt.yaml` | TXT large ↔ TXT large | dépivotage unpivot positionnel |

---

#### RG-TOOL-03 — Génération des icônes PWA (`tools/make_pwa_icons.py`)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.7.0` |
| Tests | — |

**Résumé :** Génère les icônes PNG requises par le Web App Manifest sans dépendance externe (PNG écrit en Python pur via `zlib` + `struct`).

**Algorithme :**
```
Invocation : python3 tools/make_pwa_icons.py

Produit :
  static/icons/icon-192.png          192×192 px  (any)
  static/icons/icon-512.png          512×512 px  (any)
  static/icons/icon-maskable-512.png 512×512 px  (maskable, safe-zone 10 %)

Dessin : fond bleu (#2563eb), deux colonnes de données blanches,
         ligne KO rouge, barre diagonale jaune — logo DataAuditor
```

À relancer uniquement si le logo est modifié. Les PNG sont committés dans le dépôt.

---

#### RG-TOOL-04 — Génération de l'icône Windows (`tools/make_icon.py`)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.7.0` |
| Tests | — |

**Résumé :** Génère `tools/DataAuditor.ico` au format ICO multi-résolution (16/32/48/256 px) sans dépendance externe (ICO écrit en Python pur via `struct`).

**Algorithme :**
```
Invocation : python3 tools/make_icon.py

Produit :
  tools/DataAuditor.ico  (multi-résolution : 16, 32, 48, 256 px)

Utilisé par :
  build.spec     → exe PyInstaller (icône barre des tâches Windows)
  installer.iss  → SetupIconFile (icône de l'installeur)
```

À relancer uniquement si le logo est modifié. L'ICO est committé dans le dépôt.

---

### RG-BUILD — Build Windows

#### RG-BUILD-01 — Bundle PyInstaller (`build.spec`)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.7.0` |
| Tests | — |

**Résumé :** Spécification PyInstaller qui produit un bundle Windows autonome (mode `onedir`) incluant Python, Flask, pandas, openpyxl et toutes les ressources statiques.

**Algorithme :**
```
Mode : onedir (--onedir)
  → répertoire dist/DataAuditor/ contenant DataAuditor.exe + dépendances
  → démarrage plus rapide que --onefile (pas d'extraction au lancement)

Résolution des chemins au runtime (server.py) :
  Si sys.frozen == True (mode PyInstaller) :
    _BASE_DIR = sys._MEIPASS          ← ressources en lecture seule
    _DATA_DIR = dirname(sys.executable) ← données persistantes (reports/)
  Sinon :
    _BASE_DIR = _DATA_DIR = dirname(__file__)

Ressources embarquées :
  index.html, static/, docs/, sample/
  jinja2 (templates), openpyxl (styles Excel)

Exclusions (-X) :
  tkinter, PyQt5/6, matplotlib, scipy, PIL, Jupyter, pytest
```

**Invocation manuelle (Windows) :**
```bat
pip install pyinstaller flask pandas openpyxl pyyaml jinja2
pyinstaller build.spec
```
Résultat : `dist/DataAuditor/DataAuditor.exe`

---

#### RG-BUILD-02 — Installeur Inno Setup (`installer.iss`)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.7.0` |
| Tests | — |

**Résumé :** Script Inno Setup 6 qui emballe le bundle PyInstaller dans un installeur Windows professionnel (`.exe`).

**Algorithme :**
```
Source       : dist\DataAuditor\* (bundle PyInstaller)
Destination  : C:\Program Files\DataAuditor\
Résultat     : dist\installer\DataAuditor_Setup_vX.Y.Z.exe

Options installeur :
  Compression : LZMA ultra64 + solid (taille minimale)
  Tâches      : raccourci bureau (coché), démarrage auto (décoché)
  Langue      : français (principal), anglais (secondaire)
  Prérequis   : Windows 10/11 64 bits (rejet 32 bits)
  Désinstall. : propose la suppression du dossier reports/ (avec confirmation)

Surcharge de version (CI) :
  iscc /DAppVersion=X.Y.Z installer.iss
  → remplace la valeur #define AppVersion sans modifier le fichier
```

**Invocation manuelle (Windows) :**
```bat
choco install innosetup
iscc installer.iss
```

---

### RG-CICD — Pipeline de release

#### RG-CICD-01 — Workflow GitHub Actions (`.github/workflows/release.yml`)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.7.0` |
| Tests | — |

**Résumé :** Workflow déclenché sur tout push de tag `v*` qui build l'installeur Windows et publie automatiquement la release GitHub avec le binaire joint.

**Algorithme :**
```
Déclencheur : git push origin vX.Y.Z

Environnement : windows-latest (GitHub Actions)

Étapes :
  1. Checkout du dépôt
  2. Installer Python 3.13 + dépendances (pip)
  3. Extraire la version depuis le nom du tag (ex. v3.7.0 → 3.7.0)
  4. Lancer PyInstaller : pyinstaller build.spec
       → dist/DataAuditor/ (bundle onedir)
  5. Installer Inno Setup (choco install innosetup)
  6. Lancer ISCC : iscc /DAppVersion=X.Y.Z installer.iss
       → dist/installer/DataAuditor_Setup_vX.Y.Z.exe
  7. Créer la release GitHub (softprops/action-gh-release@v2)
       → Titre : "DataAuditor vX.Y.Z"
       → Asset : DataAuditor_Setup_vX.Y.Z.exe

Permissions requises : contents: write (pour créer la release)
```

**Workflow de release complet :**
```bash
# 1. Développer + committer sur main
python3 tools/bump_version.py X.Y.Z
git add -p && git commit -m "feat: vX.Y.Z — description"
git push origin main

# 2. Tagger → déclenche le build CI
git tag vX.Y.Z && git push origin vX.Y.Z

# 3. Suivre le build
gh run watch

# 4. Résultat : release GitHub avec installeur Windows attaché
```

**Durée estimée du build CI :** 5-10 minutes (pip install + PyInstaller + Inno Setup).

---

#### RG-CICD-02 — PWA (Progressive Web App)

| Métadonnée | Valeur |
|---|---|
| Commit | `v3.7.0` |
| Tests | — |

**Résumé :** DataAuditor est installable comme application native depuis le navigateur (Chrome/Edge). Le Service Worker assure le fonctionnement hors-ligne pour l'interface et invalide automatiquement le cache lors d'une mise à jour.

**Algorithme :**
```
Manifeste : /static/manifest.json (servi aussi sur /manifest.json)
  display: standalone  → lance sans barre d'adresse
  theme_color: #2563eb

Service Worker : /sw.js (scope = / via route Flask dédiée)
  Stratégie :
    /api/*     → réseau uniquement (jamais mis en cache)
    tout autre → cache-first + revalidation arrière-plan (stale-while-revalidate)
  Hors-ligne   → sert la version en cache ou 503

Invite d'installation :
  beforeinstallprompt → mémorisé dans _pwaPrompt
  Bouton ⬇ dans le header (affiché uniquement si le navigateur propose l'invite)
  Après installation → bouton masqué

Notification de mise à jour :
  SW détecte une nouvelle version → postMessage({ type: 'SW_UPDATED' })
  UI affiche une barre fixe en bas avec bouton "Recharger"

Cache invalidation :
  CACHE_VERSION dans sw.js = 'vX.Y.Z'
  Mis à jour par tools/bump_version.py → force le remplacement du cache au démarrage
```
