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
normalizer.py    Typage pandas (string/integer/decimal/date/boolean)
unpivot.py       Dépivotage format large → long
comparator.py    Jointure + rules + génération SSE progress
report.py        Export CSV/HTML + historisation JSON (reports/)
index.html       UI complète (thème clair, SSE, prévisualisation)
```

## Fonctionnalités clés

### Formats supportés (parser.py)
- `csv` / `txt` / `dat` : délimité, configurable
- `fixed_width: true` : colonnes à positions fixes avec `column_positions`
- `record_filter.marker` : regex de filtrage de lignes avant parsing
- `max_columns` : limite de split pour colonnes contenant des `;` internes
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
    fields:
      - { source_field, target_field, tolerance, normalize }   # syntaxe courte
      - { source_field, target_value }                         # valeur fixe
      - { source_data: {field, normalize}, target_data: {value|field, tolerance} }
comparison:
  fields: [...]        # legacy, préférer rules
  ignore_fields: [...]
report:
  show_matching: false
  max_diff_preview: 500
```

### Flux SSE (server.py → index.html)
Les événements émis pendant l'audit :
- `progress`      : { done, total, pct, step }
- `filter_counts` : { ref_count, tgt_count } — après apply_filters
- `result`        : ligne d'écart { join_key, type_ecart, rule_name, champ, valeur_reference, valeur_cible, detail }
- `summary`       : { total_reference, total_cible, orphelins_a, orphelins_b, divergents, ok, rule_stats }
- `done`          : { history_file, total_results }
- `error`         : { message }

### apply_filters (server.py)
- Filtre chaque source sur son propre champ (pas de propagation croisée)
- Orphelins restent détectables après filtrage
- Émet `filter_counts` via SSE après application

### Types d'écart (comparator.py)
- `ORPHELIN_A` : clé dans référence, absente cible
- `ORPHELIN_B` : clé dans cible, absente référence
- `DIVERGENT`  : clé commune, valeur différente
- `OK`         : clé commune, conforme (si show_matching: true)

## Conventions de code

- Les erreurs lisibles par technicien passent par `ConfigError`
- Tout parsing retourne un `pd.DataFrame` avec colonnes nommées selon la config
- Le comparator est un **générateur** (`yield`) pour le streaming SSE
- Les sessions Flask sont stockées en mémoire (`_sessions` dict + lock)
- Version affichée dans index.html : `v2.2.0` (logo-ver span)

## Tests
Données de test dans le repo :
- `test_reference.dat`  : 100 lignes, format positionnel 65 chars
- `test_target.csv`     : 100 lignes, CSV délimité `;`
- `test_audit_demo.yaml`: config complète démontrant toutes les fonctionnalités

Anomalies injectées (pour validation) :
| SKU | Type | Description |
|-----|------|-------------|
| SKU00006 | ORPHELIN_A | absent du CSV |
| SKU99999 | ORPHELIN_B | absent du DAT |
| SKU00056 | ORPHELIN_A | site=ZZZ filtré |
| SKU00016 | DIVERGENT  | qty+10 |
| SKU00021 | DIVERGENT  | qty=-999 |
| SKU00026 | DIVERGENT  | statut=99 |
| SKU00031 | OK         | prix+0.03 dans tolérance |
| SKU00036 | DIVERGENT  | prix+2.50 hors tolérance |
| SKU00041 | DIVERGENT  | EAN décalé |
| SKU00046 | DIVERGENT  | type invalide |
| SKU00051 | DIVERGENT  | statut+qty (AND multi-champs) |

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
