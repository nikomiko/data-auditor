// ═══════════════════════════════════════════════════════════
//  WIZARD — État central
// ═══════════════════════════════════════════════════════════
function wizSrcDefault() {
  return {
    label:'', file:'', format:'csv', encoding:'utf-8', delimiter:';',
    has_header:true, skip_rows:0, max_columns:'', record_filter_marker:'',
    fixed_width:false,
    fields:[], column_positions:[],
    unpivot_enabled:false,
    unpivot:{ location_field:'location_key', value_field:'pivot_value', pivot_fields:[] }
  };
}
const WS = {
  meta:{ name:'', version:'' },
  sources:{ reference: wizSrcDefault(), target: wizSrcDefault() },
  join:{ keys:[] },
  rules:[],
  filters:[],
  report:{ show_matching:false, max_diff_preview:500 },
  _step:0,
  _visited: new Set([0]),
};

function wGetFieldNames(src) {
  const s    = WS.sources[src];
  const list = s.fixed_width ? s.column_positions : s.fields;

  if (s.unpivot_enabled) {
    // Après dépivotage : anchor_fields (non ignorés, non pivot) + location_field + value_field
    const pivotSources = new Set((s.unpivot.pivot_fields||[]).map(p=>p.source).filter(Boolean));
    const locField = s.unpivot.location_field || 'location_key';
    const valField = s.unpivot.value_field    || 'pivot_value';
    const anchors  = list.filter(f => f.name && !f.ignored && !pivotSources.has(f.name)).map(f => f.name);
    return [...anchors, locField, valField];
  }

  // Sans dépivotage : tous les champs non ignorés
  return list.filter(f => !f.ignored).map(f => f.name).filter(Boolean);
}

// ── Lecture YAML → WizardState ─────────────────────────────
function wizLoadFromYaml(parsed) {
  if (!parsed || typeof parsed !== 'object') return;
  // meta
  const m = parsed.meta || {};
  WS.meta.name    = m.name    || '';
  WS.meta.version = m.version || '';
  // Sync labels depuis les labels sources du YAML
  const rLabelYaml = ((parsed.sources||{}).reference||{}).label || '';
  const tLabelYaml = ((parsed.sources||{}).target||{}).label    || '';
  if (rLabelYaml) {
    refLabel = rLabelYaml;
    const inp = document.getElementById('inp-ref-label');
    if (inp) inp.value = rLabelYaml;
  }
  if (tLabelYaml) {
    tgtLabel = tLabelYaml;
    const inp = document.getElementById('inp-tgt-label');
    if (inp) inp.value = tLabelYaml;
  }
  if (rLabelYaml || tLabelYaml) updateSourceLabels();
  // Rien d'autre à synchroniser immédiatement ici — les étapes re-renderent à l'entrée
  // sources
  ['reference','target'].forEach(k => {
    const src = (parsed.sources || {})[k];
    if (!src) return;
    const s = WS.sources[k];
    s.label  = src.label    || '';
    s.file   = src.file     || '';
    s.format = src.format   || 'csv';
    s.encoding   = src.encoding  || 'utf-8';
    s.delimiter  = src.delimiter !== undefined ? src.delimiter : ';';
    s.has_header = src.has_header !== false;
    s.skip_rows  = src.skip_rows  || 0;
    s.max_columns = src.max_columns || '';
    s.record_filter_marker = (src.record_filter || {}).marker || '';
    s.fixed_width = !!src.fixed_width;
    if (src.column_positions && src.column_positions.length) {
      s.fixed_width = true;
      s.column_positions = src.column_positions.map(f => ({
        name: f.name||'', position: f.position||0, width: f.width||0,
        type: f.type||'string', date_format: f.date_format||'', ignored: !!f.ignored
      }));
      s.fields = [];
    } else if (src.fields && src.fields.length) {
      s.fields = src.fields.map(f => ({
        name: f.name||'', type: f.type||'string', date_format: f.date_format||'', ignored: !!f.ignored
      }));
      s.column_positions = [];
    }
    if (src.unpivot) {
      s.unpivot_enabled    = true;
      s.unpivot.location_field = src.unpivot.location_field || 'location_key';
      s.unpivot.value_field    = src.unpivot.value_field    || 'pivot_value';
      s.unpivot.pivot_fields   = (src.unpivot.pivot_fields||[]).map(p => ({
        source: p.source||'', location: p.location||''
      }));
      // Rétro-compat : si anchor_fields présent dans le YAML, en déduire les flags ignored
      if (src.unpivot.anchor_fields && src.unpivot.anchor_fields.length) {
        const anchorSet = new Set(src.unpivot.anchor_fields);
        const pivotSet  = new Set(s.unpivot.pivot_fields.map(p=>p.source).filter(Boolean));
        const fieldList = s.fixed_width ? s.column_positions : s.fields;
        fieldList.forEach(f => { f.ignored = !!(f.name && !anchorSet.has(f.name) && !pivotSet.has(f.name)); });
      }
    } else {
      s.unpivot_enabled = false;
    }
  });
  // join
  WS.join.keys = ((parsed.join||{}).keys||[]).map(k => ({
    source_field: k.source_field||'', target_field: k.target_field||''
  }));
  // rules
  const _OP_ALIAS = {'=':'equals','<>':'differs','>':'greater','<':'less'};
  const _normOp = op => _OP_ALIAS[op] || op || 'equals';
  WS.rules = (parsed.rules||[]).map(r => ({
    name: r.name||'', logic: r.logic||'AND', rule_type: r.rule_type||'coherence',
    fields: (r.fields||[]).map(f => {
      if (f.source_data) {
        const sd = f.source_data || {};
        const td = f.target_data || {};
        return {
          field_a:   sd.value !== undefined ? '__fixed__' : (sd.field||''),
          value_a:   sd.value !== undefined ? String(sd.value) : '',
          operator:  _normOp(f.operator),
          field_b:   td.value !== undefined ? '__fixed__' : (td.field||''),
          value_b:   td.value !== undefined ? String(td.value) : '',
          tolerance: td.tolerance !== undefined ? String(td.tolerance) : '',
          normalize: sd.normalize||'none'
        };
      } else if (f.target_value !== undefined) {
        return {
          field_a:  f.source_field||'', value_a:'',
          operator: _normOp(f.operator),
          field_b:  '__fixed__', value_b: String(f.target_value),
          tolerance: f.tolerance !== undefined ? String(f.tolerance) : '',
          normalize: f.normalize||'none'
        };
      } else {
        return {
          field_a:  f.source_field||'', value_a:'',
          operator: _normOp(f.operator),
          field_b:  f.target_field||f.source_field||'', value_b:'',
          tolerance: f.tolerance !== undefined ? String(f.tolerance) : '',
          normalize: f.normalize||'none'
        };
      }
    })
  }));
  // filters
  WS.filters = (parsed.filters||[]).map(f => ({
    field: f.field||'', source: f.source||'reference',
    values: (f.values||[]).join(', ')
  }));
  // report
  const rp = parsed.report || {};
  WS.report.show_matching   = !!rp.show_matching;
  WS.report.max_diff_preview = rp.max_diff_preview || 500;
}

// ── WizardState → YAML ─────────────────────────────────────
function wizBuildYaml() {
  const obj = {};
  // meta
  if (WS.meta.name || WS.meta.version) {
    obj.meta = {};
    if (WS.meta.name)    obj.meta.name    = WS.meta.name;
    if (WS.meta.version) obj.meta.version = WS.meta.version;
  }
  // sources
  obj.sources = {};
  ['reference','target'].forEach(k => {
    const s  = WS.sources[k];
    const sr = { format: s.format };
    if (s.label)    sr.label    = s.label;
    if (s.file)     sr.file     = s.file;
    if (s.encoding) sr.encoding = s.encoding;
    const noDelim = ['json','xlsx'].includes(s.format);
    if (!noDelim && s.delimiter !== undefined) sr.delimiter = s.delimiter;
    sr.has_header = s.has_header;
    if (s.skip_rows) sr.skip_rows = Number(s.skip_rows);
    if (s.max_columns) sr.max_columns = Number(s.max_columns);
    if (s.record_filter_marker) sr.record_filter = { marker: s.record_filter_marker };
    if (s.fixed_width) sr.fixed_width = true;
    // colonnes
    const noFields = ['json','xlsx'].includes(s.format);
    if (!noFields) {
      if (s.fixed_width) {
        sr.column_positions = s.column_positions.map(f => {
          const o = { name: f.name, position: Number(f.position), width: Number(f.width) };
          if (f.type && f.type !== 'string') o.type = f.type;
          if (f.type === 'date' && f.date_format) o.date_format = f.date_format;
          if (f.ignored) o.ignored = true;
          return o;
        });
      } else {
        sr.fields = s.fields.map(f => {
          const o = { name: f.name };
          if (f.type && f.type !== 'string') o.type = f.type;
          if (f.type === 'date' && f.date_format) o.date_format = f.date_format;
          if (f.ignored) o.ignored = true;
          return o;
        });
      }
    }
    // unpivot
    if (s.unpivot_enabled) {
      const fieldList   = s.fixed_width ? s.column_positions : s.fields;
      const pivotSources = new Set((s.unpivot.pivot_fields||[]).map(p=>p.source).filter(Boolean));
      const anchorFields = fieldList.filter(f => f.name && !f.ignored && !pivotSources.has(f.name)).map(f=>f.name);
      sr.unpivot = {
        anchor_fields:  anchorFields,
        location_field: s.unpivot.location_field || 'location_key',
        value_field:    s.unpivot.value_field    || 'pivot_value',
        pivot_fields:   s.unpivot.pivot_fields.filter(p => p.source)
                           .map(p => ({ source: p.source, location: p.location || p.source }))
      };
    }
    obj.sources[k] = sr;
  });
  // join
  const validKeys = WS.join.keys.filter(k => k.source_field && k.target_field);
  if (validKeys.length) obj.join = { keys: validKeys };
  // filters
  const validFilters = WS.filters.filter(f => f.field);
  if (validFilters.length) {
    obj.filters = validFilters.map(f => {
      const o = { field: f.field, source: f.source };
      const vals = f.values.split(',').map(v => v.trim()).filter(Boolean);
      if (vals.length) o.values = vals;
      return o;
    });
  }
  // rules
  if (WS.rules.length) {
    obj.rules = WS.rules.map(r => ({
      name: r.name,
      logic: r.logic || 'AND',
      rule_type: r.rule_type || 'coherence',
      fields: r.fields.map(f => {
        const aFixed = f.field_a === '__fixed__';
        const bFixed = f.field_b === '__fixed__';
        const op = f.operator || 'equals';
        if (!aFixed && bFixed) {
          // source_field + target_value (syntax courte)
          const o = { source_field: f.field_a };
          if (f.value_b !== '' && f.value_b !== undefined) o.target_value = f.value_b;
          o.operator = op;
          if (f.tolerance !== '' && f.tolerance !== undefined) o.tolerance = Number(f.tolerance);
          if (f.normalize && f.normalize !== 'none') o.normalize = f.normalize;
          return o;
        } else if (aFixed) {
          // source_data / target_data
          const sd = {};
          if (aFixed) sd.value = f.value_a; else sd.field = f.field_a;
          if (f.normalize && f.normalize !== 'none') sd.normalize = f.normalize;
          const td = {};
          if (bFixed) td.value = f.value_b; else td.field = f.field_b;
          if (f.tolerance !== '' && f.tolerance !== undefined) td.tolerance = Number(f.tolerance);
          const o = { source_data: sd, target_data: td };
          o.operator = op;
          return o;
        } else {
          // Normal : source_field + target_field
          const o = { source_field: f.field_a };
          if (f.field_b && f.field_b !== f.field_a) o.target_field = f.field_b;
          o.operator = op;
          if (f.tolerance !== '' && f.tolerance !== undefined) o.tolerance = Number(f.tolerance);
          if (f.normalize && f.normalize !== 'none') o.normalize = f.normalize;
          return o;
        }
      })
    }));
  }
  // report
  obj.report = {
    show_matching:    WS.report.show_matching,
    max_diff_preview: Number(WS.report.max_diff_preview) || 500,
  };
  return jsyaml.dump(obj, { lineWidth: 120, noRefs: true });
}

// ═══════════════════════════════════════════════════════════
//  WIZARD — Actions
// ═══════════════════════════════════════════════════════════
let _yamlListenerAdded = false;
function toggleYamlEditor() {
  const modal  = document.getElementById('yaml-modal');
  if (modal.style.display !== 'none') { closeYamlModal(); return; }
  _saveCurrentWFStep();
  const yamlEl = document.getElementById('yaml');
  if (!_yamlListenerAdded) {
    yamlEl.addEventListener('input', updateSaveBtn);
    _yamlListenerAdded = true;
  }
  yamlEl.value = wizBuildYaml();
  yamlOriginal = yamlEl.value;
  updateSaveBtn();
  modal.style.display = 'flex';
}

function closeYamlModal(e) {
  if (e && e.target !== document.getElementById('yaml-modal')) return;
  // Sync YAML textarea → wizard state si le contenu a changé
  const yamlEl = document.getElementById('yaml');
  const content = yamlEl.value;
  if (content !== yamlOriginal) {
    try {
      const parsed = jsyaml.load(content);
      if (parsed && typeof parsed === 'object') {
        wizLoadFromYaml(parsed);
        // Re-render l'étape courante
        if (wfCurrentStep === 1) onEnterRef();
        else if (wfCurrentStep === 2) onEnterTgt();
        else if (wfCurrentStep === 3) wizRenderJoin();
        else if (wfCurrentStep === 4) wizRenderRules();
        else if (wfCurrentStep === 5) wizRenderFilters();
      }
      yamlOriginal = content;
      updateSaveBtn();
    } catch(_) {}
  }
  document.getElementById('yaml-modal').style.display = 'none';
}

// ── Aide / Manuel ────────────────────────────────────────────
let _helpLoaded = false;
function openHelp() {
  document.getElementById('help-modal').style.display = 'flex';
  if (!_helpLoaded) {
    _helpLoaded = true;
    fetch('/docs/usermanual.md')
      .then(r => r.text())
      .then(md => {
        document.getElementById('help-pane-manual').innerHTML =
          typeof marked !== 'undefined' ? marked.parse(md) : '<pre>' + esc(md) + '</pre>';
      })
      .catch(() => {
        document.getElementById('help-pane-manual').innerHTML =
          '<p style="color:var(--muted)">Manuel non disponible — consultez docs/usermanual.md</p>';
      });
  }
}
function closeHelp(e) {
  if (e && e.target !== document.getElementById('help-modal')) return;
  document.getElementById('help-modal').style.display = 'none';
}
function switchHelpTab(name, btn) {
  document.querySelectorAll('.help-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.help-modal-tab').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('help-pane-' + name);
  pane.classList.add('active');
  // help-samples a un display:none inline au départ
  pane.style.display = name === 'samples' ? 'flex' : 'block';
  btn.classList.add('active');
}

function applyWizard() {
  wizSaveCurrentStep();
  const yaml = wizBuildYaml();
  document.getElementById('yaml').value = yaml;
  yamlOriginal = yaml;
  updateSaveBtn();
}

// ═══════════════════════════════════════════════════════════
//  WIZARD — Navigation
// ═══════════════════════════════════════════════════════════
function WIZ_LABELS() {
  return ['① ' + (refLabel||'Source A'), '② ' + (tgtLabel||'Source B'), '③ Jointure', '④ Règles', '⑤ Filtres & Rapport'];
}

function wizShowErr(msg) {
  const e = document.getElementById('gnav-wiz-err');
  if (!e) return;
  e.textContent = msg;
  if (msg) {
    e.classList.add('show');
    setTimeout(() => e.classList.remove('show'), 3500);
  } else {
    e.classList.remove('show');
  }
}

function wizClearErr() { wizShowErr(''); }

function wizValidateStep(step) {
  // step = wfCurrentStep (1=ref, 2=tgt, 3=join, 4=rules)
  if (step === 1) {
    const s = WS.sources.reference;
    if (!s.format) return 'Sélectionnez un format pour la source A.';
    if (!['json','xlsx'].includes(s.format)) {
      const list = s.fixed_width ? s.column_positions : s.fields;
      if (!list.length) return 'Déclarez au moins une colonne pour la source A.';
    }
  }
  if (step === 2) {
    const s = WS.sources.target;
    if (!s.format) return 'Sélectionnez un format pour la source B.';
    if (!['json','xlsx'].includes(s.format)) {
      const list = s.fixed_width ? s.column_positions : s.fields;
      if (!list.length) return 'Déclarez au moins une colonne pour la source B.';
    }
  }
  if (step === 3) {
    const valid = WS.join.keys.filter(k => k.source_field && k.target_field);
    if (!valid.length) return 'Définissez au moins une clé de jointure.';
  }
  if (step === 4) {
    for (const r of WS.rules) {
      if (!r.name) return 'Chaque règle doit avoir un nom.';
      if (!r.fields.length) return `La règle "${r.name}" doit avoir au moins un champ.`;
    }
  }
  return null;
}

function wizSaveCurrentStep() {
  _saveCurrentWFStep();
}

function wizardNext() { saveStepAndGo(wfCurrentStep + 1); }
function wizardPrev() { goWFStep(wfCurrentStep - 1); }
function wizardGoStep(n) { goWFStep(n); }
function wizRenderStep(step) { /* no-op: rendering is now per wf-view */ }

// ═══════════════════════════════════════════════════════════
//  WIZARD — Helpers HTML
// ═══════════════════════════════════════════════════════════
function wizField(label, inputHtml, id) {
  return `<div class="wiz-field"${id?' id="wf-'+id+'"':''}><label>${label}</label>${inputHtml}</div>`;
}
function wizInput(id, val, placeholder) {
  return `<input class="wiz-input" id="${id}" value="${esc(String(val??''))}" placeholder="${placeholder||''}">`;
}
function wizSelect(id, options, val) {
  const opts = options.map(([v,l]) => `<option value="${v}"${v===val?' selected':''}>${l}</option>`).join('');
  return `<select class="wiz-select" id="${id}">${opts}</select>`;
}
function wizToggleRow(id, label, checked) {
  return `<label class="wiz-toggle-row"><input type="checkbox" class="wiz-toggle" id="${id}"${checked?' checked':''}> ${label}</label>`;
}
function wizFieldSelect(idPrefix, names, val) {
  const opts = `<option value="">—</option>` + names.map(n => `<option value="${n}"${n===val?' selected':''}>${n}</option>`).join('');
  return `<select class="wiz-select" id="${idPrefix}">${opts}</select>`;
}

function wizFieldSelect2(id, names, val, fixedInputId) {
  const fixed = val === '__fixed__';
  const opts = `<option value=""${!fixed && !names.includes(val) ? ' selected' : ''}>— choisir —</option>`
    + `<option value="__fixed__"${fixed?' selected':''}>Valeur fixe</option>`
    + `<option disabled>──────────</option>`
    + names.map(n => `<option value="${esc(n)}"${val===n?' selected':''}>${esc(n)}</option>`).join('');
  return `<select class="wiz-select" id="${id}" onchange="toggleFixedInput('${fixedInputId}',this.value)">${opts}</select>`;
}

function toggleFixedInput(inputId, val) {
  const el = document.getElementById(inputId);
  if (el) el.style.display = val === '__fixed__' ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════
//  WIZARD — Étapes 0 & 1 : Sources
// ═══════════════════════════════════════════════════════════
function wizRenderSource(stepEl, srcKey, label) {
  const s = WS.sources[srcKey];
  const noDelim = ['json','xlsx'].includes(s.format);
  const noFields = ['json','xlsx'].includes(s.format);

  const fileLoaded = srcKey === 'reference' ? !!fileRef : !!fileTgt;
  const detectBanner = (fileLoaded && !_hasSourceConfig(srcKey) && !s.fixed_width && !noFields)
    ? `<div class="detect-banner">
        <span>Aucune colonne configurée — cliquez pour inférer la structure depuis le fichier.</span>
        <button class="btn-detect" onclick="detectAndApply('${srcKey}')">🔍 Détecter la structure</button>
      </div>`
    : '';

  const colsHtml = noFields
    ? `<div class="wiz-warn">Format <strong>${s.format}</strong> : colonnes détectées automatiquement au parsing.</div>`
    : `<div>
        ${wizToggleRow('w-fw-'+srcKey, 'Format à largeur fixe (fixed_width)', s.fixed_width)}
      </div>
      <table class="col-table" id="ctbl-${srcKey}">
        <thead><tr>${s.fixed_width
          ? '<th>Nom</th><th>Position</th><th>Largeur</th><th>Type</th><th title="Format Python strftime. Exemples&#10;%d/%m/%Y → 31/12/2024&#10;%Y-%m-%d → 2024-12-31&#10;%Y%m%d → 20241231&#10;%d/%m/%Y %H:%M:%S → date+heure&#10;Codes : %Y=année %m=mois %d=jour %H=heure %M=minute %S=seconde">Date fmt ⓘ</th><th title="Exclure ce champ des jointures et des règles">Ign.</th><th></th>'
          : '<th>Nom</th><th>Type</th><th title="Format Python strftime. Exemples&#10;%d/%m/%Y → 31/12/2024&#10;%Y-%m-%d → 2024-12-31&#10;%Y%m%d → 20241231&#10;%d/%m/%Y %H:%M:%S → date+heure&#10;Codes : %Y=année %m=mois %d=jour %H=heure %M=minute %S=seconde">Date fmt ⓘ</th><th title="Exclure ce champ des jointures et des règles">Ign.</th><th></th>'
        }</tr></thead>
        <tbody id="ctbody-${srcKey}">
          ${wizColRows(srcKey, s)}
        </tbody>
      </table>
      <button class="btn-wiz-add" onclick="wizAddCol('${srcKey}')">+ Colonne</button>`;

  const unpivotFieldsHtml = s.unpivot_enabled ? `
    <div class="wiz-grid" style="margin-top:.5rem">
      ${wizField('Nom du champ «clé» (dépivoté) <i class="wiz-info" title="Nom de la nouvelle colonne qui contiendra la clé de chaque entrée dépivotée. Ex : \'depot\' → chaque ligne générée aura une colonne depot avec la valeur depot_A, depot_B…">i</i>', wizInput('w-ul-'+srcKey, s.unpivot.location_field, 'ex: depot'))}
      ${wizField('Nom du champ «valeur» (dépivoté) <i class="wiz-info" title="Nom de la nouvelle colonne qui contiendra la valeur dépivotée. Ex : \'qty\' → chaque ligne aura une colonne qty avec la valeur 100, 200…">i</i>', wizInput('w-uv-'+srcKey, s.unpivot.value_field, 'ex: qty'))}
    </div>
    <p style="font-size:.72rem;color:var(--muted);margin:.25rem 0 .5rem">Colonnes identité = champs non ignorés et non utilisés comme clés de dépivotage (cochés «Ign.» dans le tableau ci-dessus).</p>
    <div class="wiz-section-title" style="margin-top:.75rem;font-size:.72rem">Liste des clés</div>
    <table class="col-table">
      <thead><tr>
        <th>Colonne à utiliser <i class="wiz-info" title="Colonne de votre fichier large dont les valeurs seront dépivotées. Ex : qty_A, qty_B, qty_C">i</i></th>
        <th>Clé (dépivoté) <i class="wiz-info" title="Valeur qui apparaîtra dans le champ «clé» pour cette colonne. Optionnel — par défaut = nom de la colonne sélectionnée.">i</i></th>
        <th></th>
      </tr></thead>
      <tbody id="ptbody-${srcKey}">${wizPivotRows(srcKey, s)}</tbody>
    </table>
    <button class="btn-wiz-add" onclick="wizAddPivot('${srcKey}')">+ Ajouter une clé</button>` : '';

  stepEl.innerHTML = `
    <div class="wiz-section">
      <div class="wiz-section-title">${label}</div>
      <div class="wiz-grid">
        ${wizField('Format', wizSelect('w-fmt-'+srcKey, [['csv','CSV'],['txt','TXT'],['dat','DAT'],['json','JSON'],['xlsx','XLSX']], s.format))}
        ${wizField('Label', wizInput('w-lbl-'+srcKey, s.label, 'ex: Stock WMS'))}
        ${wizField('Chemin du fichier', wizInput('w-file-'+srcKey, s.file, 'ex: /data/export.csv'))}
        ${wizField('Encodage', wizSelect('w-enc-'+srcKey, [['utf-8','UTF-8'],['utf-8-sig','UTF-8 avec BOM'],['windows-1252','Windows-1252 (ANSI)'],['latin-1','Latin-1 / ISO-8859-1']], s.encoding||'utf-8'))}
        ${noDelim ? '' : wizField('Délimiteur', wizInput('w-del-'+srcKey, s.delimiter, ';'))}
        ${wizField('Skip rows', wizInput('w-sk-'+srcKey, s.skip_rows, '0'))}
        ${wizField('Max colonnes', wizInput('w-mc-'+srcKey, s.max_columns, 'optionnel'))}
        ${wizField('Filtre lignes (regex)', wizInput('w-rf-'+srcKey, s.record_filter_marker, 'ex: ^1'))}
      </div>
      ${wizToggleRow('w-hh-'+srcKey, 'Has header', s.has_header)}
    </div>
    <div class="wiz-section">
      <div class="wiz-section-title">Colonnes</div>
      ${detectBanner}
      ${colsHtml}
    </div>
    <div class="wiz-section">
      <div class="wiz-section-title">Dépivotage (unpivot)</div>
      ${wizToggleRow('w-ue-'+srcKey, 'Activer le dépivotage', s.unpivot_enabled)}
      <div id="unpivot-fields-${srcKey}">${unpivotFieldsHtml}</div>
    </div>`;

  // Binding toggle fixed_width
  const fwEl = document.getElementById('w-fw-'+srcKey);
  if (fwEl) fwEl.addEventListener('change', () => wizToggleFW(srcKey));

  // Binding toggle unpivot
  const ueEl = document.getElementById('w-ue-'+srcKey);
  if (ueEl) ueEl.addEventListener('change', () => {
    wizReadSourceForm(srcKey);
    const cur = WS.sources[srcKey];
    document.getElementById('unpivot-fields-'+srcKey).innerHTML =
      cur.unpivot_enabled ? `
        <div class="wiz-grid" style="margin-top:.5rem">
          ${wizField('Nom du champ «clé» (dépivoté) <i class="wiz-info" title="Nom de la nouvelle colonne qui contiendra la clé de chaque entrée dépivotée. Ex : \'depot\'">i</i>', wizInput('w-ul-'+srcKey, cur.unpivot.location_field, 'ex: depot'))}
          ${wizField('Nom du champ «valeur» (dépivoté) <i class="wiz-info" title="Nom de la nouvelle colonne qui contiendra la valeur dépivotée. Ex : \'qty\'">i</i>', wizInput('w-uv-'+srcKey, cur.unpivot.value_field, 'ex: qty'))}
        </div>
        <p style="font-size:.72rem;color:var(--muted);margin:.25rem 0 .5rem">Colonnes identité = champs non ignorés et non utilisés comme clés de dépivotage (cochés «Ign.» dans le tableau ci-dessus).</p>
        <div class="wiz-section-title" style="margin-top:.75rem;font-size:.72rem">Liste des clés</div>
        <table class="col-table">
          <thead><tr>
            <th>Colonne à utiliser <i class="wiz-info" title="Colonne de votre fichier large dont les valeurs seront dépivotées. Ex : qty_A">i</i></th>
            <th>Clé (dépivoté) <i class="wiz-info" title="Valeur qui apparaîtra dans le champ «clé» pour cette colonne. Optionnel — par défaut = nom de la colonne.">i</i></th>
            <th></th>
          </tr></thead>
          <tbody id="ptbody-${srcKey}">${wizPivotRows(srcKey, cur)}</tbody>
        </table>
        <button class="btn-wiz-add" onclick="wizAddPivot('${srcKey}')">+ Ajouter une clé</button>` : '';
  });

  // Binding format change
  const fmtEl = document.getElementById('w-fmt-'+srcKey);
  if (fmtEl) fmtEl.addEventListener('change', () => {
    wizReadSourceForm(srcKey);
    wizRenderSource(stepEl, srcKey, label);
  });

  // Binding encodage change → re-parse le fichier pour rafraîchir les colonnes
  const encEl = document.getElementById('w-enc-'+srcKey);
  if (encEl) encEl.addEventListener('change', () => {
    wizReadSourceForm(srcKey);
    const file = srcKey === 'reference' ? fileRef : fileTgt;
    if (file) autoDetectColumns(srcKey, file).then(() => wizRenderSource(stepEl, srcKey, label));
  });
}

function wizColRows(srcKey, s) {
  const list = s.fixed_width ? s.column_positions : s.fields;
  const typeOpts = [['string','string'],['integer','integer'],['decimal','decimal'],['date','date'],['boolean','boolean']];
  return list.map((f, i) => {
    const type = f.type || 'string';
    const typeSelHtml = `<select class="wiz-select" id="w-ct-${srcKey}-${i}" onchange="wizToggleDateFmt('${srcKey}',${i},this.value)">`
      + typeOpts.map(([v,l]) => `<option value="${v}"${v===type?' selected':''}>${l}</option>`).join('')
      + `</select>`;
    const dfHtml = `<div id="w-df-wrap-${srcKey}-${i}" style="${type !== 'date' ? 'display:none' : ''}">`
      + wizInput(`w-df-${srcKey}-${i}`, f.date_format || '', '%Y-%m-%d')
      + `</div>`;
    const ignHtml = `<input type="checkbox" id="w-ig-${srcKey}-${i}" title="Ignorer ce champ"${f.ignored?' checked':''} style="cursor:pointer">`;
    if (s.fixed_width) {
      return `<tr${f.ignored?' style="opacity:.45"':''}>
        <td>${wizInput(`w-cn-${srcKey}-${i}`, f.name, 'nom')}</td>
        <td>${wizInput(`w-cp-${srcKey}-${i}`, f.position, '0')}</td>
        <td>${wizInput(`w-cw-${srcKey}-${i}`, f.width, '1')}</td>
        <td>${typeSelHtml}</td>
        <td>${dfHtml}</td>
        <td style="text-align:center">${ignHtml}</td>
        <td><button class="btn-icon" onclick="wizRemoveCol('${srcKey}',${i})" title="Supprimer">✕</button></td>
      </tr>`;
    } else {
      return `<tr${f.ignored?' style="opacity:.45"':''}>
        <td>${wizInput(`w-cn-${srcKey}-${i}`, f.name, 'nom')}</td>
        <td>${typeSelHtml}</td>
        <td>${dfHtml}</td>
        <td style="text-align:center">${ignHtml}</td>
        <td><button class="btn-icon" onclick="wizRemoveCol('${srcKey}',${i})" title="Supprimer">✕</button></td>
      </tr>`;
    }
  }).join('');
}

function wizToggleDateFmt(srcKey, i, type) {
  const wrap = document.getElementById(`w-df-wrap-${srcKey}-${i}`);
  if (wrap) wrap.style.display = type === 'date' ? '' : 'none';
}

function wizPivotRows(srcKey, s) {
  const colNames = (s.fixed_width ? s.column_positions : s.fields)
    .map(f => f.name).filter(Boolean);
  return (s.unpivot.pivot_fields||[]).map((p, i) => `<tr>
    <td>${wizFieldSelect(`w-ps-${srcKey}-${i}`, colNames, p.source)}</td>
    <td><input class="wiz-input" id="w-pl-${srcKey}-${i}" value="${esc(p.location)}" placeholder="= ${esc(p.source||'nom colonne')}"></td>
    <td><button class="btn-icon" onclick="wizRemovePivot('${srcKey}',${i})" title="Supprimer">✕</button></td>
  </tr>`).join('');
}

function wizAddCol(srcKey) {
  wizReadSourceForm(srcKey);
  const s = WS.sources[srcKey];
  if (s.fixed_width) {
    const prev = s.column_positions[s.column_positions.length - 1];
    const nextPos = prev ? (Number(prev.position) + Number(prev.width)) : 0;
    s.column_positions.push({name:'', position:nextPos, width:1, type:'string', date_format:'', ignored:false});
  }
  else s.fields.push({name:'', type:'string', date_format:'', ignored:false});
  const tbody = document.getElementById('ctbody-'+srcKey);
  if (tbody) tbody.innerHTML = wizColRows(srcKey, s);
}

function wizRemoveCol(srcKey, idx) {
  wizReadSourceForm(srcKey);
  const s = WS.sources[srcKey];
  if (s.fixed_width) s.column_positions.splice(idx,1);
  else s.fields.splice(idx,1);
  const tbody = document.getElementById('ctbody-'+srcKey);
  if (tbody) tbody.innerHTML = wizColRows(srcKey, s);
}

function wizAddPivot(srcKey) {
  wizReadSourceForm(srcKey);
  WS.sources[srcKey].unpivot.pivot_fields.push({source:'', location:''});
  const tbody = document.getElementById('ptbody-'+srcKey);
  if (tbody) tbody.innerHTML = wizPivotRows(srcKey, WS.sources[srcKey]);
}

function wizRemovePivot(srcKey, idx) {
  wizReadSourceForm(srcKey);
  WS.sources[srcKey].unpivot.pivot_fields.splice(idx,1);
  const tbody = document.getElementById('ptbody-'+srcKey);
  if (tbody) tbody.innerHTML = wizPivotRows(srcKey, WS.sources[srcKey]);
}

function wizToggleFW(srcKey) {
  wizReadSourceForm(srcKey);
  const s = WS.sources[srcKey];
  s.fixed_width = !s.fixed_width;
  const dfTooltip = 'title="Format Python strftime. Exemples&#10;%d/%m/%Y → 31/12/2024&#10;%Y-%m-%d → 2024-12-31&#10;%Y%m%d → 20241231&#10;%d/%m/%Y %H:%M:%S → date+heure&#10;Codes : %Y=année %m=mois %d=jour %H=heure %M=minute %S=seconde"';
  if (s.fixed_width) {
    s.column_positions = s.fields.map(f => ({name:f.name, position:0, width:1, type:f.type, date_format:f.date_format, ignored:!!f.ignored}));
    s.fields = [];
  } else {
    s.fields = s.column_positions.map(f => ({name:f.name, type:f.type, date_format:f.date_format, ignored:!!f.ignored}));
    s.column_positions = [];
  }
  const tbody = document.getElementById('ctbody-'+srcKey);
  const thead = tbody?.closest('table')?.querySelector('thead tr');
  if (thead) thead.innerHTML = s.fixed_width
    ? `<th>Nom</th><th>Position</th><th>Largeur</th><th>Type</th><th ${dfTooltip}>Date fmt ⓘ</th><th title="Exclure ce champ des jointures et des règles">Ign.</th><th></th>`
    : `<th>Nom</th><th>Type</th><th ${dfTooltip}>Date fmt ⓘ</th><th title="Exclure ce champ des jointures et des règles">Ign.</th><th></th>`;
  if (tbody) tbody.innerHTML = wizColRows(srcKey, s);
}

function wizReadSourceForm(srcKey) {
  const s  = WS.sources[srcKey];
  const g  = id => { const el = document.getElementById(id); return el ? el.value : null; };
  const gc = id => { const el = document.getElementById(id); return el ? el.checked : null; };
  if (g('w-fmt-'+srcKey)  !== null) s.format  = g('w-fmt-'+srcKey);
  if (g('w-lbl-'+srcKey)  !== null) s.label   = g('w-lbl-'+srcKey);
  if (g('w-file-'+srcKey) !== null) s.file    = g('w-file-'+srcKey);
  if (g('w-enc-'+srcKey)  !== null) s.encoding = g('w-enc-'+srcKey);
  if (g('w-del-'+srcKey) !== null) s.delimiter = g('w-del-'+srcKey);
  if (g('w-sk-'+srcKey)  !== null) s.skip_rows = Number(g('w-sk-'+srcKey))||0;
  if (g('w-mc-'+srcKey)  !== null) s.max_columns = g('w-mc-'+srcKey);
  if (g('w-rf-'+srcKey)  !== null) s.record_filter_marker = g('w-rf-'+srcKey);
  if (gc('w-hh-'+srcKey) !== null) s.has_header = gc('w-hh-'+srcKey);
  if (gc('w-ue-'+srcKey) !== null) s.unpivot_enabled = gc('w-ue-'+srcKey);
  if (gc('w-fw-'+srcKey) !== null) s.fixed_width = gc('w-fw-'+srcKey);
  // Colonnes
  const list = s.fixed_width ? s.column_positions : s.fields;
  list.forEach((f, i) => {
    if (g(`w-cn-${srcKey}-${i}`) !== null) f.name = g(`w-cn-${srcKey}-${i}`);
    if (g(`w-ct-${srcKey}-${i}`) !== null) f.type = g(`w-ct-${srcKey}-${i}`);
    if (g(`w-df-${srcKey}-${i}`) !== null) f.date_format = g(`w-df-${srcKey}-${i}`);
    const igEl = document.getElementById(`w-ig-${srcKey}-${i}`);
    if (igEl !== null) f.ignored = igEl.checked;
    if (s.fixed_width) {
      if (g(`w-cp-${srcKey}-${i}`) !== null) f.position = Number(g(`w-cp-${srcKey}-${i}`))||0;
      if (g(`w-cw-${srcKey}-${i}`) !== null) f.width    = Number(g(`w-cw-${srcKey}-${i}`))||1;
    }
  });
  // Unpivot
  if (g('w-ul-'+srcKey) !== null) s.unpivot.location_field = g('w-ul-'+srcKey);
  if (g('w-uv-'+srcKey) !== null) s.unpivot.value_field    = g('w-uv-'+srcKey);
  (s.unpivot.pivot_fields||[]).forEach((p, i) => {
    if (g(`w-ps-${srcKey}-${i}`) !== null) p.source   = g(`w-ps-${srcKey}-${i}`);
    if (g(`w-pl-${srcKey}-${i}`) !== null) p.location = g(`w-pl-${srcKey}-${i}`);
  });
}

function wizRenderSource0() { onEnterRef(); }
function wizRenderSource1() { onEnterTgt(); }

// ═══════════════════════════════════════════════════════════
//  WIZARD — Étape 2 : Jointure
// ═══════════════════════════════════════════════════════════
function wizRenderJoin() {
  const refNames = wGetFieldNames('reference');
  const tgtNames = wGetFieldNames('target');
  const warn = (!refNames.length || !tgtNames.length)
    ? `<div class="wiz-warn">Les colonnes ne sont pas encore déclarées. Revenez aux étapes ① et ② pour les définir.</div>` : '';

  const rowsHtml = WS.join.keys.map((k, i) => `<tr>
    <td>${wizFieldSelect('w-jsr-'+i, refNames, k.source_field)}</td>
    <td>${wizFieldSelect('w-jtg-'+i, tgtNames, k.target_field)}</td>
    <td><button class="btn-icon" onclick="wizRemoveJoinKey(${i})">✕</button></td>
  </tr>`).join('');

  document.getElementById('wfv-3-body').innerHTML = `
    <div class="wiz-section">
      <div class="wiz-section-title">Clés de jointure</div>
      ${warn}
      <table class="col-table">
        <thead><tr><th>Champ Source A</th><th>Champ Source B</th><th></th></tr></thead>
        <tbody id="jtbody">${rowsHtml}</tbody>
      </table>
      <button class="btn-wiz-add" onclick="wizAddJoinKey()">+ Ajouter une clé</button>
    </div>
    <div class="wiz-section">
      <div class="wiz-section-title">Test de la clé</div>
      <button class="btn-xs" id="btn-test-join" onclick="wizTestJoin()"
        ${(!fileRef || !fileTgt) ? 'disabled title="Chargez les fichiers pour tester"' : ''}>
        Tester la clé
      </button>
      ${(!fileRef || !fileTgt) ? '<span style="font-size:.72rem;color:var(--muted);margin-left:.5rem">⚠ Fichiers non chargés</span>' : ''}
      <div id="join-result"></div>
    </div>`;
}

function wizAddJoinKey() {
  wizReadJoinForm();
  WS.join.keys.push({source_field:'', target_field:''});
  wizRenderJoin();
}

function wizRemoveJoinKey(idx) {
  wizReadJoinForm();
  WS.join.keys.splice(idx,1);
  wizRenderJoin();
}

function wizReadJoinForm() {
  WS.join.keys.forEach((k, i) => {
    const s = document.getElementById('w-jsr-'+i);
    const t = document.getElementById('w-jtg-'+i);
    if (s) k.source_field = s.value;
    if (t) k.target_field = t.value;
  });
}

async function wizTestJoin() {
  wizReadJoinForm();
  const btn = document.getElementById('btn-test-join');
  const res = document.getElementById('join-result');
  btn.disabled = true;
  btn.textContent = '…';
  res.innerHTML = '';
  try {
    // YAML partiel avec seulement sources + join
    const partialObj = { sources: wizBuildSourcesObj(), join: { keys: WS.join.keys.filter(k=>k.source_field&&k.target_field) } };
    const partialYaml = jsyaml.dump(partialObj, {lineWidth:120, noRefs:true});
    const fd = new FormData();
    fd.append('file_ref', fileRef);
    fd.append('file_tgt', fileTgt);
    fd.append('config_yaml', partialYaml);
    const resp = await fetch('/api/test-join', { method:'POST', body:fd });
    const data = await resp.json();
    if (data.error) { res.innerHTML = `<div class="wiz-warn">${esc(data.error)}</div>`; return; }
    const tgtKeySet = new Set(data.keys_tgt);
    const refKeySet = new Set(data.keys_ref);
    const labelA = esc(WS.sources.reference.label || 'Source A');
    const labelB = esc(WS.sources.target.label    || 'Source B');
    const keysHtml = `
      <div class="key-preview-cols">
        <div class="key-preview-col">
          <div class="key-preview-head">${labelA} <span class="key-preview-count">${data.keys_ref.length} clé(s)</span></div>
          ${data.keys_ref.map(k => '<div class="kp-item' + (tgtKeySet.has(k) ? '' : ' kp-only-a') + '">' + esc(k) + '</div>').join('')}
        </div>
        <div class="key-preview-col">
          <div class="key-preview-head">${labelB} <span class="key-preview-count">${data.keys_tgt.length} clé(s)</span></div>
          ${data.keys_tgt.map(k => '<div class="kp-item' + (refKeySet.has(k) ? '' : ' kp-only-b') + '">' + esc(k) + '</div>').join('')}
        </div>
      </div>`;
    res.innerHTML = `<div class="join-result">
      <div class="join-stats">
        <div class="join-stat m"><span class="n">${data.matched.toLocaleString('fr-FR')}</span><span>paires matchées</span></div>
        <div class="join-stat a"><span class="n">${data.orphelins_a.toLocaleString('fr-FR')}</span><span>pas dans la cible</span></div>
        <div class="join-stat b"><span class="n">${data.orphelins_b.toLocaleString('fr-FR')}</span><span>pas dans la réf.</span></div>
        <div class="join-stat" style="color:var(--muted)"><span class="n" style="font-size:.85rem">${data.total_ref}</span><span>réf.</span></div>
        <div class="join-stat" style="color:var(--muted)"><span class="n" style="font-size:.85rem">${data.total_tgt}</span><span>cible</span></div>
      </div>
      ${keysHtml}
    </div>`;
  } catch(e) {
    res.innerHTML = `<div class="wiz-warn">Erreur réseau : ${esc(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tester la clé';
  }
}

function wizBuildSourcesObj() {
  const obj = {};
  ['reference','target'].forEach(k => {
    const s = WS.sources[k];
    const sr = { format:s.format };
    if (s.encoding) sr.encoding = s.encoding;
    if (s.delimiter) sr.delimiter = s.delimiter;
    sr.has_header = s.has_header;
    if (s.skip_rows) sr.skip_rows = s.skip_rows;
    if (s.record_filter_marker) sr.record_filter = { marker:s.record_filter_marker };
    if (s.fixed_width) sr.fixed_width = true;
    if (s.fixed_width) {
      if (s.column_positions.length) sr.column_positions = s.column_positions.map(f=>({name:f.name, position:Number(f.position), width:Number(f.width), type:f.type||'string'}));
    } else {
      if (s.fields.length) sr.fields = s.fields.map(f=>({name:f.name, type:f.type||'string'}));
    }
    if (s.unpivot_enabled) {
      const fieldList2    = s.fixed_width ? s.column_positions : s.fields;
      const pivotSources2 = new Set((s.unpivot.pivot_fields||[]).map(p=>p.source).filter(Boolean));
      const anchorFields2 = fieldList2.filter(f => f.name && !f.ignored && !pivotSources2.has(f.name)).map(f=>f.name);
      sr.unpivot = {
        anchor_fields:  anchorFields2,
        location_field: s.unpivot.location_field,
        value_field:    s.unpivot.value_field,
        pivot_fields:   s.unpivot.pivot_fields
      };
    }
    obj[k] = sr;
  });
  return obj;
}

// ═══════════════════════════════════════════════════════════
//  WIZARD — Étape 3 : Règles
// ═══════════════════════════════════════════════════════════
function wizRenderRules() {
  const el = document.getElementById('wfv-4-body');
  const refNames = wGetFieldNames('reference');
  const tgtNames = wGetFieldNames('target');

  const rulesHtml = WS.rules.map((r, ri) => `
    <div class="rule-card" id="rcard-${ri}">
      <div class="rule-card-hdr">
        <div class="rule-card-name">
          <span style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);white-space:nowrap;flex-shrink:0">Règle</span>
          <input id="w-rn-${ri}" value="${esc(r.name)}" placeholder="Saisir le nom de la règle…">
        </div>
        <div class="rule-card-actions">
          <span style="font-size:.65rem;color:var(--muted)">Logique</span>
          ${wizSelect('w-rl-'+ri, [['AND','AND'],['OR','OR']], r.logic)}
          <span style="font-size:.65rem;color:var(--muted);margin-left:.5rem">Type</span>
          ${wizSelect('w-rt-'+ri, [['coherence','Cohérence'],['incoherence','Incohérence']], r.rule_type||'coherence')}
          <div style="flex:1"></div>
          <button class="btn-icon" onclick="wizMoveRule(${ri},-1)" title="Monter">↑</button>
          <button class="btn-icon" onclick="wizMoveRule(${ri},1)"  title="Descendre">↓</button>
          <button class="btn-icon" onclick="wizRemoveRule(${ri})" title="Supprimer">✕</button>
        </div>
      </div>
      <div class="rule-card-body">
        <table class="col-table">
          <thead><tr><th>Champ A</th><th>Opérateur</th><th>Champ B</th><th>Normalize</th><th>Tolérance</th><th></th></tr></thead>
          <tbody id="rfbody-${ri}">${wizRuleFieldRows(ri, r, refNames, tgtNames)}</tbody>
        </table>
        <button class="btn-wiz-add" onclick="wizAddRuleField(${ri})">+ Champ</button>
      </div>
    </div>`).join('');

  el.innerHTML = `
    <div class="wiz-section">
      <div class="wiz-section-title">Règles de contrôle</div>
      <div id="rules-list">${rulesHtml || '<p style="color:var(--muted);font-size:.78rem">Aucune règle. Cliquez sur + pour en ajouter.</p>'}</div>
      <button class="btn-nav" onclick="wizAddRule()">+ Ajouter une règle</button>
    </div>`;
}

function wizRuleFieldRows(ri, r, refNames, tgtNames) {
  const opOpts = [['equals','= (equals)'],['differs','≠ (differs)'],['greater','> (greater)'],['less','< (less)'],['contains','contient'],['not_contains','ne contient pas'],['matches','∼ regex match'],['not_matches','≁ regex non match']];
  const normOpts = [['none','none'],['trim','trim'],['lowercase','lowercase'],['both','both']];

  return r.fields.map((f, fi) => {
    const fa  = f.field_a  !== undefined ? f.field_a  : '';
    const fb  = f.field_b  !== undefined ? f.field_b  : '';
    const va  = f.value_a  !== undefined ? String(f.value_a)  : '';
    const vb  = f.value_b  !== undefined ? String(f.value_b)  : '';
    const op  = f.operator || 'equals';
    const tol = f.tolerance !== undefined ? String(f.tolerance) : '';
    const norm = f.normalize || 'none';
    const aFixed = fa === '__fixed__';
    const bFixed = fb === '__fixed__';

    const selA = wizFieldSelect2(`w-rf-fa-${ri}-${fi}`, refNames, fa, `w-rf-va-${ri}-${fi}`);
    const inpA = `<input class="wiz-input" id="w-rf-va-${ri}-${fi}" value="${esc(va)}" placeholder="valeur" style="${aFixed?'':'display:none'};width:80px;margin-top:2px">`;

    const selB = wizFieldSelect2(`w-rf-fb-${ri}-${fi}`, tgtNames, fb, `w-rf-vb-${ri}-${fi}`);
    const inpB = `<input class="wiz-input" id="w-rf-vb-${ri}-${fi}" value="${esc(vb)}" placeholder="valeur" style="${bFixed?'':'display:none'};width:80px;margin-top:2px">`;

    return `<tr>
      <td><div style="display:flex;flex-direction:column;gap:2px">${selA}${inpA}</div></td>
      <td>${wizSelect(`w-rf-op-${ri}-${fi}`, opOpts, op)}</td>
      <td><div style="display:flex;flex-direction:column;gap:2px">${selB}${inpB}</div></td>
      <td>${wizSelect(`w-rf-norm-${ri}-${fi}`, normOpts, norm)}</td>
      <td><input class="wiz-input" id="w-rf-tol-${ri}-${fi}" value="${esc(tol)}" placeholder="0.01" style="width:60px"></td>
      <td><button class="btn-icon" onclick="wizRemoveRuleField(${ri},${fi})">✕</button></td>
    </tr>`;
  }).join('');
}

function wizReadRulesForm() {
  WS.rules.forEach((r, ri) => {
    const n = document.getElementById('w-rn-'+ri);
    const l = document.getElementById('w-rl-'+ri);
    const t = document.getElementById('w-rt-'+ri);
    if (n) r.name      = n.value;
    if (l) r.logic     = l.value;
    if (t) r.rule_type = t.value;
    r.fields.forEach((f, fi) => {
      const fa  = document.getElementById(`w-rf-fa-${ri}-${fi}`);
      const va  = document.getElementById(`w-rf-va-${ri}-${fi}`);
      const op  = document.getElementById(`w-rf-op-${ri}-${fi}`);
      const fb  = document.getElementById(`w-rf-fb-${ri}-${fi}`);
      const vb  = document.getElementById(`w-rf-vb-${ri}-${fi}`);
      const tol = document.getElementById(`w-rf-tol-${ri}-${fi}`);
      const nm  = document.getElementById(`w-rf-norm-${ri}-${fi}`);
      if (fa)  f.field_a   = fa.value;
      if (va)  f.value_a   = va.value;
      if (op)  f.operator  = op.value;
      if (fb)  f.field_b   = fb.value;
      if (vb)  f.value_b   = vb.value;
      if (tol) f.tolerance = tol.value;
      if (nm)  f.normalize = nm.value;
    });
  });
}

function wizAddRule() {
  wizReadRulesForm();
  WS.rules.push({ name:'', logic:'AND', rule_type:'coherence', fields:[] });
  wizRenderRules();
}

function wizRemoveRule(ri) {
  wizReadRulesForm();
  WS.rules.splice(ri,1);
  wizRenderRules();
}

function wizMoveRule(ri, dir) {
  wizReadRulesForm();
  const ni = ri + dir;
  if (ni < 0 || ni >= WS.rules.length) return;
  [WS.rules[ri], WS.rules[ni]] = [WS.rules[ni], WS.rules[ri]];
  wizRenderRules();
}

function wizAddRuleField(ri) {
  wizReadRulesForm();
  WS.rules[ri].fields.push({ field_a:'', value_a:'', operator:'equals', field_b:'', value_b:'', tolerance:'', normalize:'none' });
  wizRenderRules();
}

function wizRemoveRuleField(ri, fi) {
  wizReadRulesForm();
  WS.rules[ri].fields.splice(fi,1);
  wizRenderRules();
}

// ═══════════════════════════════════════════════════════════
//  WIZARD — Étape 4 : Filtres & Rapport
// ═══════════════════════════════════════════════════════════
function wizRenderFilters() {
  const filterRows = WS.filters.map((f, i) => `<tr>
    <td>${wizInput('w-ff-'+i, f.field, 'champ')}</td>
    <td>${wizSelect('w-fs-'+i, [['reference','Source A'],['target','Source B']], f.source)}</td>
    <td>${wizInput('w-fv-'+i, f.values, 'val1, val2, …')}</td>
    <td><button class="btn-icon" onclick="wizRemoveFilter(${i})">✕</button></td>
  </tr>`).join('');

  document.getElementById('wfv-5-body').innerHTML = `
    <div class="wiz-section wiz-section-narrow">
      <div class="wiz-section-title">Filtres</div>
      <table class="col-table">
        <thead><tr><th>Champ</th><th>Source</th><th>Valeurs (virgule)</th><th></th></tr></thead>
        <tbody id="ftbody">${filterRows}</tbody>
      </table>
      <button class="btn-wiz-add" onclick="wizAddFilter()">+ Filtre</button>
    </div>
    <div class="wiz-section wiz-section-narrow">
      <div class="wiz-section-title">Rapport</div>
      <div class="wiz-grid">
        ${wizField('Max lignes prévisualisées', wizInput('w-rp-mdp', WS.report.max_diff_preview, '500'))}
      </div>
      ${wizToggleRow('w-rp-sm', 'Afficher les lignes conformes (show_matching)', WS.report.show_matching)}
    </div>
    <div class="wiz-section wiz-section-narrow">
      <div class="wiz-section-title">Méta</div>
      <div class="wiz-grid">
        ${wizField("Nom de l'audit", wizInput('w-meta-name', WS.meta.name, 'Audit …'))}
        ${wizField('Version', wizInput('w-meta-ver', WS.meta.version, '1.0'))}
      </div>
    </div>`;
}

function wizAddFilter() {
  wizReadFiltersForm();
  WS.filters.push({ field:'', source:'reference', values:'' });
  wizRenderFilters();
}

function wizRemoveFilter(i) {
  wizReadFiltersForm();
  WS.filters.splice(i,1);
  wizRenderFilters();
}

function wizReadFiltersForm() {
  WS.filters.forEach((f, i) => {
    const ff = document.getElementById('w-ff-'+i);
    const fs = document.getElementById('w-fs-'+i);
    const fv = document.getElementById('w-fv-'+i);
    if (ff) f.field  = ff.value;
    if (fs) f.source = fs.value;
    if (fv) f.values = fv.value;
  });
  const mdp = document.getElementById('w-rp-mdp');
  const sm  = document.getElementById('w-rp-sm');
  const mn  = document.getElementById('w-meta-name');
  const mv  = document.getElementById('w-meta-ver');
  if (mdp) WS.report.max_diff_preview = Number(mdp.value)||500;
  if (sm)  WS.report.show_matching    = sm.checked;
  if (mn)  WS.meta.name    = mn.value;
  if (mv)  WS.meta.version = mv.value;
}
