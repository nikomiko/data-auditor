#!/usr/bin/env python3
"""
run_tests.py — Tests automatisés DataAuditor via l'API HTTP.

Usage :
    # Démarrer le serveur dans un terminal séparé :
    #   python3 server.py
    # Puis, dans un autre terminal :
    python3 sample/run_tests.py [--url http://localhost:5000] [--verbose] [--scenario NOM]

Le script :
  1. Soumet chaque scénario via POST /api/audit (fichiers + YAML)
  2. Lit le flux SSE /api/stream/{token} jusqu'à l'événement 'done'
  3. Interroge GET /api/results/{token} pour l'ensemble des résultats
  4. Vérifie les totaux du summary ET les résultats clé par clé
  5. Affiche un rapport pass/fail coloré
"""

import argparse
import json
import os
import sys
import time

try:
    import requests
except ImportError:
    print("⚠  Module 'requests' absent. Installez-le : pip3 install requests")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────
#  Chemins
# ─────────────────────────────────────────────────────────────
JDD = os.path.join(os.path.dirname(__file__), "jdd")


def jdd(filename):
    return os.path.join(JDD, filename)


# ─────────────────────────────────────────────────────────────
#  Résultats attendus — format long (non pivoté)
# ─────────────────────────────────────────────────────────────
# Les assertions sont indépendantes de la combinaison de formats :
# le même JDD produit toujours les mêmes écarts.
#
# Structure :
#   "summary" → vérifications sur le bloc summary SSE
#   "keys"    → dict {join_key: {"types": set, "rules": set}}
#     types : ensemble de type_ecart attendus pour cette clé
#     rules : ensemble de rule_name KO attendus (None si ORPHELIN)

EXPECTED_LONG = {
    "summary": {
        "orphelins_a":  3,   # P001/PAR, P001/LYO, P001/MAR
        "orphelins_b":  3,   # P002/PAR, P002/LYO, P002/MAR
        # KO par règle :
        "rule_ko": {
            "Quantite":    2,  # P003/PAR, P009/PAR
            "Prix HT":     2,  # P004/LYO, P009/PAR
            "Designation": 1,  # P006/PAR
            "Statut":      1,  # P007/LYO
            "Code-barres": 1,  # P008/MAR
        },
    },
    "keys": {
        # Séparateur de clé composite : § (U+00A7), cf. comparator._build_key_series
        # ORPHELINS A
        "P001§PAR": {"types": {"ORPHELIN_A"}, "rules": set()},
        "P001§LYO": {"types": {"ORPHELIN_A"}, "rules": set()},
        "P001§MAR": {"types": {"ORPHELIN_A"}, "rules": set()},
        # ORPHELINS B
        "P002§PAR": {"types": {"ORPHELIN_B"}, "rules": set()},
        "P002§LYO": {"types": {"ORPHELIN_B"}, "rules": set()},
        "P002§MAR": {"types": {"ORPHELIN_B"}, "rules": set()},
        # KO règles
        "P003§PAR": {"types": {"KO"},         "rules": {"Quantite"}},
        "P004§LYO": {"types": {"KO"},         "rules": {"Prix HT"}},
        "P005§MAR": {"types": {"OK"},         "rules": set()},          # OK visible car show_matching (rule_name vide pour OK)
        "P006§PAR": {"types": {"KO"},         "rules": {"Designation"}},
        "P007§LYO": {"types": {"KO"},         "rules": {"Statut"}},
        "P008§MAR": {"types": {"KO"},         "rules": {"Code-barres"}},
        "P009§PAR": {"types": {"KO"},         "rules": {"Quantite", "Prix HT"}},
    },
}

# Format pivoté : mêmes clés (après unpivot), mêmes anomalies
EXPECTED_WIDE = EXPECTED_LONG

# ─────────────────────────────────────────────────────────────
#  Scénarios
# ─────────────────────────────────────────────────────────────
SCENARIOS = [
    # ── Même format ────────────────────────────────────────────
    {
        "name":    "CSV → CSV (long)",
        "config":  jdd("cfg_csv.yaml"),
        "ref":     jdd("ref_long.csv"),
        "tgt":     jdd("tgt_long.csv"),
        "expected": EXPECTED_LONG,
    },
    {
        "name":    "TXT → TXT (pré-filtre + positionnel)",
        "config":  jdd("cfg_txt.yaml"),
        "ref":     jdd("ref_long.txt"),
        "tgt":     jdd("tgt_long.txt"),
        "expected": EXPECTED_LONG,
    },
    {
        "name":    "CSV wide → CSV long (unpivot)",
        "config":  jdd("cfg_wide_csv.yaml"),
        "ref":     jdd("ref_wide.csv"),
        "tgt":     jdd("tgt_long.csv"),
        "expected": EXPECTED_WIDE,
    },
    {
        "name":    "TXT wide → TXT long (unpivot + pré-filtre)",
        "config":  jdd("cfg_wide_txt.yaml"),
        "ref":     jdd("ref_wide.txt"),
        "tgt":     jdd("tgt_long.txt"),
        "expected": EXPECTED_WIDE,
    },
    {
        "name":    "JSON → JSON (imbriqué, json_path + path)",
        "config":  jdd("cfg_json.yaml"),
        "ref":     jdd("ref.json"),
        "tgt":     jdd("tgt.json"),
        "expected": EXPECTED_LONG,
    },
    {
        "name":    "JSONL → JSONL (imbriqué, path)",
        "config":  jdd("cfg_jsonl.yaml"),
        "ref":     jdd("ref.jsonl"),
        "tgt":     jdd("tgt.jsonl"),
        "expected": EXPECTED_LONG,
    },
    {
        "name":    "XLSX → XLSX",
        "config":  jdd("cfg_xlsx.yaml"),
        "ref":     jdd("ref.xlsx"),
        "tgt":     jdd("tgt.xlsx"),
        "expected": EXPECTED_LONG,
    },
    # ── Cross-format ────────────────────────────────────────────
    {
        "name":    "CSV → JSONL (cross-format)",
        "config":  jdd("cfg_csv_vs_jsonl.yaml"),
        "ref":     jdd("ref_long.csv"),
        "tgt":     jdd("tgt.jsonl"),
        "expected": EXPECTED_LONG,
    },
    {
        "name":    "TXT positionnel → CSV (cross-format)",
        "config":  jdd("cfg_txt_vs_csv.yaml"),
        "ref":     jdd("ref_long.txt"),
        "tgt":     jdd("tgt_long.csv"),
        "expected": EXPECTED_LONG,
    },
    {
        "name":    "JSON → CSV (cross-format)",
        "config":  jdd("cfg_json_vs_csv.yaml"),
        "ref":     jdd("ref.json"),
        "tgt":     jdd("tgt_long.csv"),
        "expected": EXPECTED_LONG,
    },
    {
        "name":    "XLSX → JSONL (cross-format)",
        "config":  jdd("cfg_xlsx_vs_jsonl.yaml"),
        "ref":     jdd("ref.xlsx"),
        "tgt":     jdd("tgt.jsonl"),
        "expected": EXPECTED_LONG,
    },
]


# ─────────────────────────────────────────────────────────────
#  API helpers
# ─────────────────────────────────────────────────────────────

def submit_audit(base_url, config_path, ref_path, tgt_path):
    """POST /api/audit → token."""
    with open(config_path, "rb") as f_cfg, \
         open(ref_path,    "rb") as f_ref, \
         open(tgt_path,    "rb") as f_tgt:
        r = requests.post(
            f"{base_url}/api/audit",
            files={"file_ref": f_ref, "file_tgt": f_tgt},
            data={"config_yaml": f_cfg.read().decode("utf-8")},
            timeout=30,
        )
    r.raise_for_status()
    return r.json()["token"]


def stream_until_done(base_url, token, timeout=120):
    """
    Lit le flux SSE ligne par ligne et retourne (summary_dict, error_str | None).
    """
    summary = {}
    with requests.get(f"{base_url}/api/stream/{token}", stream=True, timeout=timeout) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            try:
                evt = json.loads(line[5:])
            except json.JSONDecodeError:
                continue
            if evt.get("event") == "error":
                return {}, evt.get("message", "erreur inconnue")
            if evt.get("event") == "summary":
                summary = evt
            if evt.get("event") == "done":
                return summary, None
    return summary, "Flux SSE terminé sans événement 'done'"


def fetch_all_results(base_url, token, page_size=500):
    """GET /api/results/{token} (toutes pages) → liste de rows groupés."""
    rows = []
    page = 1
    while True:
        r = requests.get(
            f"{base_url}/api/results/{token}",
            params={"page": page, "size": page_size, "types": "ORPHELIN_A,ORPHELIN_B,KO,OK"},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        rows.extend(data.get("results", []))   # l'API retourne "results", pas "rows"
        if page >= data.get("pages", 1):
            break
        page += 1
    return rows


# ─────────────────────────────────────────────────────────────
#  Vérifications
# ─────────────────────────────────────────────────────────────

def check_scenario(summary, rows, expected, verbose):
    """
    Retourne (passed: bool, failures: list[str]).
    """
    failures = []
    exp_s = expected["summary"]

    # ── Totaux summary ──────────────────────────────────────────
    got_oa = summary.get("orphelins_a", 0)
    got_ob = summary.get("orphelins_b", 0)
    if got_oa != exp_s["orphelins_a"]:
        failures.append(f"orphelins_a : attendu {exp_s['orphelins_a']}, obtenu {got_oa}")
    if got_ob != exp_s["orphelins_b"]:
        failures.append(f"orphelins_b : attendu {exp_s['orphelins_b']}, obtenu {got_ob}")

    # ── Compte KO par règle ─────────────────────────────────────
    rule_ko_got = {}
    for row in rows:
        for e in row.get("ecarts", []):
            if e["type_ecart"] == "KO" and e.get("rule_name"):
                rule_ko_got[e["rule_name"]] = rule_ko_got.get(e["rule_name"], 0) + 1

    for rule, exp_count in exp_s["rule_ko"].items():
        got = rule_ko_got.get(rule, 0)
        if got != exp_count:
            failures.append(f"rule_ko[{rule!r}] : attendu {exp_count}, obtenu {got}")

    # ── Vérifications clé par clé ───────────────────────────────
    rows_by_key = {r["join_key"]: r for r in rows}

    for join_key, exp_row in expected["keys"].items():
        got_row = rows_by_key.get(join_key)
        if got_row is None:
            failures.append(f"clé {join_key!r} absente des résultats")
            continue
        got_types = {e["type_ecart"] for e in got_row["ecarts"]}
        got_rules = {e["rule_name"] for e in got_row["ecarts"] if e.get("rule_name")}

        missing_types = exp_row["types"] - got_types
        extra_types   = got_types - exp_row["types"]
        missing_rules = exp_row["rules"] - got_rules
        extra_rules   = got_rules - exp_row["rules"]

        if missing_types:
            failures.append(f"clé {join_key!r} : types manquants {missing_types}")
        if extra_types:
            failures.append(f"clé {join_key!r} : types inattendus {extra_types}")
        if missing_rules:
            failures.append(f"clé {join_key!r} : règles KO manquantes {missing_rules}")
        if extra_rules:
            failures.append(f"clé {join_key!r} : règles KO inattendues {extra_rules}")

    if verbose and not failures:
        # Afficher les clés vérifiées
        for join_key in sorted(expected["keys"]):
            row = rows_by_key.get(join_key)
            types = {e["type_ecart"] for e in row["ecarts"]} if row else set()
            rules = {e["rule_name"] for e in row["ecarts"] if e.get("rule_name")} if row else set()
            print(f"      ✓ {join_key:<14} types={sorted(types)}  rules={sorted(r for r in rules if r)}")

    return len(failures) == 0, failures


# ─────────────────────────────────────────────────────────────
#  Runner principal
# ─────────────────────────────────────────────────────────────

def run_all(base_url, verbose, filter_name):
    # Vérification serveur
    try:
        r = requests.get(f"{base_url}/api/version", timeout=5)
        version = r.json().get("version", "?")
        print(f"Serveur DataAuditor v{version} — {base_url}\n")
    except Exception as e:
        print(f"⚠  Impossible de joindre le serveur ({base_url}) : {e}")
        print("   Lancez d'abord : python3 server.py")
        sys.exit(1)

    scenarios = SCENARIOS
    if filter_name:
        scenarios = [s for s in scenarios if filter_name.lower() in s["name"].lower()]
        if not scenarios:
            print(f"Aucun scénario ne correspond à '{filter_name}'")
            sys.exit(1)

    passed_total = 0
    failed_total = 0
    skipped_total = 0
    t_start_all = time.time()

    for sc in scenarios:
        name = sc["name"]
        # Vérifier que les fichiers existent
        missing = [p for p in (sc["config"], sc["ref"], sc["tgt"]) if not os.path.exists(p)]
        if missing:
            print(f"  ⚠  SKIP  {name}")
            for p in missing:
                print(f"       Fichier manquant : {os.path.relpath(p)}")
            skipped_total += 1
            continue

        print(f"  ▶  {name}", end="", flush=True)
        t_start = time.time()

        try:
            token = submit_audit(base_url, sc["config"], sc["ref"], sc["tgt"])
            summary, err = stream_until_done(base_url, token)
            if err:
                elapsed = time.time() - t_start
                print(f"  ERREUR ({elapsed:.1f}s)")
                print(f"       {err}")
                failed_total += 1
                continue

            rows = fetch_all_results(base_url, token)
            ok, failures = check_scenario(summary, rows, sc["expected"], verbose)
            elapsed = time.time() - t_start

            if ok:
                print(f"  ✓  ({elapsed:.1f}s)")
                if verbose:
                    pass  # détails déjà affichés dans check_scenario
                passed_total += 1
            else:
                print(f"  ✗  ({elapsed:.1f}s)")
                for f in failures:
                    print(f"       ✗ {f}")
                failed_total += 1

        except Exception as e:
            elapsed = time.time() - t_start
            print(f"  EXCEPTION ({elapsed:.1f}s)")
            print(f"       {type(e).__name__}: {e}")
            failed_total += 1

    elapsed_all = time.time() - t_start_all
    total = passed_total + failed_total + skipped_total
    print()
    print("─" * 60)
    print(f"Résultats : {passed_total}/{total} réussis", end="")
    if skipped_total:
        print(f", {skipped_total} ignorés", end="")
    if failed_total:
        print(f", {failed_total} échoués", end="")
    print(f"  ({elapsed_all:.1f}s total)")

    if failed_total > 0:
        sys.exit(1)


# ─────────────────────────────────────────────────────────────
#  Point d'entrée
# ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tests automatisés DataAuditor")
    parser.add_argument("--url",      default="http://localhost:5000", help="URL du serveur Flask")
    parser.add_argument("--verbose",  action="store_true",             help="Afficher le détail des vérifications")
    parser.add_argument("--scenario", default="",                      help="Filtre sur le nom du scénario")
    args = parser.parse_args()

    run_all(args.url.rstrip("/"), args.verbose, args.scenario)
