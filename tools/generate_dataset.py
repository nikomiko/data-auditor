#!/usr/bin/env python3
"""
generate_dataset.py — Génération de jeux de données pour DataAuditor.

Génère une référence CSV et trois cibles (JSONL, JSON, DAT positionnel)
avec un taux configurable d'anomalies (~5 % par défaut).

Usage:
    python3 tools/generate_dataset.py --domain catalogue --rows 500
    python3 tools/generate_dataset.py --domain stocks    --rows 1000 --seed 123
    python3 tools/generate_dataset.py --domain catalogue --rows 200  --rate 0.10

Sortie dans datasets/<domain>_<rows>/ :
    reference.csv           — source de référence (sans anomalie)
    target.jsonl            — cible JSONL  (~5 % anomalies)
    target.json             — cible JSON   (~5 % anomalies)
    target.dat              — cible positionnel fixe (~5 % anomalies)
    audit_csv_jsonl.yaml    — config DataAuditor CSV → JSONL
    audit_csv_json.yaml     — config DataAuditor CSV → JSON
    audit_csv_dat.yaml      — config DataAuditor CSV → DAT
    mutations.log           — journal des anomalies injectées
"""

import argparse
import csv
import json
import random
from datetime import date, timedelta
from pathlib import Path

# ─── Taux par défaut ──────────────────────────────────────────────────────────
_DEFAULT_RATE   = 0.05   # fraction de lignes avec au moins un champ muté
_DEFAULT_ORPHAN = 0.02   # fraction de lignes absentes de toutes les cibles (ORPHELIN_A)

# ─── Pools de valeurs ─────────────────────────────────────────────────────────

_DESIGNATIONS = [
    "Ecran LED 24p Full HD", "Ecran IPS 27p 4K", "Ecran OLED 32p Courbe",
    "Moniteur Gaming 144Hz", "Moniteur Portable USB-C", "Moniteur 21p HD+",
    "Clavier mecanique RGB", "Clavier sans fil compact", "Clavier ergonomique split",
    "Souris gaming 12000 DPI", "Souris sans fil silencieuse", "Souris verticale ergonomique",
    "Casque audio ANC sans fil", "Casque gaming surround 7.1", "Ecouteurs Bluetooth TWS",
    "Webcam HD 1080p", "Webcam 4K Ultra HD", "Camera streaming USB",
    "Hub USB-C 7 ports", "Adaptateur HDMI 4K", "Cable USB-C tresse 2m",
    "SSD externe 500 Go USB", "SSD externe 1 To NVMe", "Disque dur portable 2 To",
    "Batterie externe 20000 mAh", "Chargeur sans fil Qi 15W", "Chargeur GaN 65W",
    "Enceinte Bluetooth etanche", "Barre de son 2.1 80W", "Microphone USB cardioide",
    "Bureau angle 160cm chene", "Bureau droit 120cm blanc", "Bureau reglable hauteur",
    "Chaise ergonomique mesh", "Chaise de direction cuir", "Fauteuil gaming RGB",
    "Etagere murale 80cm metal", "Bibliotheque 5 niveaux bois", "Caisson tiroirs mobile",
    "Perceuse visseuse 18V Li", "Visseuse sans fil compacte", "Ponceuse orbitale 125mm",
    "Jeu cles plates 12 pieces", "Tournevis electrique 3.6V", "Niveau laser croix vert",
    "T-shirt coton bio 200g M", "Polo manches courtes pique L", "Veste polaire fleece XL",
    "Cafe arabica grain 1kg", "The vert bio Sencha 100g", "Chocolat noir 72% 200g",
    "Huile olive vierge extra 75cl", "Miel acacia artisanal 500g", "Confiture extra fraise 370g",
    "Stylo bille retractable", "Agenda 2024 souple A5", "Classeur levier A4 dos 8cm",
    "Rame papier A4 80g 500f", "Toner laser noir 3000p", "Cartouche encre couleur XL",
    "Sac a dos 30L impermeable", "Trousse outils zippee 40cm", "Gants hiver tactiles taille L",
    "Lampe bureau LED flexible 12W", "Ventilateur colonne 45W", "Purificateur air HEPA H13",
]

_CATEGORIES = [
    "Electronique", "Mobilier", "Outillage", "Textile",
    "Alimentaire", "Papeterie", "Maroquinerie", "Confort",
]
_SOUS_CATS = {
    "Electronique": ["Ecrans", "Peripheriques", "Audio", "Stockage", "Cables"],
    "Mobilier":     ["Bureaux", "Sieges", "Rangement"],
    "Outillage":    ["Electroportatif", "Manuel", "Mesure"],
    "Textile":      ["Vetements", "Accessoires"],
    "Alimentaire":  ["Boissons", "Epicerie", "Confiserie"],
    "Papeterie":    ["Ecriture", "Classement", "Impression"],
    "Maroquinerie": ["Sacs", "Bagages"],
    "Confort":      ["Eclairage", "Climatisation"],
}

_ENTREPOTS  = ["ENT-NORD", "ENT-SUD", "ENT-EST", "ENT-OUEST", "ENT-CTR"]
_TYPES_MVT  = ["Entree", "Sortie", "Transfert", "Retour", "Inventaire"]
_OPERATEURS = [f"OP{i:03d}" for i in range(1, 11)]

# ─── Schémas ──────────────────────────────────────────────────────────────────
# Chaque champ :
#   name      — identifiant colonne
#   gen       — type de générateur  (key | pool | enum | enum_num | int | dec | date | date_after | sku_ref | computed)
#   width     — largeur pour le DAT positionnel (tous les champs doivent avoir width)
#   da        — type DataAuditor   (string | integer | decimal | date)
#   mutable   — True si ce champ peut subir une mutation dans les cibles
#   + params spécifiques au générateur

def _schema_catalogue():
    return {
        "domain": "catalogue",
        "label":  "Catalogue produits",
        "key":    "sku",
        "fields": [
            # ── Clé ──────────────────────────────────────────────────────────
            {"name": "sku",           "gen": "key",       "width": 12, "da": "string",
             "prefix": "CAT", "digits": 6},
            # ── Texte ─────────────────────────────────────────────────────────
            {"name": "designation",   "gen": "pool",      "width": 38, "da": "string",
             "pool": _DESIGNATIONS,   "mutable": True},
            {"name": "categorie",     "gen": "enum",      "width": 14, "da": "string",
             "values": _CATEGORIES},
            {"name": "sous_categorie","gen": "sub_enum",  "width": 14, "da": "string",
             "parent": "categorie",   "mapping": _SOUS_CATS},
            # ── Numériques (3 décimaux + 2 entiers) ───────────────────────────
            {"name": "prix_ht",       "gen": "dec",       "width": 10, "da": "decimal",
             "min": 0.50,  "max": 4999.99, "dp": 2,  "mutable": True},
            {"name": "taux_tva",      "gen": "enum_num",  "width":  6, "da": "decimal",
             "values": [5.5, 10.0, 20.0]},
            {"name": "poids_kg",      "gen": "dec",       "width":  8, "da": "decimal",
             "min": 0.10,  "max": 49.99,   "dp": 3,  "mutable": True},
            {"name": "stock_initial", "gen": "int",       "width":  6, "da": "integer",
             "min": 0,     "max": 9999,    "mutable": True},
            {"name": "seuil_reappro", "gen": "int",       "width":  5, "da": "integer",
             "min": 5,     "max": 500,     "mutable": True},
            # ── Dates (2) ─────────────────────────────────────────────────────
            {"name": "date_creation", "gen": "date",      "width": 10, "da": "date",
             "start": "2018-01-01", "end": "2022-12-31"},
            {"name": "date_maj",      "gen": "date",      "width": 10, "da": "date",
             "start": "2023-01-01", "end": "2024-12-31", "mutable": True},
            # ── Statut ────────────────────────────────────────────────────────
            {"name": "statut",        "gen": "enum",      "width":  8, "da": "string",
             "values": ["Actif", "Inactif", "Archive"],   "mutable": True},
        ],
    }


def _schema_stocks():
    return {
        "domain": "stocks",
        "label":  "Mouvements de stocks entrepôt",
        "key":    "mvt_id",
        "fields": [
            # ── Clé ──────────────────────────────────────────────────────────
            {"name": "mvt_id",      "gen": "key",        "width": 12, "da": "string",
             "prefix": "MVT", "digits": 7},
            # ── Références ───────────────────────────────────────────────────
            {"name": "sku",         "gen": "sku_ref",    "width": 12, "da": "string"},
            {"name": "entrepot",    "gen": "enum",       "width": 10, "da": "string",
             "values": _ENTREPOTS},
            {"name": "type_mvt",    "gen": "enum",       "width": 12, "da": "string",
             "values": _TYPES_MVT,  "mutable": True},
            # ── Numériques (2 entiers + 3 décimaux) ───────────────────────────
            {"name": "quantite",    "gen": "int",        "width":  5, "da": "integer",
             "min": 1, "max": 500,  "mutable": True},
            {"name": "stock_avant", "gen": "int",        "width":  6, "da": "integer",
             "min": 0, "max": 9999, "mutable": True},
            {"name": "stock_apres", "gen": "computed",   "width":  6, "da": "integer",
             "compute": "stock_apres"},
            {"name": "prix_unit",   "gen": "dec",        "width": 10, "da": "decimal",
             "min": 0.50, "max": 4999.99, "dp": 2,       "mutable": True},
            {"name": "valeur_mvt",  "gen": "computed",   "width": 12, "da": "decimal",
             "compute": "valeur_mvt"},
            # ── Dates (2) ─────────────────────────────────────────────────────
            {"name": "date_mvt",    "gen": "date",       "width": 10, "da": "date",
             "start": "2024-01-01", "end": "2024-12-31"},
            {"name": "date_saisie", "gen": "date_after", "width": 10, "da": "date",
             "base": "date_mvt", "max_days": 3,          "mutable": True},
            # ── Opérateur ────────────────────────────────────────────────────
            {"name": "operateur",   "gen": "enum",       "width":  6, "da": "string",
             "values": _OPERATEURS, "mutable": True},
        ],
    }


SCHEMAS = {"catalogue": _schema_catalogue, "stocks": _schema_stocks}


# ─── Génération de lignes ─────────────────────────────────────────────────────

def _rand_date(start: str, end: str, rng: random.Random) -> str:
    s = date.fromisoformat(start)
    e = date.fromisoformat(end)
    return (s + timedelta(days=rng.randint(0, (e - s).days))).isoformat()


def generate_row(schema: dict, index: int, rng: random.Random) -> dict:
    row = {}
    for f in schema["fields"]:
        g, name = f["gen"], f["name"]

        if g == "key":
            row[name] = f"{f['prefix']}{index:0{f['digits']}d}"

        elif g == "pool":
            row[name] = rng.choice(f["pool"])

        elif g == "enum":
            row[name] = rng.choice(f["values"])

        elif g == "enum_num":
            row[name] = rng.choice(f["values"])

        elif g == "sub_enum":
            parent_val = row.get(f["parent"], "")
            options    = f["mapping"].get(parent_val, ["Autre"])
            row[name]  = rng.choice(options)

        elif g == "int":
            row[name] = rng.randint(f["min"], f["max"])

        elif g == "dec":
            row[name] = round(rng.uniform(f["min"], f["max"]), f["dp"])

        elif g == "date":
            row[name] = _rand_date(f["start"], f["end"], rng)

        elif g == "date_after":
            base = date.fromisoformat(row[f["base"]])
            row[name] = (base + timedelta(days=rng.randint(0, f["max_days"]))).isoformat()

        elif g == "sku_ref":
            # Référence à un produit parmi 1 000 (crée des répétitions dans le flux)
            row[name] = f"CAT{rng.randint(1, 1000):06d}"

        elif g == "computed":
            if f["compute"] == "stock_apres":
                type_mvt = row.get("type_mvt", "Entree")
                qte      = row.get("quantite", 0)
                avant    = row.get("stock_avant", 0)
                if type_mvt in ("Entree", "Retour"):
                    row[name] = avant + qte
                elif type_mvt in ("Sortie", "Transfert"):
                    row[name] = max(0, avant - qte)
                else:  # Inventaire : légère variation aléatoire
                    delta = rng.randint(-max(1, avant // 20), max(1, avant // 20))
                    row[name] = max(0, avant + delta)
            elif f["compute"] == "valeur_mvt":
                row[name] = round(row.get("quantite", 0) * row.get("prix_unit", 0.0), 2)

    return row


# ─── Moteur de mutations ──────────────────────────────────────────────────────

def _mutate_value(f: dict, value, rng: random.Random):
    """Retourne (nouvelle_valeur, description_textuelle)."""
    g = f["gen"]

    if g == "enum":
        choices  = f["values"]
        alt      = [v for v in choices if v != value]
        new_val  = rng.choice(alt) if alt else value
        return new_val, f"{value!r} → {new_val!r}"

    elif g == "enum_num":
        choices = f["values"]
        alt     = [v for v in choices if v != value]
        new_val = rng.choice(alt) if alt else value
        return new_val, f"{value} → {new_val}"

    elif g == "pool":
        alt     = [v for v in f["pool"] if v != value]
        new_val = rng.choice(alt) if alt else value
        return new_val, f"{value!r} → {new_val!r}"

    elif g == "dec":
        pct     = rng.uniform(0.06, 0.35) * rng.choice([-1, 1])
        new_val = round(max(f["min"], min(f["max"], value * (1 + pct))), f["dp"])
        return new_val, f"{value} → {new_val}"

    elif g == "int":
        delta   = max(1, rng.randint(1, max(1, abs(value) // 4 + 1)))
        new_val = max(f["min"], min(f["max"], value + rng.choice([-1, 1]) * delta))
        return new_val, f"{value} → {new_val}"

    elif g == "date":
        d       = date.fromisoformat(value)
        shift   = rng.randint(1, 90) * rng.choice([-1, 1])
        new_val = (d + timedelta(days=shift)).isoformat()
        return new_val, f"{value} → {new_val}"

    elif g == "date_after":
        d       = date.fromisoformat(value)
        shift   = rng.randint(1, 15)
        new_val = (d + timedelta(days=shift)).isoformat()
        return new_val, f"{value} → {new_val}"

    return value, "inchangé"


def apply_mutations(
    schema:       dict,
    ref_rows:     list,
    rate:         float,
    orphan_rate:  float,
    rng:          random.Random,
) -> tuple[list, list]:
    """
    Retourne (lignes_cible, journal_anomalies).
    Anomalies injectées :
      - ~orphan_rate des lignes sont absentes de la cible (ORPHELIN_A)
      - ~rate des lignes restantes ont 1-2 champs mutés
    """
    mutable = [
        f for f in schema["fields"]
        if f.get("mutable") and f["gen"] not in ("key", "computed", "sub_enum")
    ]
    key_field = schema["key"]
    log       = []
    target    = []

    for row in ref_rows:
        key = row[key_field]

        if rng.random() < orphan_rate:
            log.append({"key": key, "type": "ORPHELIN_A", "field": "-", "avant": "-", "apres": "-"})
            continue

        r = dict(row)

        if rng.random() < rate and mutable:
            n      = rng.randint(1, min(2, len(mutable)))
            fields = rng.sample(mutable, n)
            for f in fields:
                old = r[f["name"]]
                new, desc = _mutate_value(f, old, rng)
                if new != old:
                    r[f["name"]] = new
                    log.append({"key": key, "type": "MUTATION",
                                "field": f["name"], "avant": str(old), "apres": str(new)})

        target.append(r)

    return target, log


# ─── Exporteurs ───────────────────────────────────────────────────────────────

def write_csv(path: Path, rows: list, schema: dict) -> None:
    fields = [f["name"] for f in schema["fields"]]
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, delimiter=";")
        w.writeheader()
        w.writerows(rows)


def write_jsonl(path: Path, rows: list) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_json(path: Path, rows: list, schema: dict, n_ref: int) -> None:
    doc = {
        "export": {
            "domaine":          schema["label"],
            "total_reference":  n_ref,
            "total_cible":      len(rows),
        },
        "records": rows,
    }
    with path.open("w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)


def write_dat(path: Path, rows: list, schema: dict) -> None:
    """Fichier positionnel : chaque champ est aligné dans une fenêtre de largeur fixe."""
    fields = schema["fields"]
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            parts = []
            for f in fields:
                val   = row[f["name"]]
                width = f["width"]
                s     = str(val) if val is not None else ""
                # Numériques alignés à droite, texte à gauche
                if f["da"] in ("integer", "decimal"):
                    parts.append(s[:width].rjust(width))
                else:
                    parts.append(s[:width].ljust(width))
            fh.write("".join(parts) + "\n")


def write_mutations_log(path: Path, log: list, schema: dict, n_ref: int) -> None:
    orphans   = [e for e in log if e["type"] == "ORPHELIN_A"]
    mutations = [e for e in log if e["type"] == "MUTATION"]
    by_field  = {}
    for e in mutations:
        by_field.setdefault(e["field"], []).append(e)

    with path.open("w", encoding="utf-8") as fh:
        fh.write(f"# Anomalies injectées — domaine {schema['domain']}\n")
        fh.write(f"# Lignes référence      : {n_ref}\n")
        fh.write(f"# Orphelins A (absent)  : {len(orphans)}\n")
        fh.write(f"# Lignes mutées         : {len({e['key'] for e in mutations})}\n")
        fh.write(f"# Modifications champs  : {len(mutations)}\n\n")

        fh.write(f"## ORPHELIN_A — lignes présentes en référence, absentes de la cible\n")
        for e in orphans:
            fh.write(f"  {e['key']}\n")

        fh.write(f"\n## MUTATIONS — champs modifiés dans la cible\n")
        for field, entries in sorted(by_field.items()):
            fh.write(f"\n  {field} ({len(entries)} lignes) :\n")
            for e in entries[:30]:
                fh.write(f"    {e['key']:20s}  {e['avant']}  →  {e['apres']}\n")
            if len(entries) > 30:
                fh.write(f"    … et {len(entries) - 30} autres\n")


# ─── Générateurs de configs YAML ─────────────────────────────────────────────

def _fields_yaml(schema: dict, indent: str = "      ") -> str:
    lines = []
    for f in schema["fields"]:
        name = f["name"]
        da   = f["da"]
        if da == "date":
            lines.append(f'{indent}- {{name: {name}, type: date, date_format: "%Y-%m-%d"}}')
        else:
            lines.append(f'{indent}- {{name: {name}, type: {da}}}')
    return "\n".join(lines)


def _dat_positions_yaml(schema: dict, indent: str = "      ") -> str:
    lines = []
    pos = 1
    for f in schema["fields"]:
        name = f["name"]
        da   = f["da"]
        extra_lines = []
        if da in ("integer", "decimal"):
            extra_lines.append(f"{indent}  type: {da}")
        elif da == "date":
            extra_lines.append(f'{indent}  type: date')
            extra_lines.append(f'{indent}  date_format: "%Y-%m-%d"')
        block = (
            f"{indent}- name: {name}\n"
            f"{indent}  position: {pos}\n"
            f"{indent}  width: {f['width']}"
        )
        if extra_lines:
            block += "\n" + "\n".join(extra_lines)
        lines.append(block)
        pos += f["width"]
    return "\n".join(lines)


def _rules_yaml(schema: dict) -> str:
    mutable = [
        f for f in schema["fields"]
        if f.get("mutable") and f["gen"] not in ("key", "computed", "sub_enum")
    ]
    if not mutable:
        return "rules: []"

    lines = ["rules:"]
    for f in mutable:
        name  = f["name"]
        label = name.replace("_", " ").capitalize()
        lines += [
            f'  - name: "{label}"',
            f'    logic: AND',
            f'    rule_type: incoherence',
            f'    fields:',
            f'      - source_field: {name}',
            f'        target_field: {name}',
            f'        operator: differs',
        ]
        if f["da"] == "decimal":
            lines.append(f'        tolerance: 0')
    return "\n".join(lines)


def _yaml_header(schema: dict, ref_label: str, tgt_label: str, ref_fmt: str, tgt_fmt: str) -> str:
    return (
        f'meta:\n'
        f'  name: "Audit {schema["label"]} — {ref_fmt} → {tgt_fmt}"\n'
        f'  version: "1.0"\n'
    )


def _yaml_join(schema: dict) -> str:
    key = schema["key"]
    return (
        f"join:\n"
        f"  keys:\n"
        f"    - source_field: {key}\n"
        f"      target_field: {key}\n"
    )


def gen_yaml_csv_jsonl(schema: dict) -> str:
    label  = schema["label"]
    fields = _fields_yaml(schema)
    return f"""\
{_yaml_header(schema, label, label, "CSV", "JSONL")}
sources:
  reference:
    label: "{label} (référence CSV)"
    format: csv
    encoding: utf-8
    delimiter: ";"
    has_header: true
    fields:
{fields}

  target:
    label: "{label} (cible JSONL)"
    format: jsonl
    encoding: utf-8
    fields:
{fields}

{_yaml_join(schema)}
{_rules_yaml(schema)}

report:
  show_matching: false
  max_diff_preview: 2000
"""


def gen_yaml_csv_json(schema: dict) -> str:
    label  = schema["label"]
    fields = _fields_yaml(schema)
    return f"""\
{_yaml_header(schema, label, label, "CSV", "JSON")}
sources:
  reference:
    label: "{label} (référence CSV)"
    format: csv
    encoding: utf-8
    delimiter: ";"
    has_header: true
    fields:
{fields}

  target:
    label: "{label} (cible JSON)"
    format: json
    encoding: utf-8
    json_path: records
    fields:
{fields}

{_yaml_join(schema)}
{_rules_yaml(schema)}

report:
  show_matching: false
  max_diff_preview: 2000
"""


def gen_yaml_csv_dat(schema: dict) -> str:
    label     = schema["label"]
    csv_fields = _fields_yaml(schema)
    dat_pos   = _dat_positions_yaml(schema)
    return f"""\
{_yaml_header(schema, label, label, "CSV", "DAT positionnel")}
sources:
  reference:
    label: "{label} (référence CSV)"
    format: csv
    encoding: utf-8
    delimiter: ";"
    has_header: true
    fields:
{csv_fields}

  target:
    label: "{label} (cible DAT positionnel)"
    format: dat
    encoding: utf-8
    fixed_width: true
    column_positions:
{dat_pos}

{_yaml_join(schema)}
{_rules_yaml(schema)}

report:
  show_matching: false
  max_diff_preview: 2000
"""


# ─── Point d'entrée ───────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--domain",  required=True, choices=list(SCHEMAS),
                    help="Domaine métier")
    ap.add_argument("--rows",    required=True, type=int,
                    help="Nombre de lignes à générer")
    ap.add_argument("--rate",    type=float, default=_DEFAULT_RATE,
                    help=f"Taux de mutation (défaut : {_DEFAULT_RATE})")
    ap.add_argument("--orphan-rate", dest="orphan_rate", type=float, default=_DEFAULT_ORPHAN,
                    help=f"Fraction orphelins A (défaut : {_DEFAULT_ORPHAN})")
    ap.add_argument("--seed",    type=int, default=42,
                    help="Graine aléatoire (défaut : 42)")
    ap.add_argument("--out",     default=None,
                    help="Répertoire de sortie (défaut : datasets/<domain>_<rows>)")
    args = ap.parse_args()

    rng    = random.Random(args.seed)
    schema = SCHEMAS[args.domain]()
    outdir = Path(args.out) if args.out else Path("datasets") / f"{args.domain}_{args.rows}"
    outdir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== Génération {schema['domain']} — {args.rows} lignes (seed={args.seed}) ===")
    print(f"    Répertoire : {outdir}/\n")

    # ── Référence ────────────────────────────────────────────────────────
    ref_rows = [generate_row(schema, i + 1, rng) for i in range(args.rows)]
    print(f"  ✓ Référence  : {len(ref_rows):>6} lignes générées")

    # ── Mutations ────────────────────────────────────────────────────────
    tgt_rows, log = apply_mutations(schema, ref_rows, args.rate, args.orphan_rate, rng)
    n_orphans  = sum(1 for e in log if e["type"] == "ORPHELIN_A")
    n_mut_keys = len({e["key"] for e in log if e["type"] == "MUTATION"})
    n_mut_flds = sum(1 for e in log if e["type"] == "MUTATION")
    print(f"  ✓ Cible      : {len(tgt_rows):>6} lignes "
          f"({n_orphans} orphelins A, {n_mut_keys} lignes mutées, {n_mut_flds} champs modifiés)\n")

    # ── Écriture des fichiers ─────────────────────────────────────────────
    files = {
        "reference.csv":        lambda p: write_csv(p, ref_rows, schema),
        "target.jsonl":         lambda p: write_jsonl(p, tgt_rows),
        "target.json":          lambda p: write_json(p, tgt_rows, schema, len(ref_rows)),
        "target.dat":           lambda p: write_dat(p, tgt_rows, schema),
        "audit_csv_jsonl.yaml": lambda p: p.write_text(gen_yaml_csv_jsonl(schema), encoding="utf-8"),
        "audit_csv_json.yaml":  lambda p: p.write_text(gen_yaml_csv_json(schema),  encoding="utf-8"),
        "audit_csv_dat.yaml":   lambda p: p.write_text(gen_yaml_csv_dat(schema),   encoding="utf-8"),
        "mutations.log":        lambda p: write_mutations_log(p, log, schema, len(ref_rows)),
    }

    for filename, writer in files.items():
        path = outdir / filename
        writer(path)
        size = path.stat().st_size
        print(f"  ✓ {filename:<30} {size:>8} octets")

    # ── Résumé ────────────────────────────────────────────────────────────
    print(f"\n  Taux effectif : "
          f"{n_orphans / len(ref_rows) * 100:.1f}% orphelins A, "
          f"{n_mut_keys / len(ref_rows) * 100:.1f}% mutations")
    print(f"\n  Pour auditer avec DataAuditor, chargez :")
    print(f"    Référence : {outdir}/reference.csv")
    print(f"    Cible     : {outdir}/target.jsonl  (ou .json, .dat)")
    print(f"    Config    : {outdir}/audit_csv_jsonl.yaml  (ou _json, _dat)\n")


if __name__ == "__main__":
    main()
