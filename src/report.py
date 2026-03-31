"""
report.py — Export CSV/HTML/XLSX et historisation des audits.
"""
import csv
import io
import json
import os
from collections import defaultdict
from datetime import datetime

def _get_reports_dir() -> str:
    """Retourne le répertoire des rapports.

    En mode PyInstaller frozen, les rapports sont stockés à côté du .exe
    (persistant entre les mises à jour), et non dans le répertoire temporaire
    d'extraction (_MEIPASS).
    """
    import sys as _sys
    if getattr(_sys, "frozen", False):
        return os.path.join(os.path.dirname(_sys.executable), "reports")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "reports")

REPORTS_DIR = _get_reports_dir()

_BASE_FIELDS = ["join_key", "rule_name", "rule_type",
                "source_field", "target_field", "source_value", "target_value", "detail"]


# ─────────────────────────────────────────────────────────────
#  Historisation
# ─────────────────────────────────────────────────────────────

def save_history(results: list, summary: dict, config: dict,
                 run_label: str = "", started_at: str = "", finished_at: str = "") -> str:
    os.makedirs(REPORTS_DIR, exist_ok=True)
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    name     = config.get("meta", {}).get("name", "audit").replace(" ", "_")
    filename = f"{ts}_{name}.json"
    path     = os.path.join(REPORTS_DIR, filename)
    meta: dict = {
        "timestamp":    datetime.now().isoformat(),
        "audit_name":   name,
        "config":       config,
        "total_results": len(results),
    }
    if run_label:    meta["run_label"]    = run_label
    if started_at:   meta["started_at"]  = started_at
    if finished_at:  meta["finished_at"] = finished_at
    if started_at and finished_at:
        try:
            from datetime import datetime as _dt
            d = (_dt.fromisoformat(finished_at) - _dt.fromisoformat(started_at)).total_seconds()
            meta["duration_s"] = round(d, 1)
        except Exception:
            pass
    payload  = {"meta": meta, "summary": summary, "results": results}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    return filename


def list_history() -> list:
    os.makedirs(REPORTS_DIR, exist_ok=True)
    files = sorted([f for f in os.listdir(REPORTS_DIR) if f.endswith(".json")], reverse=True)
    out = []
    for fname in files:
        try:
            with open(os.path.join(REPORTS_DIR, fname), encoding="utf-8") as f:
                d = json.load(f)
            m = d.get("meta", {})
            out.append({
                "filename":      fname,
                "timestamp":     m.get("timestamp", ""),
                "audit_name":    m.get("audit_name", ""),
                "run_label":     m.get("run_label", ""),
                "duration_s":    m.get("duration_s"),
                "total_results": m.get("total_results", len(d.get("results", []))),
                "summary":       d.get("summary", {}),
            })
        except Exception:
            continue
    return out


def load_history(filename: str) -> dict:
    path = os.path.join(REPORTS_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Rapport introuvable : {filename}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ─────────────────────────────────────────────────────────────
#  CSV — pivot-friendly (une ligne par écart)
# ─────────────────────────────────────────────────────────────

def to_csv(results: list,
           config: dict = None,
           extra_ref: list = None, extra_tgt: list = None,
           ref_rows_map: dict = None, tgt_rows_map: dict = None,
           ref_label: str = "Référence", tgt_label: str = "Cible") -> str:
    """Export CSV plat — une ligne par écart avec colonnes supplémentaires.

    Format adapté aux tableaux croisés dynamiques Excel.
    """
    config       = config or {}
    extra_ref    = extra_ref or []
    extra_tgt    = extra_tgt or []
    ref_rows_map = ref_rows_map or {}
    tgt_rows_map = tgt_rows_map or {}

    cfg_keys   = config.get("join", {}).get("keys", [])
    key_fields = [k.get("source_field", "Clé") for k in cfg_keys] if cfg_keys else ["Clé"]
    other_fields = ["rule_name", "rule_type", "source_field", "target_field", "source_value", "target_value", "detail"]

    headers = key_fields + other_fields + [
        f"{ref_label} \u00b7 {c}" for c in extra_ref
    ] + [
        f"{tgt_label} \u00b7 {c}" for c in extra_tgt
    ]

    out = io.StringIO()
    w   = csv.writer(out)
    w.writerow(headers)
    for r in results:
        key   = r.get("join_key", "")
        kp    = key.split("\u00a7")  # § separator
        row   = [kp[i] if i < len(kp) else "" for i in range(len(key_fields))]
        row  += [r.get(k, "") for k in other_fields]
        row  += [ref_rows_map.get(key, {}).get(c, "") for c in extra_ref]
        row  += [tgt_rows_map.get(key, {}).get(c, "") for c in extra_tgt]
        w.writerow(row)
    return out.getvalue()


# ─────────────────────────────────────────────────────────────
#  XLSX — onglet DATA + onglet PIVOT
# ─────────────────────────────────────────────────────────────

def to_xlsx(results: list, summary: dict, config: dict,
            extra_ref: list = None, extra_tgt: list = None,
            ref_rows_map: dict = None, tgt_rows_map: dict = None,
            ref_label: str = "Référence", tgt_label: str = "Cible",
            ref_fmt: str = "", tgt_fmt: str = "") -> bytes:

    from openpyxl import Workbook
    from openpyxl.styles import PatternFill, Font, Alignment
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.table import Table, TableStyleInfo

    extra_ref    = extra_ref or []
    extra_tgt    = extra_tgt or []
    ref_rows_map = ref_rows_map or {}
    tgt_rows_map = tgt_rows_map or {}
    name         = config.get("meta", {}).get("name", "Audit")
    cfg_keys     = config.get("join", {}).get("keys", [])
    key_fields   = [k.get("source_field", "Clé") for k in cfg_keys] if cfg_keys else ["Clé"]
    other_hdrs   = ["Règle", "Type", "Champ src.", "Champ cible", "Valeur src.", "Valeur cible", "Détail"]
    other_fields = ["rule_name", "rule_type", "source_field", "target_field", "source_value", "target_value", "detail"]
    n_key        = len(key_fields)
    wb           = Workbook()

    # ── Onglet DATA ───────────────────────────────────────────
    ws = wb.active
    ws.title = "DATA"

    hdr_labels = (
        key_fields + other_hdrs
        + [f"{ref_label} \u00b7 {c}" for c in extra_ref]
        + [f"{tgt_label} \u00b7 {c}" for c in extra_tgt]
    )

    HDR_FILL  = PatternFill("solid", fgColor="2D3748")
    HDR_FONT  = Font(color="FFFFFF", bold=True, size=9)
    REF_HDR_F = PatternFill("solid", fgColor="1E40AF")
    TGT_HDR_F = PatternFill("solid", fgColor="5B21B6")
    REF_ROW_F = PatternFill("solid", fgColor="EFF6FF")
    TGT_ROW_F = PatternFill("solid", fgColor="F5F3FF")

    ws.append(hdr_labels)
    n_base = n_key + len(other_fields)
    n_ref  = len(extra_ref)
    n_tgt  = len(extra_tgt)
    for i, cell in enumerate(ws[1]):
        if i < n_base:
            cell.fill = HDR_FILL
            cell.font = HDR_FONT
        elif i < n_base + n_ref:
            cell.fill = REF_HDR_F
            cell.font = HDR_FONT
        else:
            cell.fill = TGT_HDR_F
            cell.font = HDR_FONT
        cell.alignment = Alignment(horizontal="left")

    ROW_FILLS = {
        "_ko": PatternFill("solid", fgColor="FEE5E5"),  # Orphelins
        "ko":  PatternFill("solid", fgColor="FFFBEA"),  # Règle incoherence
        "ok":  PatternFill("solid", fgColor="ECFDF5"),  # Règle coherence
        "_ok": PatternFill("solid", fgColor="EFF6FF"),  # Clé OK
    }

    for r in results:
        key  = r.get("join_key", "")
        rt   = r.get("rule_type", "")
        kp   = key.split("\u00a7")  # § separator
        row  = [kp[i] if i < len(kp) else "" for i in range(n_key)]
        row += [r.get(k, "") for k in other_fields]
        row += [ref_rows_map.get(key, {}).get(c, "") for c in extra_ref]
        row += [tgt_rows_map.get(key, {}).get(c, "") for c in extra_tgt]
        ws.append(row)
        ri = ws.max_row
        base_fill = ROW_FILLS.get(rt)
        for i, cell in enumerate(ws[ri]):
            if n_base <= i < n_base + n_ref:
                cell.fill = REF_ROW_F
            elif n_base + n_ref <= i:
                cell.fill = TGT_ROW_F
            elif base_fill:
                cell.fill = base_fill

    # Table avec autofiltre
    if ws.max_row > 1:
        last_col = get_column_letter(len(hdr_labels))
        tbl = Table(displayName="DATA", ref=f"A1:{last_col}{ws.max_row}")
        tbl.tableStyleInfo = TableStyleInfo(
            name="TableStyleLight9", showRowStripes=True)
        ws.add_table(tbl)

    ws.freeze_panes = "A2"
    col_widths = [20] * n_key + [12, 20, 20, 18, 18, 35] + [20] * (n_ref + n_tgt)
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()



def _build_pivot_sheet(ws, results, summary, config, audit_name):
    """Feuille PIVOT : résumé par règle et par type d'écart."""
    from openpyxl.styles import PatternFill, Font, Alignment
    from openpyxl.utils import get_column_letter

    def cell(row, col, value="", bold=False, size=9, fg="000000", bg=None,
             align="left", wrap=False):
        c = ws.cell(row=row, column=col, value=value)
        c.font = Font(bold=bold, size=size, color=fg)
        c.alignment = Alignment(horizontal=align, vertical="center", wrap_text=wrap)
        if bg:
            c.fill = PatternFill("solid", fgColor=bg)
        return c

    TITLE_BG = "1E3A5F"
    H2_PRES  = "3B5998"
    H2_RULE  = "2B6CB0"
    H2_SUM   = "374151"
    WHITE    = "FFFFFF"

    def title_row(row, text, ncols=5):
        for c in range(1, ncols + 1):
            ws.cell(row=row, column=c).fill = PatternFill("solid", fgColor=TITLE_BG)
        cell(row, 1, text, bold=True, size=10, fg=WHITE, bg=TITLE_BG)
        ws.row_dimensions[row].height = 20

    def hdr_row(row, labels, bg):
        for i, lbl in enumerate(labels, 1):
            cell(row, i, lbl, bold=True, size=9, fg=WHITE, bg=bg)
        ws.row_dimensions[row].height = 18

    # Titre
    cell(1, 1, f"Rapport d'audit \u2014 {audit_name}", bold=True, size=14)
    cell(2, 1, f"G\u00e9n\u00e9r\u00e9 le {datetime.now().strftime('%d/%m/%Y \u00e0 %H:%M:%S')}",
         size=9, fg="718096")
    ws.row_dimensions[1].height = 24

    row = 4

    # Résumé global
    title_row(row, "R\u00e9capitulatif", 2); row += 1
    hdr_row(row, ["Indicateur", "Valeur"], H2_SUM); row += 1
    for lbl, key in [
        ("R\u00e9f\u00e9rence (lignes)",  "total_reference"),
        ("Cible (lignes)",                "total_cible"),
        ("Orphelins source (A)",          "orphelins_a"),
        ("Orphelins cible  (B)",          "orphelins_b"),
        ("Contr\u00f4les KO",             "divergents"),
        ("Contr\u00f4les OK",             "ok"),
    ]:
        cell(row, 1, lbl, bold=True)
        cell(row, 2, summary.get(key, 0), align="right")
        row += 1
    row += 1

    # Présence
    oa_keys = {r["join_key"] for r in results if r.get("rule_name") == "Source uniq."}
    ob_keys = {r["join_key"] for r in results if r.get("rule_name") == "Cible uniq."}

    title_row(row, "Contr\u00f4les de pr\u00e9sence", 3); row += 1
    hdr_row(row, ["Type", "Description", "Nb cl\u00e9s"], H2_PRES); row += 1
    for rn, desc, keys in [
        ("Source uniq.", "Pr\u00e9sent en r\u00e9f\u00e9rence, absent de la cible", oa_keys),
        ("Cible uniq.", "Absent de la r\u00e9f\u00e9rence, pr\u00e9sent en cible",  ob_keys),
    ]:
        cell(row, 1, rn)
        cell(row, 2, desc, wrap=True)
        cell(row, 3, len(keys), align="right")
        row += 1
    row += 1

    # Par règle
    rule_stats = defaultdict(lambda: defaultdict(
        lambda: {"keys": set(), "ecarts": 0, "champs": set()}
    ))
    for r in results:
        rt = r.get("rule_type"); rn = r.get("rule_name")
        if rt in ("ko", "ok") and rn:
            s = rule_stats[rn][rt]
            s["keys"].add(r.get("join_key", ""))
            s["ecarts"] += 1
            ch = r.get("source_field", "")
            if ch:
                s["champs"].add(ch)

    rule_order = [r["name"] for r in config.get("rules", [])] or sorted(rule_stats)

    title_row(row, "Contr\u00f4les par r\u00e8gle", 5); row += 1
    hdr_row(row, ["R\u00e8gle", "Type",
                  "Nb cl\u00e9s touch\u00e9es", "Nb \u00e9carts",
                  "Champs concern\u00e9s"], H2_RULE)
    row += 1

    for rname in rule_order:
        if rname not in rule_stats:
            continue
        for rt in ("ko", "ok"):
            s = rule_stats[rname].get(rt)
            if not s or not s["ecarts"]:
                continue
            cell(row, 1, rname)
            cell(row, 2, rt.upper())
            cell(row, 3, len(s["keys"]),  align="right")
            cell(row, 4, s["ecarts"],      align="right")
            cell(row, 5, "; ".join(sorted(s["champs"])), wrap=True)
            row += 1

    for col, w in [(1, 30), (2, 14), (3, 20), (4, 12), (5, 50)]:
        ws.column_dimensions[get_column_letter(col)].width = w


# ─────────────────────────────────────────────────────────────
#  HTML — vue courante avec filtres dynamiques JS
# ─────────────────────────────────────────────────────────────

# JavaScript logic (plain string — not f-string, to avoid brace conflicts)
_HTML_JS = r"""
const ALL=__ALL__;
const EXTRA_REF=__EXTRA_REF__;
const EXTRA_TGT=__EXTRA_TGT__;
const KEY_FIELDS=__KEY_FIELDS__;
let aR=new Set(ALL.map(r=>r.rule_name));
let sC=null,sD=1;
function initCounts(){
  const cr={};
  for(const r of ALL){cr[r.rule_name]=(cr[r.rule_name]||0)+1;}
  document.querySelectorAll('[data-k="rule"]').forEach(b=>{const sp=b.querySelector('span');if(sp)sp.textContent=cr[b.dataset.v]||0;});
}
function toggleChip(b){
  b.classList.toggle('on');
  const on=b.classList.contains('on');
  if(on)aR.add(b.dataset.v);else aR.delete(b.dataset.v);
  render();
}
function sortBy(col){
  if(sC===col)sD=-sD;else{sC=col;sD=1;}
  document.querySelectorAll('thead th').forEach(th=>th.classList.remove('sort-asc','sort-desc'));
  document.querySelectorAll('.sort-ic').forEach(ic=>ic.textContent='\u2195');
  const m={join_key:'si-key',rule_name:'si-rule',rule_type:'si-type',source_field:'si-sf',target_field:'si-tf',source_value:'si-sv',target_value:'si-tv',detail:'si-det'};
  const ic=document.getElementById(m[col]);
  if(ic){ic.textContent=sD>0?'\u2191':'\u2193';ic.closest('th').classList.add(sD>0?'sort-asc':'sort-desc');}
  render();
}
const esc=v=>String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function renderRow(r){
  let c='';
  const kp=(r.join_key||'').split('\u00a7');
  KEY_FIELDS.forEach((f,i)=>{c+='<td class="tk">'+esc(kp[i]||'')+'</td>';});
  for(const k of EXTRA_REF)c+='<td class="tv r">'+esc((r._ref||{})[k])+'</td>';
  c+='<td><span class="badge badge-'+esc(r.rule_type)+'">'+esc(r.rule_name)+'</span></td>';
  c+='<td class="tv">'+esc(r.source_field)+'</td>';
  c+='<td class="tv">'+esc(r.target_field)+'</td>';
  c+='<td class="tv r">'+esc(r.source_value)+'</td>';
  c+='<td class="tv t">'+esc(r.target_value)+'</td>';
  for(const k of EXTRA_TGT)c+='<td class="tv t">'+esc((r._tgt||{})[k])+'</td>';
  c+='<td class="td-det" title="'+esc(r.detail)+'">'+esc(r.detail)+'</td>';
  return '<tr>'+c+'</tr>';
}
function render(){
  const q=(document.querySelector('.srch')?.value||'').toLowerCase();
  let rows=ALL.filter(r=>{
    if(!aR.has(r.rule_name))return false;
    if(q){
      const vals=[r.join_key,r.rule_name,r.source_value,r.target_value,r.source_field,r.target_field];
      const extra=[...EXTRA_REF.map(k=>(r._ref||{})[k]),...EXTRA_TGT.map(k=>(r._tgt||{})[k])];
      if(![...vals,...extra].some(v=>String(v||'').toLowerCase().includes(q)))return false;
    }
    return true;
  });
  if(sC)rows=[...rows].sort((a,b)=>String(a[sC]||'').localeCompare(String(b[sC]||''),'fr',{numeric:true})*sD);
  const tb=document.getElementById('tbody');
  const em=document.getElementById('empty');
  if(!rows.length){tb.innerHTML='';em.style.display='block';return;}
  em.style.display='none';
  tb.innerHTML=rows.map(renderRow).join('');
}
initCounts();render();
"""

# CSS (plain string)
_HTML_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#f4f6f9;color:#2d3748}
.layout{display:flex;flex-direction:column;height:100vh;overflow:hidden}
header{padding:.75rem 1.5rem;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap;flex-shrink:0}
h1{font-size:1.15rem;font-weight:700}.meta{font-size:.72rem;color:#718096}
.cards{display:flex;gap:.6rem;flex-wrap:wrap;padding:.6rem 1.5rem;background:#fff;border-bottom:1px solid #e2e8f0;flex-shrink:0}
.card{background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;padding:.4rem .85rem;text-align:center;min-width:80px}
.card .v{font-size:1.25rem;font-weight:700}.card .l{font-size:.62rem;color:#718096;margin-top:.1rem}
.ca .v{color:#e53e3e}.cb .v{color:#dd6b20}.cd .v{color:#d69e2e}.co .v{color:#276749}
.filter-bar{padding:.45rem 1rem;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;flex-wrap:wrap;gap:.3rem .45rem;align-items:center;flex-shrink:0}
.chip{background:none;border:1px solid #cbd5e0;color:#718096;font-size:.67rem;padding:.18rem .55rem;border-radius:99px;cursor:pointer;font-family:inherit;transition:all .15s}
.chip:hover{color:#2d3748;border-color:#4a5568}
.chip.on.ca{background:#fff5f5;border-color:#fc8181;color:#c53030}
.chip.on.cb{background:#fffaf0;border-color:#fbd38d;color:#c05621}
.chip.on.cd{background:#fffff0;border-color:#f6e05e;color:#b7791f}
.chip.on.co{background:#f0fff4;border-color:#9ae6b4;color:#276749}
.chip.on.cr-coh{background:#f0fff4;border-color:#9ae6b4;color:#276749}
.chip.on.cr-inc{background:#fff5f5;border-color:#fc8181;color:#c53030}
.chip-c{background:rgba(0,0,0,.08);border-radius:99px;padding:0 .35rem;font-size:.58rem}
.fl{font-size:.63rem;color:#718096;margin-right:.1rem}
.filter-sep{width:1px;height:16px;background:#e2e8f0;margin:0 .2rem;flex-shrink:0;align-self:center}
.srch{border:1px solid #e2e8f0;border-radius:4px;padding:.22rem .55rem;font-size:.73rem;color:#2d3748;background:#f7fafc;outline:none;width:200px;margin-left:auto}
.srch:focus{border-color:#3b82f6}
.tbl-wrap{flex:1;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:.77rem;background:#fff}
thead th{background:#fff;padding:.48rem .8rem;text-align:left;font-size:.61rem;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:#718096;border-bottom:1px solid #e2e8f0;position:sticky;top:0;cursor:pointer;user-select:none;white-space:nowrap}
thead th:hover{background:#f7fafc}
.th-extra{white-space:normal;min-width:100px}
.th-meta{font-weight:300;font-size:.57rem;opacity:.65;text-transform:none;letter-spacing:0}
.th-field{font-weight:700;font-size:.65rem}
.th-ref .th-field{color:#1d4ed8}.th-tgt .th-field{color:#6d28d9}
tbody tr{border-bottom:1px solid #f0f4f8}tbody tr:hover{background:#f7fafc}
td{padding:.42rem .8rem;vertical-align:middle}
.tk{font-family:monospace;font-size:.71rem;color:#4a5568;white-space:nowrap}
.tv{font-family:monospace;font-size:.71rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tv.r{color:#1d4ed8}.tv.t{color:#c05621}
.td-rule{font-size:.71rem;color:#7c3aed;font-family:monospace;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-det{font-size:.67rem;color:#718096;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{display:inline-block;padding:.13rem .45rem;border-radius:4px;font-size:.62rem;font-weight:700;font-family:monospace}
.badge-_ko{background:#fee5e5;color:#c53030;border:1px solid #fed7d7}
.badge-ko{background:#fffbea;color:#b7791f;border:1px solid #fefcbf}
.badge-ok{background:#ecfdf5;color:#276749;border:1px solid #c6f6d5}
.badge-_ok{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
.sort-ic{opacity:.22;margin-left:.2rem;font-size:.58rem}
th.sort-asc .sort-ic,th.sort-desc .sort-ic{opacity:1;color:#3b82f6}
.empty{text-align:center;padding:3rem;color:#a0aec0;font-style:italic;display:none}
"""


def _h(s) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def to_html(results: list, summary: dict, config: dict,
            extra_ref: list = None, extra_tgt: list = None,
            ref_rows_map: dict = None, tgt_rows_map: dict = None,
            ref_label: str = "R\u00e9f\u00e9rence", tgt_label: str = "Cible",
            ref_fmt: str = "", tgt_fmt: str = "") -> str:
    """HTML auto-suffisant avec filtres types/règles dynamiques.

    Colonnes supplémentaires figées telles que configurées dans l'UI.
    Données pré-filtrées selon la vue courante, mais filtres JS restent actifs.
    """
    extra_ref    = extra_ref or []
    extra_tgt    = extra_tgt or []
    ref_rows_map = ref_rows_map or {}
    tgt_rows_map = tgt_rows_map or {}

    meta_cfg    = config.get("meta", {})
    name        = meta_cfg.get("name", "Audit")
    description = meta_cfg.get("description", "")
    now       = datetime.now().strftime("%d/%m/%Y \u00e0 %H:%M:%S")
    rules     = config.get("rules", [])
    cfg_keys  = config.get("join", {}).get("keys", [])
    key_fields = [k.get("source_field", "Cl\u00e9") for k in cfg_keys] if cfg_keys else ["Cl\u00e9"]

    # Enrich results with extra column data
    enriched = []
    for r in results:
        row = {k: r.get(k, "") for k in _BASE_FIELDS}
        key = r.get("join_key", "")
        if extra_ref:
            row["_ref"] = {c: ref_rows_map.get(key, {}).get(c, "") for c in extra_ref}
        if extra_tgt:
            row["_tgt"] = {c: tgt_rows_map.get(key, {}).get(c, "") for c in extra_tgt}
        enriched.append(row)

    # Extra TH elements
    ref_meta = _h(f"{ref_label} \u00b7 {ref_fmt}") if ref_fmt else _h(ref_label)
    tgt_meta = _h(f"{tgt_label} \u00b7 {tgt_fmt}") if tgt_fmt else _h(tgt_label)

    extra_ref_ths = "".join(
        f'<th class="th-extra th-ref" onclick="sortBy(\'ref__{_h(c)}\')">'
        f'<div class="th-meta">{ref_meta}</div>'
        f'<div class="th-field">{_h(c)}</div></th>'
        for c in extra_ref
    )
    extra_tgt_ths = "".join(
        f'<th class="th-extra th-tgt" onclick="sortBy(\'tgt__{_h(c)}\')">'
        f'<div class="th-meta">{tgt_meta}</div>'
        f'<div class="th-field">{_h(c)}</div></th>'
        for c in extra_tgt
    )

    # Rule chips
    rule_chips = ""
    if rules:
        rule_chips = '<div class="filter-sep"></div><span class="fl">R\u00e8gles</span>'
        for r_cfg in rules:
            rname = r_cfg.get("name", "")
            rtype = r_cfg.get("rule_type", "incoherence")
            cls   = "cr-coh" if rtype == "coherence" else "cr-inc"
            rule_chips += (
                f'<button class="chip {cls} on" data-k="rule" data-v="{_h(rname)}"'
                f' onclick="toggleChip(this)">{_h(rname)}'
                f' <span class="chip-c">0</span></button>'
            )

    # JSON data (safe for embedding in HTML)
    all_js        = json.dumps(enriched, ensure_ascii=False, default=str)
    extra_ref_js  = json.dumps(extra_ref)
    extra_tgt_js  = json.dumps(extra_tgt)
    key_fields_js = json.dumps(key_fields)

    # Inject data into JS (use unique placeholders to avoid brace conflicts)
    js = (
        _HTML_JS
        .replace("__ALL__", all_js)
        .replace("__EXTRA_REF__", extra_ref_js)
        .replace("__EXTRA_TGT__", extra_tgt_js)
        .replace("__KEY_FIELDS__", key_fields_js)
    )

    s = summary
    parts = [
        '<!DOCTYPE html>\n<html lang="fr"><head><meta charset="UTF-8">\n',
        f'<title>Rapport \u2014 {_h(name)}</title>\n',
        '<style>', _HTML_CSS, '</style></head><body><div class="layout">\n',
        # Header
        '<header>',
        f'<h1>\U0001f4c8 {_h(name)}</h1>',
        *([ f'<p class="meta" style="margin:.2rem 0 0">{_h(description)}</p>' ] if description else []),
        f'<span class="meta">G\u00e9n\u00e9r\u00e9 le {_h(now)}</span>',
        '</header>\n',
        # Summary cards
        '<div class="cards">',
        f'<div class="card"><div class="v">{s.get("total_reference",0)}</div><div class="l">{_h(ref_label)}</div></div>',
        f'<div class="card"><div class="v">{s.get("total_cible",0)}</div><div class="l">{_h(tgt_label)}</div></div>',
        f'<div class="card ca"><div class="v">{s.get("orphelins_a",0)}</div><div class="l">Absent de {_h(tgt_label)}</div></div>',
        f'<div class="card cb"><div class="v">{s.get("orphelins_b",0)}</div><div class="l">Absent de {_h(ref_label)}</div></div>',
        f'<div class="card cd"><div class="v">{s.get("divergents",0)}</div><div class="l">KO</div></div>',
        f'<div class="card co"><div class="v">{s.get("ok",0)}</div><div class="l">OK</div></div>',
        '</div>\n',
        # Filter bar
        '<div class="filter-bar">',
        '<span class="fl">R\u00e8gles pr\u00e9d\u00e9finies</span>',
        f'<button class="chip ca on" data-k="rule" data-v="Source uniq." onclick="toggleChip(this)">Source uniq. <span class="chip-c">0</span></button>',
        f'<button class="chip cb on" data-k="rule" data-v="Cible uniq." onclick="toggleChip(this)">Cible uniq. <span class="chip-c">0</span></button>',
        '<button class="chip co on" data-k="rule" data-v="Pr\u00e9sence OK" onclick="toggleChip(this)">Pr\u00e9sence OK <span class="chip-c">0</span></button>',
        rule_chips,
        '<input class="srch" type="search" placeholder="Recherche\u2026" oninput="render()">',
        '</div>\n',
        # Table
        '<div class="tbl-wrap"><table>\n<thead><tr>',
        "".join(
            f'<th onclick="sortBy(\'join_key\')">{_h(kf)}'
            f'<span class="sort-ic"{" id=\"si-key\"" if i == 0 else ""}>\u2195</span></th>'
            for i, kf in enumerate(key_fields)
        ),
        extra_ref_ths,
        '<th onclick="sortBy(\'rule_name\')">R\u00e8gle<span class="sort-ic" id="si-rule">\u2195</span></th>',
        '<th onclick="sortBy(\'rule_type\')">Type<span class="sort-ic" id="si-type">\u2195</span></th>',
        '<th onclick="sortBy(\'source_field\')">Champ src.<span class="sort-ic" id="si-sf">\u2195</span></th>',
        '<th onclick="sortBy(\'target_field\')">Champ cible<span class="sort-ic" id="si-tf">\u2195</span></th>',
        '<th onclick="sortBy(\'source_value\')">Valeur src.<span class="sort-ic" id="si-sv">\u2195</span></th>',
        '<th onclick="sortBy(\'target_value\')">Valeur cible<span class="sort-ic" id="si-tv">\u2195</span></th>',
        extra_tgt_ths,
        '<th onclick="sortBy(\'detail\')">D\u00e9tail<span class="sort-ic" id="si-det">\u2195</span></th>',
        '</tr></thead>\n',
        '<tbody id="tbody"></tbody>\n',
        '</table><div class="empty" id="empty">Aucun r\u00e9sultat.</div></div>',
        '</div>\n',
        '<script>', js, '</script>',
        '</body></html>',
    ]
    return "".join(parts)
