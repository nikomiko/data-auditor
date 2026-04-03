"""
results_db.py — SQLite in-memory results storage and query layer.

Each audit session gets a single sqlite3.Connection (:memory: database).
The results table is populated as events arrive from the comparator,
then queried for pagination, filtering, sorting, and export.
"""
import sqlite3
from collections import OrderedDict


def create_results_db():
    """Create an in-memory SQLite database for results."""
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute("""
        CREATE TABLE results (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            join_key     TEXT NOT NULL,
            type_ecart   TEXT,
            rule_name    TEXT,
            rule_id      INTEGER,
            source_field TEXT,
            target_field TEXT,
            source_value TEXT,
            target_value TEXT,
            detail       TEXT
        )
    """)
    conn.execute("CREATE INDEX idx_join_key ON results(join_key)")
    conn.execute("CREATE INDEX idx_rule_id ON results(rule_id)")
    conn.commit()
    return conn


def insert_result(conn, result_dict):
    """Insert a single result event into the database."""
    conn.execute("""
        INSERT INTO results (
            join_key, type_ecart, rule_name, rule_id,
            source_field, target_field, source_value, target_value, detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        result_dict.get("join_key", ""),
        result_dict.get("type_ecart"),
        result_dict.get("rule_name"),
        result_dict.get("rule_id"),
        result_dict.get("source_field", ""),
        result_dict.get("target_field", ""),
        result_dict.get("source_value", ""),
        result_dict.get("target_value", ""),
        result_dict.get("detail", ""),
    ))


def get_rule_counts(conn):
    """Return {rule_name: count} for non-NULL rule_names."""
    rows = conn.execute("""
        SELECT rule_name, COUNT(*) as cnt
        FROM results
        WHERE rule_name IS NOT NULL
        GROUP BY rule_name
    """).fetchall()
    return {name: cnt for name, cnt in rows}


def get_total_count(conn):
    """Return total number of result records."""
    return conn.execute("SELECT COUNT(*) FROM results").fetchone()[0]


def get_grouped_results(
    conn,
    page=1,
    size=100,
    sort_col="",
    sort_dir="asc",
    active_rules=None,
    rule_logic="OR",
    q="",
    extra_ref=None,
    extra_tgt=None,
    ref_rows_map=None,
    tgt_rows_map=None,
):
    """
    Fetch paginated, filtered, and sorted results grouped by join_key.

    Returns:
        {
            "total": total_matching_rows,
            "page": current_page,
            "size": page_size,
            "pages": total_pages,
            "results": [
                {
                    "join_key": "...",
                    "ecarts": [
                        {"rule_id": ..., "rule_name": ..., ...},
                        ...
                    ],
                    "_ref": {...},  # if extra_ref requested
                    "_tgt": {...},  # if extra_tgt requested
                }
            ]
        }
    """
    if extra_ref is None:
        extra_ref = []
    if extra_tgt is None:
        extra_tgt = []
    if ref_rows_map is None:
        ref_rows_map = {}
    if tgt_rows_map is None:
        tgt_rows_map = {}

    # ── Build WHERE clause for rule filtering ──────────────────
    where_clauses = []
    params = []

    if active_rules is not None:
        if not active_rules:
            # Empty set → no results
            return {
                "total": 0,
                "page": 1,
                "size": size,
                "pages": 1,
                "results": [],
            }

        if rule_logic == "AND":
            # All active_rules must be present in the same join_key group
            # We can't do this efficiently in SQL without subqueries,
            # so we'll filter in Python after grouping
            pass
        else:
            # OR: at least one rule_id in active_rules
            placeholders = ",".join("?" * len(active_rules))
            where_clauses.append(f"rule_id IN ({placeholders})")
            params.extend(active_rules)

    # ── Build text search WHERE clause ─────────────────────────
    if q:
        search_pattern = f"%{q}%"
        where_clauses.append("""
            (
                LOWER(join_key) LIKE LOWER(?)
                OR LOWER(rule_name) LIKE LOWER(?)
                OR LOWER(source_value) LIKE LOWER(?)
                OR LOWER(target_value) LIKE LOWER(?)
                OR LOWER(source_field) LIKE LOWER(?)
                OR LOWER(target_field) LIKE LOWER(?)
                OR LOWER(detail) LIKE LOWER(?)
            )
        """)
        params.extend([search_pattern] * 7)

    where_sql = " AND ".join(where_clauses) if where_clauses else "1"

    # ── Fetch all matching results ─────────────────────────────
    rows = conn.execute(f"""
        SELECT
            join_key, type_ecart, rule_name, rule_id,
            source_field, target_field, source_value, target_value, detail
        FROM results
        WHERE {where_sql}
        ORDER BY join_key ASC
    """, params).fetchall()

    # ── Group by join_key ──────────────────────────────────────
    grouped = OrderedDict()
    for row in rows:
        join_key = row[0]
        if join_key not in grouped:
            grouped[join_key] = {
                "join_key": join_key,
                "ecarts": [],
            }
        grouped[join_key]["ecarts"].append({
            "type_ecart": row[1],
            "rule_name": row[2],
            "rule_id": row[3],
            "source_field": row[4],
            "target_field": row[5],
            "source_value": row[6],
            "target_value": row[7],
            "detail": row[8],
        })

    # ── Apply AND rule filtering (after grouping) ──────────────
    if active_rules is not None and rule_logic == "AND":
        filtered = []
        for row in grouped.values():
            matched_rules = {e["rule_id"] for e in row["ecarts"]}
            if active_rules.issubset(matched_rules):
                filtered.append(row)
        grouped = OrderedDict((r["join_key"], r) for r in filtered)

    # ── Apply text search to extra columns (after grouping) ────
    if q and (extra_ref or extra_tgt):
        q_lower = q.lower()
        filtered = []
        for row in grouped.values():
            key = row["join_key"]
            match = False
            if extra_ref:
                for c in extra_ref:
                    if q_lower in str(ref_rows_map.get(key, {}).get(c, "")).lower():
                        match = True
                        break
            if not match and extra_tgt:
                for c in extra_tgt:
                    if q_lower in str(tgt_rows_map.get(key, {}).get(c, "")).lower():
                        match = True
                        break
            if match:
                filtered.append(row)
        grouped = OrderedDict((r["join_key"], r) for r in filtered)

    result_rows = list(grouped.values())

    # ── Apply sorting ──────────────────────────────────────────
    reverse = sort_dir == "desc"
    _GRAVITY = {"_ko": 3, "ko": 2, "ok": 1, "_ok": 0}

    if sort_col == "key":
        result_rows.sort(key=lambda r: str(r["join_key"] or "").lower(), reverse=reverse)
    elif sort_col.startswith("key_"):
        try:
            ki = int(sort_col[4:])
        except ValueError:
            ki = 0

        def _key_part(r, key_idx=ki):
            parts = str(r["join_key"] or "").split("§")
            return parts[key_idx].lower() if key_idx < len(parts) else ""

        result_rows.sort(key=_key_part, reverse=reverse)
    elif sort_col == "type":
        def _type_sort_key(r):
            return min(
                (_GRAVITY.get(e.get("type_ecart"), 99) for e in r["ecarts"]),
                default=99
            )

        result_rows.sort(key=_type_sort_key, reverse=reverse)
    elif sort_col.startswith("xc_ref:") or sort_col.startswith("xc_tgt:"):
        side, col = sort_col.split(":", 1)
        xc_map = ref_rows_map if side == "xc_ref" else tgt_rows_map

        def _xc_sort_key(r, m=xc_map, c=col):
            s = str(m.get(r["join_key"], {}).get(c, "") or "").strip()
            if not s:
                return (2, 0.0, "")
            try:
                return (0, float(s.replace(",", ".")), "")
            except ValueError:
                return (1, 0.0, s.lower())

        result_rows.sort(key=_xc_sort_key, reverse=reverse)

    # ── Pagination ─────────────────────────────────────────────
    total = len(result_rows)
    pages = max(1, (total + size - 1) // size)
    page = min(page, pages)
    page_r = result_rows[(page - 1) * size : page * size]

    # ── Enrich extra columns ───────────────────────────────────
    if extra_ref or extra_tgt:
        enriched = []
        for r in page_r:
            key = r["join_key"]
            row = {"join_key": key, "ecarts": r["ecarts"]}
            if extra_ref:
                row["_ref"] = {c: ref_rows_map.get(key, {}).get(c, "") for c in extra_ref}
            if extra_tgt:
                row["_tgt"] = {c: tgt_rows_map.get(key, {}).get(c, "") for c in extra_tgt}
            enriched.append(row)
        page_r = enriched

    return {
        "total": total,
        "page": page,
        "size": size,
        "pages": pages,
        "results": page_r,
    }


def get_flat_results(
    conn,
    active_rules=None,
    rule_logic="OR",
    q="",
    extra_ref=None,
    extra_tgt=None,
    ref_rows_map=None,
    tgt_rows_map=None,
):
    """
    Fetch all matching results as a flat list (for export).
    Same filtering logic as get_grouped_results, but returns flat list.
    """
    if extra_ref is None:
        extra_ref = []
    if extra_tgt is None:
        extra_tgt = []
    if ref_rows_map is None:
        ref_rows_map = {}
    if tgt_rows_map is None:
        tgt_rows_map = {}

    # ── Build WHERE clause for rule filtering ──────────────────
    where_clauses = []
    params = []

    if active_rules is not None:
        if not active_rules:
            # Empty set → no results
            return []

        if rule_logic == "AND":
            # For flat results + AND logic, we need to group and check
            # We'll do this in Python after fetching
            pass
        else:
            # OR: at least one rule_id in active_rules
            placeholders = ",".join("?" * len(active_rules))
            where_clauses.append(f"rule_id IN ({placeholders})")
            params.extend(active_rules)

    # ── Build text search WHERE clause ─────────────────────────
    if q:
        search_pattern = f"%{q}%"
        where_clauses.append("""
            (
                LOWER(join_key) LIKE LOWER(?)
                OR LOWER(rule_name) LIKE LOWER(?)
                OR LOWER(source_value) LIKE LOWER(?)
                OR LOWER(target_value) LIKE LOWER(?)
                OR LOWER(source_field) LIKE LOWER(?)
                OR LOWER(target_field) LIKE LOWER(?)
                OR LOWER(detail) LIKE LOWER(?)
            )
        """)
        params.extend([search_pattern] * 7)

    where_sql = " AND ".join(where_clauses) if where_clauses else "1"

    rows = conn.execute(f"""
        SELECT
            join_key, type_ecart, rule_name, rule_id,
            source_field, target_field, source_value, target_value, detail
        FROM results
        WHERE {where_sql}
    """, params).fetchall()

    # ── Convert to dict format ─────────────────────────────────
    results = []
    for row in rows:
        results.append({
            "join_key": row[0],
            "type_ecart": row[1],
            "rule_name": row[2],
            "rule_id": row[3],
            "source_field": row[4],
            "target_field": row[5],
            "source_value": row[6],
            "target_value": row[7],
            "detail": row[8],
        })

    # ── Apply AND rule filtering ───────────────────────────────
    if active_rules is not None and rule_logic == "AND":
        from collections import defaultdict
        grouped = defaultdict(list)
        for r in results:
            grouped[r["join_key"]].append(r)

        filtered_results = []
        for key, ecarts in grouped.items():
            matched_rules = {e["rule_id"] for e in ecarts}
            if active_rules.issubset(matched_rules):
                filtered_results.extend(ecarts)
        results = filtered_results

    # ── Apply text search to extra columns ──────────────────────
    if q and (extra_ref or extra_tgt):
        q_lower = q.lower()
        from collections import defaultdict
        grouped = defaultdict(list)
        for r in results:
            grouped[r["join_key"]].append(r)

        filtered_results = []
        for key, ecarts in grouped.items():
            match = False
            if extra_ref:
                for c in extra_ref:
                    if q_lower in str(ref_rows_map.get(key, {}).get(c, "")).lower():
                        match = True
                        break
            if not match and extra_tgt:
                for c in extra_tgt:
                    if q_lower in str(tgt_rows_map.get(key, {}).get(c, "")).lower():
                        match = True
                        break
            if match:
                filtered_results.extend(ecarts)
        results = filtered_results

    return results
