# DataAuditor v3.0.0

Outil d'audit de cohérence de données entre deux sources hétérogènes.
Serveur Flask + interface web, piloté par configuration YAML.

---

## Fonctionnalités

- **Formats supportés** : CSV, TXT, DAT (positionnel), JSON, XLSX
- **Jointure multi-clés** configurable
- **Règles de contrôle** nommées avec logique AND/OR, opérateurs (`=`, `≠`, `>`, `<`, `∋`, `∌`), tolérance numérique
- **Filtres** par source avant comparaison
- **Dépivotage** (format large → long)
- **Streaming temps réel** (SSE) de la progression
- **Exports** : CSV, XLS (2 feuilles, couleurs par type d'écart), HTML interactif (filtres, tri, chips)
- **Historique** des audits
- **Persistance de session** : dernière configuration et noms de fichiers restaurés automatiquement

---

## Installation

### Linux / macOS

```bash
bash install.sh
```

### Windows

Double-cliquez sur `install.bat` ou lancez-le depuis une invite de commandes.

Le script :
1. Vérifie que Python 3.10+ est disponible
2. Crée un environnement virtuel `.venv/`
3. Installe les dépendances (`requirements.txt`)
4. Génère un script de lancement (`run.sh` / `run.bat`)

### Prérequis

- Python 3.10 ou supérieur
- pip

---

## Lancement

```bash
bash run.sh        # Linux / macOS
run.bat            # Windows
```

Puis ouvrir **http://localhost:5000** dans un navigateur.

Ou manuellement :

```bash
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows

python server.py
```

---

## Configuration YAML

```yaml
meta:
  name: Mon audit
  version: '1.0'

sources:
  reference:
    format: dat          # csv | txt | dat | json | xlsx
    encoding: utf-8
    fixed_width: true
    column_positions:
      - { name: SKU, position: 7, width: 10 }
      # ...
  target:
    format: csv
    encoding: utf-8
    delimiter: ;
    has_header: true
    fields:
      - { name: sku }
      # ...

join:
  keys:
    - { source_field: SKU, target_field: sku }

rules:
  - name: Stock incohérent
    logic: AND              # AND | OR
    rule_type: incoherence  # incoherence | coherence
    fields:
      - source_field: Qty
        target_field: qty
        operator: differs   # equals | differs | greater | less | contains | not_contains
        tolerance: 0

filters:
  - field: Site
    source: reference
    values: [PAR, LYO]

report:
  show_matching: false
  max_diff_preview: 500
```

---

## Architecture

```
server.py        Flask + SSE streaming + apply_filters
config_loader.py Validation YAML (ConfigError)
parser.py        CSV / DAT / JSON / XLSX → DataFrame
normalizer.py    Typage pandas (string/integer/decimal/date/boolean)
unpivot.py       Dépivotage format large → long
comparator.py    Jointure + rules + génération SSE progress
report.py        Export CSV / XLS / HTML + historisation JSON
index.html       UI complète (thème clair, SSE, wizard, prévisualisation)
docs/            Manuel utilisateur + Spécifications fonctionnelles
```

---

## Données de test

```bash
# Charger test_audit_demo.yaml dans l'interface, puis :
# Source A : test_reference.dat
# Source B : test_target.csv
```

Les fichiers exemples sont accessibles depuis le bouton **?** → onglet **Exemples**.

---

## Stack

| Composant | Version |
|-----------|---------|
| Python    | 3.10+   |
| Flask     | 3.0.3   |
| pandas    | 2.2.3   |
| openpyxl  | 3.1.2   |
| PyYAML    | 6.0.1   |
| Jinja2    | 3.1.4   |
