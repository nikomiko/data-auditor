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
    _updateFileHint('reference');
    _updateFileHint('target');
    if (fileRef) _quickConformityCheck('reference', fileRef);
    if (fileTgt) _quickConformityCheck('target', fileTgt);
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
    if (wfCurrentStep === 1) onEnterDatasets();
    else if (wfCurrentStep === 2) wizRenderJoin();
    else if (wfCurrentStep === 3) wizRenderRules();
    else if (wfCurrentStep === 4) wizRenderFilters();
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

function _dotGet(obj, path) {
  for (const key of path.replace(/^\./,'').split('.')) {
    if (!key || typeof obj !== 'object' || obj === null) return undefined;
    obj = obj[key];
  }
  return obj;
}

async function _autoDetectJson(srcKey, file) {
  try {
    const text = await readFileText(file.slice(0, 512000));
    const src  = WS.sources[srcKey];
    let records;
    if (src.format === 'jsonl') {
      records = text.split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
    } else {
      const obj = JSON.parse(text);
      const jp  = src.json_path || '';
      if (jp)                  records = _dotGet(obj, jp);
      else if (Array.isArray(obj)) records = obj;
      else {
        for (const k of ['records','data','items','rows'])
          if (Array.isArray(obj[k])) { records = obj[k]; break; }
      }
    }
    if (!Array.isArray(records) || !records.length) return;
    const first = records[0];
    if (typeof first !== 'object' || !first) return;
    const fields = [];
    for (const [k, v] of Object.entries(first)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const sk of Object.keys(v))
          fields.push({ name: sk, type:'string', date_format:'', ignored:false, path:`${k}.${sk}` });
      } else {
        fields.push({ name: k, type:'string', date_format:'', ignored:false, path:'' });
      }
    }
    WS.sources[srcKey].fields = fields;
  } catch(_) {}
}

async function autoDetectColumns(srcKey, file) {
  const src = WS.sources[srcKey];
  if (src.format === 'json' || src.format === 'jsonl') return _autoDetectJson(srcKey, file);
  if (!['csv','txt','dat','positionnel'].includes(src.format)) return;
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
    src.fields = names.map(n => ({ name: n, type: 'string', date_format: '', ignored: false }));
  } catch(_) {}
}

function _basename(path) {
  return (path || '').replace(/\\/g, '/').split('/').pop();
}

function _updateFileHint(srcKey) {
  const which = srcKey === 'reference' ? 'ref' : 'tgt';
  const fileLoaded = srcKey === 'reference' ? !!fileRef : !!fileTgt;
  const path = WS.sources[srcKey].file || '';
  const dz = document.getElementById('dz-' + which);
  if (!dz) return;
  if (fileLoaded || !path) {
    dz.classList.remove('hinted');
    return;
  }
  const name = _basename(path);
  document.getElementById('dz-' + which + '-label').textContent = name || path;
  document.getElementById('dz-' + which + '-sub').textContent   =
    path !== name ? path : 'Cliquez pour charger ce fichier';
  dz.classList.add('hinted');
}

function _hasSourceConfig(srcKey) {
  const s = WS.sources[srcKey];
  return (s.fields && s.fields.length > 0) ||
         (s.column_positions && s.column_positions.length > 0);
}

async function _onFileLoaded(srcKey, file) {
  if (_hasSourceConfig(srcKey)) {
    await _quickConformityCheck(srcKey, file);
  }
  if (wfCurrentStep === 1) dsActivate(srcKey);
}

async function _quickConformityCheck(srcKey, file) {
  const which = srcKey === 'reference' ? 'ref' : 'tgt';
  const src = WS.sources[srcKey];
  if (!['csv','txt','dat'].includes(src.format) || src.fixed_width || !src.has_header) {
    _updateValBadge(which, null); return;
  }
  try {
    const buf = await file.slice(0, 32768).arrayBuffer();
    const enc = src.encoding === 'utf-8-sig' ? 'utf-8' : (src.encoding || 'utf-8');
    let text;
    try { text = new TextDecoder(enc, {fatal:false}).decode(buf); }
    catch(_) { text = new TextDecoder('utf-8', {fatal:false}).decode(buf); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const skip = parseInt(src.skip_rows) || 0;
    const header = lines[skip] || '';
    const delim = src.delimiter || ';';
    const fileNames = header.split(delim).map(s => s.trim().replace(/^"|"$/g,''));
    const declared = (src.fields || []).map(f => f.name);
    let ok = 0, warn = 0;
    fileNames.forEach((fn, i) => { declared[i] === fn ? ok++ : warn++; });
    const missing = Math.max(0, declared.length - fileNames.length);
    _updateValBadge(which, {ok, warn, missing});
  } catch(_) { _updateValBadge(which, null); }
}

async function detectAndApply(srcKey) {
  const file = srcKey === 'reference' ? fileRef : fileTgt;
  if (!file) return;
  const src = WS.sources[srcKey];

  // JSON / JSONL : déléguer à _autoDetectJson puis re-rendre
  if (src.format === 'json' || src.format === 'jsonl') {
    await _autoDetectJson(srcKey, file);
    if (wfCurrentStep === 1) dsActivate(srcKey);
    return;
  }

  try {
    const buf = await file.slice(0, 65536).arrayBuffer();
    let text;
    try { text = new TextDecoder('utf-8', {fatal:true}).decode(buf); }
    catch(_) { text = new TextDecoder('windows-1252').decode(buf); }
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const allLines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const lines = allLines.filter(l => l.trim());

    const DELIMS = [';', ',', '\t', '|'];
    let bestDelim = ';', bestScore = -1;
    for (const d of DELIMS) {
      const cnts = lines.slice(0, 10).map(l => l.split(d).length);
      const maxCnt = Math.max(...cnts);
      const score = cnts.filter(c => c === maxCnt).length * maxCnt;
      if (score > bestScore) { bestScore = score; bestDelim = d; }
    }
    src.delimiter = bestDelim;

    const cnts = lines.map(l => l.split(bestDelim).length);
    const maxCnt = Math.max(...cnts.slice(0, 15));
    let skip = 0;
    while (skip < lines.length && cnts[skip] < maxCnt) skip++;
    src.skip_rows = skip;
    src.has_header = true;
    src.fixed_width = false;

    const hdrLine = lines[skip] || '';
    const names = hdrLine.split(bestDelim)
      .map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    if (names.length) {
      src.fields = names.map(n => ({name: n, type: 'string', date_format: '', ignored: false}));
    }

    if (wfCurrentStep === 1) dsActivate(srcKey);
  } catch(e) { console.error('detectAndApply failed', e); }
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

  // S'assurer que l'état wizard est à jour avant de lire WS.sources
  _saveCurrentWFStep();

  const srcKey = which === 'ref' ? 'reference' : 'target';
  const label  = which === 'ref' ? (refLabel || 'Référence') : (tgtLabel || 'Cible');
  document.getElementById('preview-title').textContent =
    `Prévisualisation — ${label} : ${file.name}`;

  // Lire les premières lignes (max 50KB)
  const slice = file.slice(0, 512000);
  const text  = await slice.text();
  const lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l => l.trim());

  // Stocker
  previewData[which] = lines;

  const src   = WS.sources[srcKey];
  const delim = src.delimiter || ';';

  if (['json','jsonl'].includes(src.format)) {
    renderPreviewJson(which, text);
  } else {
    renderPreviewTable(lines, delim);
  }
  renderPreviewRaw(lines);
  renderValidationCols(which, lines);

  // Onglet Dépivoté : visible uniquement si unpivot activé avec au moins un pivot configuré
  const tabUnpivot = document.getElementById('tab-unpivot');
  const hasUnpivot = src.unpivot_enabled && (src.unpivot.pivot_fields || []).filter(p => p.source).length > 0;
  tabUnpivot.style.display = hasUnpivot ? '' : 'none';
  if (hasUnpivot) renderPreviewUnpivot(lines, srcKey, delim);

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

  // JSON / JSONL / XLSX : afficher les colonnes déclarées dans la configuration
  if (['json','jsonl','xlsx'].includes(src.format)) {
    const declared = (src.fields || []).filter(f => f.name);
    if (!declared.length) {
      wrap.innerHTML = '<div class="preview-na">Aucune colonne déclarée. Utilisez "Détecter la structure" pour inférer les colonnes depuis le fichier.</div>';
      _updateValBadge(which, null);
      return;
    }
    let html = `<div class="val-summary"><span>${declared.length} colonne(s) déclarée(s)</span></div>`;
    html += '<table class="val-table"><thead><tr><th>#</th><th>Nom</th><th>Type</th><th>Chemin (path)</th><th>Ignoré</th></tr></thead><tbody>';
    declared.forEach((f, i) => {
      html += `<tr class="ok">
        <td style="color:var(--muted)">${i+1}</td>
        <td>${esc(f.name)}</td>
        <td style="color:var(--muted)">${esc(f.type||'string')}</td>
        <td style="color:var(--muted);font-family:var(--mono);font-size:.72rem">${esc(f.path||'')}</td>
        <td style="text-align:center">${f.ignored ? '✗' : ''}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    _updateValBadge(which, { ok: declared.length, warn: 0, missing: 0 });
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

function renderPreviewJson(which, text) {
  const wrap   = document.getElementById('preview-table-wrap');
  const srcKey = which === 'ref' ? 'reference' : 'target';
  const src    = WS.sources[srcKey];
  const MAX_ROWS = 200;
  try {
    let records;
    if (src.format === 'jsonl') {
      records = text.split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch(_) { return null; } }).filter(Boolean);
    } else {
      const obj = JSON.parse(text);
      const jp  = src.json_path || '';
      if (jp)                      records = _dotGet(obj, jp);
      else if (Array.isArray(obj)) records = obj;
      else {
        for (const k of ['records','data','items','rows'])
          if (Array.isArray(obj[k])) { records = obj[k]; break; }
        if (!records) records = [obj];
      }
    }
    if (!Array.isArray(records) || !records.length) {
      wrap.innerHTML = '<div class="preview-na">Aucun enregistrement trouvé.</div>';
      return;
    }

    // Colonnes : champs configurés si disponibles, sinon clés du 1er enregistrement
    const fields = (src.fields && src.fields.length)
      ? src.fields.filter(f => f.type !== 'skip' && !f.ignored)
      : Object.keys(records[0]).map(k => ({ name: k, path: '' }));

    const display = records.slice(0, MAX_ROWS);
    const truncR  = records.length > MAX_ROWS;

    let html = '<table class="preview-table"><thead><tr>';
    html += '<th style="color:var(--muted);font-weight:400">#</th>';
    fields.forEach(f => {
      const tip = f.path ? `${f.name} (path: ${f.path})` : f.name;
      html += `<th title="${esc(tip)}">${esc(f.name)}</th>`;
    });
    html += '</tr></thead><tbody>';

    display.forEach((rec, ri) => {
      html += `<tr><td style="color:var(--muted);font-size:.6rem">${ri + 1}</td>`;
      fields.forEach(f => {
        const fpath = f.path || f.name;
        const val   = fpath.includes('.') ? _dotGet(rec, fpath) : rec[fpath];
        const s     = (val === null || val === undefined) ? ''
                    : (typeof val === 'object' ? JSON.stringify(val) : String(val));
        html += `<td title="${esc(s)}">${esc(s)}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    if (truncR) {
      html += `<div class="preview-na" style="padding:.5rem 1rem">… ${records.length.toLocaleString('fr-FR')} enregistrements au total (aperçu limité à ${MAX_ROWS})</div>`;
    }
    wrap.innerHTML = html;
  } catch(e) {
    wrap.innerHTML = `<div class="preview-na">Erreur de parsing JSON : ${esc(String(e))}</div>`;
  }
}

function renderPreviewTable(lines, delim) {
  const wrap = document.getElementById('preview-table-wrap');
  const MAX_ROWS = 200, MAX_COLS = 30;

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
  document.getElementById('preview-table-wrap').style.display   = tab === 'table'   ? '' : 'none';
  document.getElementById('preview-raw-wrap').style.display     = tab === 'raw'     ? '' : 'none';
  document.getElementById('preview-cols-wrap').style.display    = tab === 'cols'    ? '' : 'none';
  document.getElementById('preview-unpivot-wrap').style.display = tab === 'unpivot' ? '' : 'none';
  document.getElementById('tab-table').classList.toggle('active',   tab === 'table');
  document.getElementById('tab-raw').classList.toggle('active',     tab === 'raw');
  document.getElementById('tab-cols').classList.toggle('active',    tab === 'cols');
  document.getElementById('tab-unpivot').classList.toggle('active', tab === 'unpivot');
}

function renderPreviewUnpivot(lines, srcKey, delim) {
  const wrap = document.getElementById('preview-unpivot-wrap');
  const s = WS.sources[srcKey];
  const u = s.unpivot;

  const locField   = u.location_field || 'location_key';
  const valField   = u.value_field    || 'pivot_value';
  const pivots     = (u.pivot_fields  || []).filter(p => p.source);
  const pivotSet   = new Set(pivots.map(p => p.source));
  const fieldList  = s.fixed_width ? s.column_positions : s.fields;
  const anchors    = fieldList.filter(f => f.name && !f.ignored && !pivotSet.has(f.name)).map(f => f.name);

  if (!s.has_header) {
    wrap.innerHTML = '<div class="preview-na">Aperçu non disponible sans en-tête (has_header: false).</div>';
    return;
  }

  const skip = parseInt(s.skip_rows) || 0;
  const headerLine = lines[skip] || '';
  if (!headerLine.trim()) {
    wrap.innerHTML = '<div class="preview-na">En-tête introuvable dans le fichier.</div>';
    return;
  }

  const headers   = headerLine.split(delim).map(h => h.trim().replace(/^"|"$/g, ''));
  const headerSet = new Set(headers);

  const missingAnchors = anchors.filter(a => !headerSet.has(a));
  const missingPivots  = pivots.filter(p => !headerSet.has(p.source)).map(p => p.source);
  if (missingAnchors.length || missingPivots.length) {
    const msgs = [];
    if (missingAnchors.length) msgs.push('Champs identité introuvables : ' + missingAnchors.join(', '));
    if (missingPivots.length)  msgs.push('pivot_fields introuvables : '    + missingPivots.join(', '));
    wrap.innerHTML = '<div class="preview-na">' + msgs.map(esc).join('<br>') + '</div>';
    return;
  }

  // Générer les lignes dépivotées (max 10 lignes source)
  const MAX_SRC = 10;
  const resultRows = [];
  for (let i = skip + 1; i < lines.length && resultRows.length < MAX_SRC * pivots.length; i++) {
    const cells  = lines[i].split(delim);
    const rowData = {};
    headers.forEach((h, ci) => { rowData[h] = (cells[ci] || '').trim().replace(/^"|"$/g, ''); });
    for (const pf of pivots) {
      const newRow = {};
      for (const a of anchors) newRow[a] = rowData[a] ?? '';
      newRow[locField] = pf.location || pf.source;
      newRow[valField] = rowData[pf.source] ?? '';
      resultRows.push(newRow);
    }
  }

  const cols        = [...anchors, locField, valField];
  const srcRowCount = Math.floor(resultRows.length / pivots.length);
  const totalSrc    = lines.length - skip - 1;

  let html = `<div class="val-summary">${srcRowCount} lignes source × ${pivots.length} pivot(s) → ${resultRows.length} lignes générées (aperçu)</div>`;
  html += '<table class="preview-table"><thead><tr>';
  cols.forEach(c => {
    const style = c === locField ? 'color:var(--acc)' : c === valField ? 'color:var(--ok)' : '';
    html += `<th style="${style}">${esc(c)}</th>`;
  });
  html += '</tr></thead><tbody>';
  resultRows.forEach((row, ri) => {
    const sep = ri > 0 && ri % pivots.length === 0 ? 'border-top:2px solid var(--border)' : '';
    html += `<tr style="${sep}">`;
    cols.forEach(c => { html += `<td>${esc(String(row[c] ?? ''))}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  if (totalSrc > MAX_SRC) {
    html += `<div class="preview-na" style="padding:.5rem 1rem">Aperçu limité à ${MAX_SRC} lignes source sur ${totalSrc.toLocaleString('fr-FR')}</div>`;
  }
  wrap.innerHTML = html;
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
let _ctxEcarts      = [];   // écarts du row courant (passés depuis _appendPageRow)
let _ctxActiveRules = new Set(); // règles sélectionnées dans les pills (local à la modale)
let _ctxLastData    = null;      // cache de la dernière réponse _loadCtx pour re-render

function openCtxModal(key, ecarts) {
  _ctxKey         = key;
  _ctxEcarts      = ecarts || [];
  _ctxLastData    = null;
  document.getElementById('ctx-center-key').textContent = key;

  // Initialiser _ctxActiveRules avec toutes les règles présentes (toutes sélectionnées par défaut)
  _ctxActiveRules = new Set();
  _ctxEcarts.forEach(e => { if (e.rule_name) _ctxActiveRules.add(e.rule_name); });

  _ctxRenderPills();

  document.getElementById('ctx-modal').style.display = 'flex';
  _loadCtx();
}

function _ctxRenderPills() {
  const badgesEl = document.getElementById('ctx-rules-badges');
  if (!badgesEl) return;
  const TYPE_LABELS = { ORPHELIN_A: 'Orphelin source', ORPHELIN_B: 'Orphelin cible' };
  const seen = new Set();
  let html = '';
  _ctxEcarts.forEach(e => {
    const t = e.type_ecart;
    if (t === 'ORPHELIN_A' || t === 'ORPHELIN_B') {
      if (!seen.has(t)) {
        seen.add(t);
        const bg = t === 'ORPHELIN_A' ? 'var(--oa)' : 'var(--ob)';
        html += `<span style="font-size:.65rem;padding:.15rem .5rem;border-radius:3px;background:${bg};color:#fff;white-space:nowrap">${TYPE_LABELS[t]}</span>`;
      }
    } else if (e.rule_name && !seen.has(e.rule_name)) {
      seen.add(e.rule_name);
      const bg  = (typeof ruleColor === 'function') ? ruleColor(e.rule_name) : '#94a3b8';
      const lbl = t === 'KO' ? `✗ ${e.rule_name}` : `✓ ${e.rule_name}`;
      const active = _ctxActiveRules.has(e.rule_name);
      html += `<button onclick="_ctxToggleRule(this,'${esc(e.rule_name)}')" data-rule="${esc(e.rule_name)}" style="cursor:pointer;font-size:.65rem;padding:.15rem .5rem;border-radius:3px;border:2px solid ${bg};background:${active ? bg : 'transparent'};color:${active ? '#fff' : bg};white-space:nowrap;transition:all .15s">${esc(lbl)}</button>`;
    }
  });
  badgesEl.innerHTML = html;
}

function _ctxToggleRule(btn, ruleName) {
  if (_ctxActiveRules.has(ruleName)) {
    _ctxActiveRules.delete(ruleName);
  } else {
    _ctxActiveRules.add(ruleName);
  }
  // Mettre à jour l'apparence du bouton
  const bg = (typeof ruleColor === 'function') ? ruleColor(ruleName) : '#94a3b8';
  const active = _ctxActiveRules.has(ruleName);
  btn.style.background = active ? bg : 'transparent';
  btn.style.color      = active ? '#fff' : bg;
  // Re-render les panneaux avec le nouveau filtre
  if (_ctxLastData) _renderCtxPanels(_ctxLastData);
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
    _ctxLastData = data;
    _renderCtxPanels(data);
  } catch(e) { console.error('ctx fetch error', e); }
}

function _renderCtxPanels(data) {
  const diffSet = new Set(data.diff_fields || []);

  // Construire deux maps séparées : champ source → règles, champ cible → règles
  // e.champ format : "src_field op tgt_field" (ex: "qty ≠ qty")
  const srcFieldRuleMap = {};
  const tgtFieldRuleMap = {};
  _ctxEcarts.forEach(e => {
    if (!e.rule_name || !e.champ) return;
    if (!_ctxActiveRules.has(e.rule_name)) return; // ignorer les règles désactivées
    const color = (typeof ruleColor === 'function') ? ruleColor(e.rule_name) : '#94a3b8';
    const tokens = e.champ.split(' ');
    const srcField = tokens[0];
    const tgtField = tokens[tokens.length - 1];

    if (srcField) {
      if (!srcFieldRuleMap[srcField]) srcFieldRuleMap[srcField] = [];
      if (!srcFieldRuleMap[srcField].some(x => x.name === e.rule_name))
        srcFieldRuleMap[srcField].push({ name: e.rule_name, color });
    }
    if (tgtField) {
      if (!tgtFieldRuleMap[tgtField]) tgtFieldRuleMap[tgtField] = [];
      if (!tgtFieldRuleMap[tgtField].some(x => x.name === e.rule_name))
        tgtFieldRuleMap[tgtField].push({ name: e.rule_name, color });
    }
  });

  function renderPanel(rows, panelId, fieldRuleMap) {
    const el = document.getElementById(panelId);
    el.innerHTML = rows.map(row => {
      const center  = row.is_center;
      const keyHtml = `<div class="ctx-record-key">${esc(row.key)}</div>`;
      if (!row.data) {
        return `<div class="ctx-record${center?' is-center':''}">${keyHtml}<div class="ctx-absent">Absent</div></div>`;
      }
      const fields = Object.entries(row.data).map(([k, v]) => {
        const diff  = center && diffSet.has(k);
        const rules = center ? (fieldRuleMap[k] || []) : [];
        const highlighted = rules.length > 0;
        const dots  = rules.map(r =>
          `<span class="rule-dot" style="background:${r.color};display:inline-block;width:7px;height:7px;border-radius:50%;margin-left:3px;vertical-align:middle" title="${esc(r.name)}"></span>`
        ).join('');
        const valCls = highlighted ? ' ctx-rule-active' : '';
        return `<tr class="${diff?'ctx-diff':''}"><td>${esc(k)}${dots}</td><td class="${valCls}">${esc(String(v??''))}</td></tr>`;
      }).join('');
      return `<div class="ctx-record${center?' is-center':''}">${keyHtml}<table>${fields}</table></div>`;
    }).join('');
  }

  renderPanel(data.ref_rows, 'ctx-ref-rows', srcFieldRuleMap);
  renderPanel(data.tgt_rows, 'ctx-tgt-rows', tgtFieldRuleMap);

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
