#!/usr/bin/env python3
"""
cli.py — Interface en ligne de commande pour DataAuditor.

Usage :
  python src/cli.py audit --ref data.dat --tgt result.csv --config audit.yaml
  python src/cli.py audit --ref data.dat --tgt result.csv --config audit.yaml --out reports/ --format csv
  python src/cli.py audit --ref data.dat --tgt result.csv --config audit.yaml --format json --stdout

Codes de retour :
  0  — Aucun KO (audit propre)
  1  — KO détectés
  2  — Erreur (config invalide, fichier introuvable, etc.)
"""
import argparse
import csv
import io
import json
import os
import sys
from datetime import datetime

# Ajouter src/ au path pour les imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config_loader import load_config, ConfigError
from parser        import parse_file
from normalizer    import normalize_dataframe
from unpivot       import unpivot_dataframe
from comparator    import compare_with_progress
from filters       import apply_filters
import report


def run_audit(ref_path: str, tgt_path: str, config_path: str,
              out_dir: str | None = None, fmt: str = "csv",
              use_stdout: bool = False, quiet: bool = False) -> int:
    """
    Lance un audit en mode CLI.

    Returns:
        0 si aucun KO, 1 si KO détectés, 2 si erreur.
    """
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            yaml_text = f.read()
        config = load_config(yaml_text)

        with open(ref_path, "rb") as f:
            ref_bytes = f.read()
        with open(tgt_path, "rb") as f:
            tgt_bytes = f.read()

        src_ref = config["sources"]["reference"]
        src_tgt = config["sources"]["target"]

        if not quiet:
            print("[1/5] Parsing…", flush=True)
        df_ref = parse_file(ref_bytes, src_ref)
        df_tgt = parse_file(tgt_bytes, src_tgt)

        if not quiet:
            print("[2/5] Normalisation…", flush=True)
        df_ref = normalize_dataframe(df_ref, src_ref)
        df_tgt = normalize_dataframe(df_tgt, src_tgt)

        if src_ref.get("unpivot"):
            df_ref = unpivot_dataframe(df_ref, src_ref["unpivot"])
        if src_tgt.get("unpivot"):
            df_tgt = unpivot_dataframe(df_tgt, src_tgt["unpivot"])

        filters = config.get("filters", [])
        if filters:
            if not quiet:
                print("[3/5] Filtres…", flush=True)
            df_ref, df_tgt = apply_filters(df_ref, df_tgt, filters, config)

        if not quiet:
            print("[4/5] Comparaison…", end="", flush=True)

        results = []
        summary = {}
        last_bucket = -1
        for event in compare_with_progress(df_ref, df_tgt, config):
            if event["event"] == "result":
                results.append(event)
            elif event["event"] == "summary":
                summary = {k: v for k, v in event.items() if k != "event"}
            elif event["event"] == "progress" and not quiet:
                pct = event.get("pct", 0)
                bucket = pct // 10
                if bucket > last_bucket:
                    last_bucket = bucket
                    print(f" {pct}%", end="", flush=True)
        if not quiet:
            print(" OK", flush=True)

        has_ko = (
            summary.get("divergents", 0) > 0
            or summary.get("orphelins_a", 0) > 0
            or summary.get("orphelins_b", 0) > 0
        )

        if not quiet:
            oa = summary.get("orphelins_a", 0)
            ob = summary.get("orphelins_b", 0)
            ko = summary.get("divergents", 0)
            ok = summary.get("ok", 0)
            tr = summary.get("total_reference", 0)
            tc = summary.get("total_cible", 0)
            print(f"[5/5] Résultats :")
            print(f"  Référence   : {tr:,} enr.")
            print(f"  Cible       : {tc:,} enr.")
            print(f"  Orphelins A : {oa:,}")
            print(f"  Orphelins B : {ob:,}")
            print(f"  KO          : {ko:,}")
            print(f"  OK          : {ok:,}")
            for rule, ko_count in (summary.get("rule_stats") or {}).items():
                print(f"    [{rule}] KO={ko_count:,}")

        # ── Sortie ──────────────────────────────────────────────
        if use_stdout:
            if fmt == "json":
                print(json.dumps({"summary": summary, "results": results},
                                 ensure_ascii=False, indent=2))
            else:
                buf = io.StringIO()
                if results:
                    writer = csv.DictWriter(buf, fieldnames=list(results[0].keys()))
                    writer.writeheader()
                    writer.writerows(results)
                sys.stdout.write(buf.getvalue())
        elif out_dir:
            os.makedirs(out_dir, exist_ok=True)
            ts   = datetime.now().strftime("%Y%m%d%H%M")
            name = (config.get("meta") or {}).get("name", "audit").replace(" ", "_")
            if fmt == "html":
                path = os.path.join(out_dir, f"{ts}_{name}.html")
                data = report.to_html(results, summary, config)
            elif fmt == "json":
                path = os.path.join(out_dir, f"{ts}_{name}.json")
                data = json.dumps({"summary": summary, "results": results},
                                  ensure_ascii=False, indent=2).encode("utf-8")
            else:
                path = os.path.join(out_dir, f"{ts}_{name}.csv")
                csv_str = report.to_csv(results, config)
                data = csv_str.encode("utf-8-sig")
            with open(path, "wb") as f:
                f.write(data)
            if not quiet:
                print(f"  Export : {path}")

        return 1 if has_ko else 0

    except ConfigError as e:
        print(f"Erreur de configuration : {e}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"Fichier introuvable : {e}", file=sys.stderr)
        return 2
    except Exception as e:
        print(f"Erreur inattendue : {e}", file=sys.stderr)
        return 2


def main():
    parser = argparse.ArgumentParser(
        prog="python src/cli.py",
        description="DataAuditor CLI — compare deux fichiers selon une config YAML",
    )
    sub = parser.add_subparsers(dest="command")

    audit_p = sub.add_parser("audit", help="Lancer un audit de comparaison")
    audit_p.add_argument("--ref",    required=True,
                         help="Chemin vers le fichier de référence (Source A)")
    audit_p.add_argument("--tgt",    required=True,
                         help="Chemin vers le fichier cible (Source B)")
    audit_p.add_argument("--config", required=True,
                         help="Chemin vers le fichier de configuration YAML")
    audit_p.add_argument("--out",    default=None,
                         help="Dossier de sortie pour l'export (optionnel)")
    audit_p.add_argument("--format", choices=["csv", "html", "json"], default="csv",
                         help="Format d'export : csv (défaut), html, json")
    audit_p.add_argument("--stdout", action="store_true",
                         help="Écrire les résultats sur stdout au lieu d'un fichier")
    audit_p.add_argument("--quiet",  action="store_true",
                         help="Supprimer les messages de progression (erreurs uniquement)")

    args = parser.parse_args()

    if args.command == "audit":
        rc = run_audit(
            ref_path   = args.ref,
            tgt_path   = args.tgt,
            config_path= args.config,
            out_dir    = args.out,
            fmt        = args.format,
            use_stdout = args.stdout,
            quiet      = args.quiet,
        )
        sys.exit(rc)
    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
