function handleDrop(event, which) {
  event.preventDefault();
  const dz = event.currentTarget;
  dz.classList.remove('hover');
  const f = event.dataTransfer.files[0];
  if (!f) return;
  const input = document.getElementById('f-' + which);
  // Simuler un changement de fichier
  const dt = new DataTransfer();
  dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
}

// Chargement fichier YAML — File System Access API si dispo, sinon <input> fallback
async function loadYamlFile() {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'YAML', accept: { 'text/yaml': ['.yaml', '.yml'] } }],
        multiple: false
      });
      yamlFileHandle = handle;
      yamlFilename   = handle.name;
      const file     = await handle.getFile();
      const content  = await readFileText(file);
      applyYamlContent(content, handle.name);
    } catch(e) {
      if (e.name !== 'AbortError') console.error(e);
    }
  } else {
    document.getElementById('f-yaml').click();
  }
}

function applyYamlContent(content, filename) {
  document.getElementById('yaml').value = content;
  yamlOriginal = content;
  _updateConfigName();
  updateSaveBtn();
  try {
    const parsed = jsyaml.load(content);
    wizLoadFromYaml(parsed);
    // Mettre à jour le résumé dans wfv-0
    const sum = document.getElementById('yaml-loaded-summary');
    const dz  = document.getElementById('dz-yaml');
    if (sum && dz) {
      const name = parsed?.meta?.name || filename || 'Config chargée';
      const ver  = parsed?.meta?.version ? ` v${parsed.meta.version}` : '';
      const rules = (parsed?.rules||[]).length;
      const keys  = ((parsed?.join||{}).keys||[]).length;
      sum.innerHTML = `✓ <strong>${esc(name)}${esc(ver)}</strong> — ${keys} clé(s) de jointure, ${rules} règle(s)`;
      sum.style.display = '';
      dz.classList.add('loaded');
      document.getElementById('dz-yaml-label').textContent = filename || yamlFilename;
      document.getElementById('dz-yaml-sub').textContent   = 'YAML chargé — cliquez pour changer';
    }
    // Re-render step en cours si applicable
    if (wfCurrentStep === 1) onEnterRef();
    else if (wfCurrentStep === 2) onEnterTgt();
    else if (wfCurrentStep === 3) wizRenderJoin();
    else if (wfCurrentStep === 4) wizRenderRules();
    else if (wfCurrentStep === 5) wizRenderFilters();
    sessionSave();
  } catch(_) {}
}

async function handleDropYaml(event) {
  event.preventDefault();
  const dz = event.currentTarget;
  dz.classList.remove('hover');
  const f = event.dataTransfer.files[0];
  if (!f) return;
  yamlFileHandle = null;
  yamlFilename   = f.name;
  const content  = await readFileText(f);
  applyYamlContent(content, f.name);
}

// Listener enregistré lazily dans toggleYamlEditor (textarea hors du script block)

function updateSaveBtn() {
  const btn   = document.getElementById('btn-save-yaml');
  if (!btn) return;
  const dirty = document.getElementById('yaml').value !== yamlOriginal;
  btn.style.display     = yamlOriginal ? '' : 'none';
  btn.style.borderColor = dirty ? 'var(--acc)' : '';
  btn.style.color       = dirty ? 'var(--acc)' : '';
  btn.title = yamlFileHandle
    ? (dirty ? `Sauvegarder dans ${yamlFilename}` : `${yamlFilename} — à jour`)
    : `Télécharger ${yamlFilename}`;
  _updateConfigName();
}

function _updateConfigName() {
  const el = document.getElementById('yaml-config-name');
  if (!el) return;
  el.textContent = (yamlFilename && yamlFilename !== 'config.yaml') ? yamlFilename : '';
}

async function saveYaml() {
  const content = document.getElementById('yaml').value;
  if (!content.trim()) return;

  if (yamlFileHandle) {
    try {
      const writable = await yamlFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      yamlOriginal = content;
      updateSaveBtn();
      return;
    } catch(e) {
      // Permission refusée ou API indisponible → fallback download
      console.warn('File System Access write failed, falling back to download:', e);
    }
  }

  // Fallback : téléchargement
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = yamlFilename;
  a.click();
  URL.revokeObjectURL(url);
  yamlOriginal = content;
  updateSaveBtn();
}

// Save depuis la barre globale — build depuis wizard, écrase le handle existant ou télécharge
async function saveConfig() {
  _saveCurrentWFStep();
  const content = wizBuildYaml();
  document.getElementById('yaml').value = content;
  yamlOriginal = content;
  if (yamlFileHandle) {
    try {
      const writable = await yamlFileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      _updateConfigName();
      updateSaveBtn();
      return;
    } catch(e) { console.warn('Write failed, fallback download:', e); }
  }
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = yamlFilename; a.click();
  URL.revokeObjectURL(url);
  updateSaveBtn();
}

// Save As — build depuis wizard, demande un nouvel emplacement
async function saveAsConfig() {
  _saveCurrentWFStep();
  const content = wizBuildYaml();
  document.getElementById('yaml').value = content;
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: yamlFilename,
        types: [{ description: 'YAML', accept: { 'text/yaml': ['.yaml', '.yml'] } }]
      });
      yamlFileHandle = handle;
      yamlFilename   = handle.name;
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      yamlOriginal = content;
      _updateConfigName();
      updateSaveBtn();
      return;
    } catch(e) {
      if (e.name === 'AbortError') return;
      console.warn('showSaveFilePicker failed, fallback download:', e);
    }
  }
  // Fallback : téléchargement
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = yamlFilename; a.click();
  URL.revokeObjectURL(url);
  yamlOriginal = content;
  updateSaveBtn();
}

async function autoDetectColumns(srcKey, file) {
  const src = WS.sources[srcKey];
  if (!['csv','txt','dat'].includes(src.format)) return;
  if (!src.has_header) return;
  if (src.fixed_width) return;
  try {
    const buf  = await file.slice(0, 32768).arrayBuffer();
    const enc  = src.encoding || 'utf-8';
    // utf-8-sig : décodé comme utf-8 (TextDecoder gère le BOM automatiquement)
    const decoderEnc = enc === 'utf-8-sig' ? 'utf-8' : enc;
    let slice;
    try { slice = new TextDecoder(decoderEnc, { fatal: false }).decode(buf); }
    catch(_) { slice = new TextDecoder('utf-8', { fatal: false }).decode(buf); }
    // Supprimer le BOM éventuel
    if (slice.charCodeAt(0) === 0xFEFF) slice = slice.slice(1);
    const lines = slice.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const skip  = parseInt(src.skip_rows) || 0;
    const header = lines[skip];
    if (!header || !header.trim()) return;
    const delim = src.delimiter || ';';
    const names = header.split(delim).map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    if (!names.length) return;
    src.fields = names.map(n => ({ name: n, type: 'string', date_format: '' }));
  } catch(_) {}
}

// ═══════════════════════════════════════════════════════════
//  PROGRESSION
// ═══════════════════════════════════════════════════════════
function showProgress(show) {
  document.getElementById('progress-wrap').classList.toggle('show', show);
}

function updateProgress(ev) {
  const bar    = document.getElementById('prog-bar');
  const pct    = ev.pct || 0;
  const done   = ev.done || 0;
  const total  = ev.total || 0;

  document.getElementById('prog-label').textContent = ev.step || 'Traitement en cours…';
  document.getElementById('prog-step').textContent  = '';

  if (total > 0) {
    bar.classList.remove('indeterminate');
    bar.style.width = pct + '%';
    document.getElementById('prog-pct').textContent    = pct.toFixed(1) + '%';
    document.getElementById('prog-counts').textContent = `${done.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} lignes`;
  } else {
    bar.classList.add('indeterminate');
    bar.style.width = '40%';
    document.getElementById('prog-pct').textContent    = '…';
    document.getElementById('prog-counts').textContent = '';
  }
}

// ═══════════════════════════════════════════════════════════
//  PRÉVISUALISATION FICHIER
// ═══════════════════════════════════════════════════════════
let previewData = { ref: null, tgt: null };

async function previewFile(which, evt, openTab) {
  evt && evt.stopPropagation();
  const file = which === 'ref' ? fileRef : fileTgt;
  if (!file || isBinary(file)) return;

  const srcKey = which === 'ref' ? 'reference' : 'target';
  const label  = which === 'ref' ? (refLabel || 'Référence') : (tgtLabel || 'Cible');
  document.getElementById('preview-title').textContent =
    `Prévisualisation — ${label} : ${file.name}`;

  // Lire les premières lignes (max 50KB)
  const slice = file.slice(0, 51200);
  const text  = await slice.text();
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l => l.trim());

  // Stocker
  previewData[which] = lines;

  const src   = WS.sources[srcKey];
  const delim = src.delimiter || ';';

  renderPreviewTable(lines, delim);
  renderPreviewRaw(lines);
  renderValidationCols(which, lines);
  switchPreviewTab(openTab || 'table');
  document.getElementById('preview-modal').classList.add('show');
}

async function validateColumns(which, evt) {
  evt && evt.stopPropagation();
  // Save current form state before reading WS
  _saveCurrentWFStep();
  await previewFile(which, null, 'cols');
}

function renderValidationCols(which, lines) {
  const wrap   = document.getElementById('preview-cols-wrap');
  const srcKey = which === 'ref' ? 'reference' : 'target';
  const src    = WS.sources[srcKey];

  // JSON/XLSX : colonnes auto-détectées
  if (['json','xlsx'].includes(src.format)) {
    wrap.innerHTML = '<div class="preview-na">Format ' + src.format + ' : colonnes détectées automatiquement au parsing, pas de validation possible ici.</div>';
    _updateValBadge(which, null);
    return;
  }

  // Fixed-width : vérification longueur de ligne
  if (src.fixed_width) {
    const skip = parseInt(src.skip_rows) || 0;
    const dataLine = lines[skip] || '';
    const lineLen  = dataLine.length;
    const cols = src.column_positions;
    if (!cols.length) {
      wrap.innerHTML = '<div class="preview-na">Aucune colonne déclarée en fixed_width.</div>';
      _updateValBadge(which, { ok:0, warn:0, missing: 0, note: 'Aucune colonne' });
      return;
    }
    let html = `<div class="val-summary">Longueur de ligne détectée : <strong>${lineLen}</strong> caractère(s)</div>`;
    html += '<table class="val-table"><thead><tr><th>Statut</th><th>Nom</th><th>Position</th><th>Largeur</th><th>Fin (pos+larg-1)</th></tr></thead><tbody>';
    let nOk = 0, nWarn = 0;
    cols.forEach(c => {
      const end = Number(c.position) + Number(c.width) - 1;
      const ok  = end < lineLen;
      if (ok) nOk++; else nWarn++;
      html += `<tr class="${ok ? 'ok' : 'missing'}">
        <td class="status">${ok ? '✓' : '✗'}</td>
        <td>${esc(c.name)}</td>
        <td>${c.position}</td>
        <td>${c.width}</td>
        <td style="color:${ok ? 'var(--ok)' : 'var(--oa)'}">${end}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    _updateValBadge(which, { ok: nOk, warn: nWarn, missing: 0 });
    return;
  }

  // Délimité CSV/TXT/DAT
  const skip   = parseInt(src.skip_rows) || 0;
  const hdrLine = lines[skip] || '';
  const delim  = src.delimiter || ';';
  const fileNames = hdrLine.split(delim).map(s => s.trim().replace(/^"|"$/g, ''));

  const declared = (src.fields || []).map(f => f.name);
  const fileSet  = new Set(fileNames);
  const declSet  = new Set(declared);

  // Build rows: matched, extra (file only), missing (declared only)
  const rows = [];
  fileNames.forEach((fn, i) => {
    const decl = declared[i]; // same position
    const byPos = decl !== undefined;
    const byName = declSet.has(fn);
    if (byPos && decl === fn) {
      rows.push({ status:'ok',   file: fn, declared: decl, type: (src.fields[i]||{}).type||'' });
    } else if (byPos && decl !== fn) {
      rows.push({ status:'warn', file: fn, declared: decl || '—', type: (src.fields[i]||{}).type||'' });
    } else {
      rows.push({ status:'warn', file: fn, declared: '—', type: '' });
    }
  });
  // Declared columns beyond what the file has
  declared.slice(fileNames.length).forEach((d, i) => {
    rows.push({ status:'missing', file: '—', declared: d, type: (src.fields[fileNames.length + i]||{}).type||'' });
  });

  const nOk      = rows.filter(r => r.status === 'ok').length;
  const nWarn    = rows.filter(r => r.status === 'warn').length;
  const nMissing = rows.filter(r => r.status === 'missing').length;

  const statusIcon = { ok:'✓', warn:'⚠', missing:'✗' };
  const statusLabel = { ok:'Correspond', warn:'Écart', missing:'Absent du fichier' };

  let html = `<div class="val-summary">
    <span>${fileNames.length} colonne(s) dans le fichier</span>
    <span>${declared.length} colonne(s) déclarée(s)</span>
    ${nOk      ? `<span style="color:var(--ok)">✓ ${nOk} correspondent</span>` : ''}
    ${nWarn    ? `<span style="color:#92400e">⚠ ${nWarn} écart(s)</span>` : ''}
    ${nMissing ? `<span style="color:var(--oa)">✗ ${nMissing} absente(s)</span>` : ''}
  </div>`;
  html += '<table class="val-table"><thead><tr><th>Statut</th><th>#</th><th>Colonne fichier</th><th>Colonne déclarée</th><th>Type déclaré</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    html += `<tr class="${r.status}">
      <td class="status" title="${statusLabel[r.status]}">${statusIcon[r.status]}</td>
      <td style="color:var(--muted)">${i+1}</td>
      <td>${esc(r.file)}</td>
      <td>${esc(r.declared)}</td>
      <td style="color:var(--muted)">${esc(r.type)}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  _updateValBadge(which, { ok: nOk, warn: nWarn, missing: nMissing });
}

function _updateValBadge(which, stats) {
  const badgeEl = document.getElementById('val-badge-' + which);
  if (!badgeEl) return;
  if (!stats) { badgeEl.style.display = 'none'; return; }
  const { ok, warn, missing } = stats;
  const total = ok + warn + missing;
  let cls = 'ok', txt = `✓ ${ok}/${total} colonnes OK`;
  if (missing > 0) { cls = 'err'; txt = `✗ ${missing} absente(s), ${warn} écart(s)`; }
  else if (warn > 0) { cls = 'warn'; txt = `⚠ ${warn} écart(s) sur ${total}`; }
  badgeEl.className = `val-badge ${cls}`;
  badgeEl.textContent = txt;
  badgeEl.style.display = '';
}

function renderPreviewTable(lines, delim) {
  const wrap = document.getElementById('preview-table-wrap');
  const MAX_ROWS = 20, MAX_COLS = 30;

  if (!lines.length) { wrap.innerHTML = '<div class="preview-na">Fichier vide.</div>'; return; }

  // Splitter simplement (sans gestion des quotes pour la préview)
  const split = line => line.split(delim).slice(0, MAX_COLS);

  const headers = split(lines[0]);
  const rows    = lines.slice(1, MAX_ROWS + 1);
  const truncC  = lines[0].split(delim).length > MAX_COLS;
  const truncR  = lines.length - 1 > MAX_ROWS;

  let html = '<table class="preview-table"><thead><tr>';
  html += '<th style="color:var(--muted);font-weight:400">#</th>';
  headers.forEach((h, i) => {
    html += `<th title="${esc(h)}">${esc(h.trim())}</th>`;
  });
  if (truncC) html += '<th style="color:var(--muted)">…</th>';
  html += '</tr></thead><tbody>';

  rows.forEach((line, ri) => {
    const cells = split(line);
    html += `<tr><td style="color:var(--muted);font-size:.6rem">${ri + 1}</td>`;
    headers.forEach((_, ci) => {
      const val = cells[ci] !== undefined ? cells[ci] : '';
      html += `<td title="${esc(val)}">${esc(val.trim())}</td>`;
    });
    if (truncC) html += '<td>…</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  if (truncR) {
    html += `<div class="preview-na" style="padding:.5rem 1rem">… ${(lines.length - 1).toLocaleString('fr-FR')} lignes au total (aperçu limité à ${MAX_ROWS})</div>`;
  }
  wrap.innerHTML = html;
}

function renderPreviewRaw(lines) {
  const wrap = document.getElementById('preview-raw-wrap');
  const preview = lines.slice(0, 30).join('\n');
  wrap.innerHTML = `<div class="preview-raw">${esc(preview)}</div>`;
}

function switchPreviewTab(tab) {
  document.getElementById('preview-table-wrap').style.display = tab === 'table' ? '' : 'none';
  document.getElementById('preview-raw-wrap').style.display   = tab === 'raw'   ? '' : 'none';
  document.getElementById('preview-cols-wrap').style.display  = tab === 'cols'  ? '' : 'none';
  document.getElementById('tab-table').classList.toggle('active', tab === 'table');
  document.getElementById('tab-raw').classList.toggle('active',   tab === 'raw');
  document.getElementById('tab-cols').classList.toggle('active',  tab === 'cols');
}

function closePreview(e) {
  if (!e || e.target === document.getElementById('preview-modal')) {
    document.getElementById('preview-modal').classList.remove('show');
  }
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('help-modal').style.display !== 'none') { closeHelp(); return; }
  if (document.getElementById('yaml-modal').style.display !== 'none') { closeYamlModal(); return; }
  closePreview();
});

function loadExample() {
  document.getElementById('yaml').value =
`meta:
  name: "Exemple — Audit commandes"

sources:
  reference:
    label: "Export ERP"
    format: csv
    encoding: utf-8
    delimiter: ";"
    has_header: true
    fields:
      - { name: order_id,      type: string  }
      - { name: customer_code, type: string  }
      - { name: order_date,    type: date,    date_format: "%d/%m/%Y" }
      - { name: amount,        type: decimal }

  target:
    label: "Export WMS"
    format: csv
    encoding: utf-8
    delimiter: ","
    has_header: true
    fields:
      - { name: order_id,      type: string  }
      - { name: customer_code, type: string  }
      - { name: order_date,    type: date,    date_format: "%Y-%m-%d" }
      - { name: amount,        type: decimal }

join:
  keys:
    - { source_field: order_id, target_field: order_id }

rules:
  - name: "Montant cohérent"
    logic: AND
    fields:
      - { source_field: amount, target_field: amount, tolerance: 0.01 }

  - name: "Client identique"
    logic: AND
    fields:
      - { source_field: customer_code, target_field: customer_code, normalize: both }

report:
  show_matching: false
  max_diff_preview: 500
`;
}

// ═══════════════════════════════════════════════════════════
//  REVUE CÔTE À CÔTE
// ═══════════════════════════════════════════════════════════
function openCtxModal(key) {
  _ctxKey = key;
  document.getElementById('ctx-center-key').textContent = key;
  document.getElementById('ctx-modal').style.display = 'flex';
  _loadCtx();
}

function closeCtxModal(e) {
  if (e && e.target !== document.getElementById('ctx-modal')) return;
  document.getElementById('ctx-modal').style.display = 'none';
}

function _ctxN() { return Number(document.getElementById('ctx-n').value) || 2; }

async function _loadCtx() {
  if (!_ctxKey) return;
  const token = currentToken || '';
  const url = `/api/context?token=${encodeURIComponent(token)}&key=${encodeURIComponent(_ctxKey)}&n=${_ctxN()}`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    if (data.error) { console.warn('ctx:', data.error); return; }
    _renderCtxPanels(data);
  } catch(e) { console.error('ctx fetch error', e); }
}

function _renderCtxPanels(data) {
  const diffSet = new Set(data.diff_fields || []);

  function renderPanel(rows, panelId) {
    const el = document.getElementById(panelId);
    el.innerHTML = rows.map(row => {
      const center = row.is_center;
      const keyHtml = `<div class="ctx-record-key">${esc(row.key)}</div>`;
      if (!row.data) {
        return `<div class="ctx-record${center?' is-center':''}">${keyHtml}<div class="ctx-absent">Absent</div></div>`;
      }
      const fields = Object.entries(row.data).map(([k, v]) => {
        const diff = center && diffSet.has(k);
        return `<tr class="${diff?'ctx-diff':''}"><td>${esc(k)}</td><td>${esc(String(v??''))}</td></tr>`;
      }).join('');
      return `<div class="ctx-record${center?' is-center':''}">${keyHtml}<table>${fields}</table></div>`;
    }).join('');
  }

  renderPanel(data.ref_rows, 'ctx-ref-rows');
  renderPanel(data.tgt_rows, 'ctx-tgt-rows');

  // Défilement synchrone
  const refEl = document.getElementById('ctx-ref-rows');
  const tgtEl = document.getElementById('ctx-tgt-rows');
  let _sync = false;
  refEl.onscroll = () => { if (_sync) return; _sync=true; tgtEl.scrollTop=refEl.scrollTop; _sync=false; };
  tgtEl.onscroll = () => { if (_sync) return; _sync=true; refEl.scrollTop=tgtEl.scrollTop; _sync=false; };

  // Centrer sur l'enregistrement central
  setTimeout(() => {
    const center = refEl.querySelector('.ctx-record.is-center');
    if (center) center.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 50);
}
