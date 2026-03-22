# DataAuditor — Contexte projet pour Claude Code

## Description
Outil d'audit de cohérence de données entre deux sources hétérogènes.
Serveur Flask + UI web, piloté par configuration YAML.

## Stack
- **Backend** : Python 3.13, Flask 3.0, pandas 2.2.3
- **Frontend** : HTML/CSS/JS vanilla (index.html, pas de framework)
- **Config** : YAML (PyYAML)
- **Exports** : Jinja2 (HTML), csv stdlib

## Architecture des modules

```
server.py        Flask + SSE streaming + apply_filters
config_loader.py Validation YAML (ConfigError)
parser.py        CSV / DAT / JSON / XLSX → DataFrame
normalizer.py    Typage pandas (string/integer/decimal/date/boolean/skip)
unpivot.py       Dépivotage format large → long
comparator.py    Jointure + rules + génération SSE progress
report.py        Export CSV/HTML + historisation JSON (reports/)
index.html       UI complète (thème clair, SSE, prévisualisation)
docs/            Manuel utilisateur (usermanual.md) + Spec (specifications.md)
```

## Modèle conceptuel — Types de contrôles

L'audit produit deux familles de contrôles indépendantes, évaluées sur des unités différentes :

### Contrôles de présence
Évalués sur l'ensemble des clés (avant toute règle). Détectent les enregistrements présents dans une seule source.

| `type_ecart` | Libellé UI | Condition |
|---|---|---|
| `ORPHELIN_A` | Orphelin (source) | Clé dans la référence, absente de la cible |
| `ORPHELIN_B` | Orphelin (cible) | Clé dans la cible, absente de la référence |

### Règles de contrôle
Évaluées sur les **couples appariés** (clés communes aux deux sources). Chaque règle est **indépendante** : un même couple peut déclencher 0, 1 ou N règles simultanément.

Les règles sont catégorisées par `rule_type` :

| `rule_type` | Couleur UI | Logique KO/OK |
|---|---|---|
| `coherence` | 🟢 Vert | **Jamais KO** — OK uniquement quand tous les champs confirment (n_fail == 0, show_matching: true) |
| `incoherence` | 🔴 Rouge | **KO** quand au moins un champ diffère (n_fail > 0) ; OK quand aucun écart |

> **Important** : `rule_type` affecte directement la logique KO/OK dans `comparator.py`. Une règle `coherence` ne peut jamais produire de KO ; elle sert uniquement à confirmer la conformité. Une règle `incoherence` produit KO dès qu'un écart est détecté.

### Valeurs de `type_ecart` dans les événements SSE

| Valeur | Famille | Signification |
|---|---|---|
| `ORPHELIN_A` | Contrôle de présence | Clé manquante côté cible |
| `ORPHELIN_B` | Contrôle de présence | Clé manquante côté référence |
| `KO` | Règle de contrôle | Règle déclenchée (condition vraie) |
| `OK` | Règle de contrôle | Règle non déclenchée (si `show_matching: true`) |

Le champ `DIVERGENT` (legacy) est assimilé à `KO`. Les résultats `KO` portent toujours un `rule_name`.

## Fonctionnalités clés

### Formats supportés (parser.py)
- `csv` / `txt` / `dat` : délimité, configurable
- `fixed_width: true` : colonnes à positions fixes avec `column_positions`
- `record_filter.marker` : regex de filtrage de lignes avant parsing
- `max_columns` : limite de split pour colonnes contenant des `;` internes
- `_split_line` : RFC 4180 strict — le mode guillemet n'est activé qu'en début de champ (pas sur un `"` au milieu d'un blob)
- `xlsx` : via openpyxl, avec `sheet_name`

### Config YAML (schéma)
```yaml
meta: { name, version }
sources:
  reference: { label, format, encoding, delimiter, has_header,
               skip_rows, fixed_width, record_filter, max_columns,
               fields | column_positions, unpivot }
  target:    { idem }
filters:
  - { field, source: reference|target, values: [...] }  # values optionnel
join:
  keys:
    - { source_field, target_field }
rules:
  - name: "..."
    logic: AND | OR
    rule_type: coherence | incoherence   # affecte la logique KO/OK
    fields:
      - { source_field, target_field, operator, tolerance, normalize }
      - { source_field, target_value }                         # valeur fixe
      - { source_data: {field, normalize}, target_data: {value|field, tolerance} }
# Types de champs (field.type) :
#   string | integer | decimal | date | boolean
#   skip   → champ lu (pour ne pas décaler les positions) mais ignoré :
#            pas de normalisation, pas de comparaison (blob JSON, hash Ruby, etc.)
comparison:
  fields: [...]        # legacy, préférer rules
  ignore_fields: [...]
report:
  show_matching: false
  max_diff_preview: 500
```

### Opérateurs de règle (comparator.py)
`check_field_condition()` retourne `True` quand la condition mathématique est **satisfaite**. Une règle est "passante" quand ses champs satisfont la condition (AND : tous ; OR : au moins un).

| Opérateur YAML | Symbole | check_field_condition = True quand… |
|---|---|---|
| `equals` | = | A = B |
| `differs` | ≠ | A ≠ B |
| `greater` | > | A > B |
| `less` | < | A < B |
| `contains` | ∋ | B ∈ A |
| `not_contains` | ∌ | B ∉ A |

Alias legacy acceptés : `=` → `equals`, `<>` → `differs`, `>` → `greater`, `<` → `less`

### Flux SSE (server.py → index.html)
Les événements émis pendant l'audit :
- `progress`      : { done, total, pct, step }
- `filter_counts` : { ref_count, tgt_count } — après apply_filters
- `result`        : { join_key, type_ecart, rule_name, champ, valeur_reference, valeur_cible, detail }
- `summary`       : { total_reference, total_cible, orphelins_a, orphelins_b, divergents, ok, rule_stats }
- `done`          : { history_file, total_results }
- `error`         : { message }

### apply_filters (server.py)
- Filtre chaque source sur son propre champ (pas de propagation croisée)
- Les orphelins restent détectables après filtrage
- Émet `filter_counts` via SSE après application

### Évaluation des règles (comparator.py)
- Les règles sont évaluées sur les **couples appariés** uniquement (clés communes)
- Chaque règle est **indépendante** : plusieurs règles peuvent déclencher sur le même couple
- La logique `AND` : KO si au moins un champ de la règle est en écart
- La logique `OR` : même comportement que AND (v3, réservé pour évolution)
- `rule_ko_keys[rule.name]` agrège les clés KO par règle → exposé dans `summary.rule_stats`

## Conventions de code

- Les erreurs lisibles par technicien passent par `ConfigError`
- Tout parsing retourne un `pd.DataFrame` avec colonnes nommées selon la config
- Le comparator est un **générateur** (`yield`) pour le streaming SSE
- Les sessions Flask sont stockées en mémoire (`_sessions` dict + lock)
- Version affichée dans index.html : `v3.0.0` (logo-ver span)
- YAML chargé via `_Loader(yaml.SafeLoader)` pour gérer le token `=` (tag:yaml.org,2002:value)

## Tests
Données de test dans le repo :
- `test_reference.dat`  : 100 lignes, format positionnel 65 chars
- `test_target.csv`     : 100 lignes, CSV délimité `;`
- `test_audit_demo.yaml`: config complète démontrant toutes les fonctionnalités
- `test_unpivot.yaml` + `unpivot_ref.csv` + `unpivot_target.csv` : dépivotage

Anomalies injectées (pour validation) :
| SKU | Contrôle | Description |
|-----|----------|-------------|
| SKU00006 | Présence — Orphelin source | absent du CSV |
| SKU99999 | Présence — Orphelin cible  | absent du DAT |
| SKU00056 | Présence — Orphelin source | site=ZZZ filtré |
| SKU00016 | Règle KO | qty+10 |
| SKU00021 | Règle KO | qty=-999 |
| SKU00026 | Règle KO | statut=99 |
| SKU00031 | Règle OK  | prix+0.03 dans tolérance |
| SKU00036 | Règle KO | prix+2.50 hors tolérance |
| SKU00041 | Règle KO | EAN décalé |
| SKU00046 | Règle KO | type invalide |
| SKU00051 | Règle KO | statut+qty (AND multi-champs) |

## Points d'attention pour les évolutions

1. **Sessions en mémoire** : les `_sessions` ne survivent pas à un redémarrage serveur.
   Pour la production, envisager Redis ou SQLite.

2. **Encodage** : utiliser `utf-8-sig` pour les fichiers CSV exportés depuis Excel
   (gère le BOM automatiquement).

3. **Filtres sans `values`** : déclarent un champ comme pill UI uniquement,
   sans filtrage de lignes.

4. **Unpivot** : transforme N colonnes en N lignes avant comparaison.
   La jointure doit inclure le `location_field` généré.

5. **SSE et threading** : chaque audit tourne dans un thread daemon séparé.
   Flask doit être lancé avec `threaded=True`.

6. **Opérateur `=` en YAML** : PyYAML (1.1) parse le scalaire `=` comme
   `tag:yaml.org,2002:value`. Le `_Loader` personnalisé le normalise en `"="`.
   Dans le YAML généré, `jsyaml.dump` cite automatiquement `"="`.

## Spécification fonctionnelle (docs/specifications.md)

La spec est le contrat de comportement de l'application — elle est mise à jour avant d'implémenter tout nouveau comportement ou correctif (spec-first).

Structure du document :
```
Frontmatter YAML (tags, updated)
├── Introduction — flux principal, versions de référence
├── Schéma de données — structure JSON / modèle, avec tables de champs
└── Règles de gestion (RG) — organisées par écran, dans l'ordre du parcours
```

Format d'une règle de gestion :
```
#### RG-ECRAN-NN — Titre court
| Issue | #N | Commit | vX.Y | Tests | — |
**Résumé :** comportement visible.
**Algorithme :** pseudo-code testable.
```

Conventions :
- `updated:` mis à jour à chaque commit modifiant un comportement
- Fonctionnalités non implémentées signalées avec `> [!warning]`
- La spec décrit le comportement attendu, pas l'implémentation interne
- Le pseudo-code est suffisamment précis pour être directement testable
