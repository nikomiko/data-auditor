// ═══════════════════════════════════════════════════════════
//  VERSION
// ═══════════════════════════════════════════════════════════
const UI_VERSION = '3.29.0';

(async function checkVersion() {
  try {
    const data = await fetch('/api/version').then(r => r.json());
    const srv  = data.version || '?';
    const badge = document.getElementById('version-mismatch');
    const ver   = document.getElementById('logo-ver');
    if (ver) ver.textContent = `v${srv}`;
    if (srv !== UI_VERSION && badge) {
      badge.textContent = `⚠ UI v${UI_VERSION} ≠ serveur v${srv}`;
      badge.title = `L'interface (v${UI_VERSION}) ne correspond pas au serveur (v${srv}). Rechargez la page après redémarrage.`;
      badge.style.display = '';
    }
  } catch (_) { /* serveur inaccessible au chargement */ }
})();

// ── Surveillance serveur (ping toutes les 15s) ─────────────
(function _startServerWatch() {
  let _offline = false;
  const _badge = () => document.getElementById('server-offline');
  setInterval(async () => {
    try {
      await fetch('/api/version', { cache: 'no-store' });
      if (_offline) { _offline = false; const b = _badge(); if (b) b.style.display = 'none'; }
    } catch(_) {
      if (!_offline) { _offline = true; const b = _badge(); if (b) b.style.display = 'flex'; }
    }
  }, 15000);
})();

// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let allResults     = [];      // utilisé uniquement pour les entrées historique
let lastSummary    = {};
let lastConfig     = {};
let currentToken   = null;
let _ctxKey        = null;
let refLabel       = '';
let tgtLabel       = '';
let activeFilters    = new Set(['BOTH']);
let activeRuleFilters = null;
let ruleFilterLogic  = 'OR';   // 'OR' | 'AND'
let filterText     = '';
let sortCol        = null;   // 'key'|'type'|'rule'|'ref'|'tgt'
let sortDir        = 1;      // 1=asc, -1=desc
let dsActiveSide   = 'reference'; // côté actif dans l'étape Datasets : 'reference' | 'target'

// Pagination serveur
let _pageNum   = 1;
let _pageSize  = 100;
let _pageTot   = 0;
let _pagePages = 1;

// Colonnes supplémentaires
let extraRefCols  = [];  // sélection ref (pour API)
let extraTgtCols  = [];  // sélection tgt (pour API)
let _extraColOrder = []; // [{side:'ref'|'tgt', col:string}] — ordre d'affichage mixte

// Compteurs live pendant streaming SSE
let _liveOA = 0, _liveOB = 0;
let yamlFilename   = 'config.yaml';
let yamlOriginal   = '';
let yamlFileHandle = null;  // File System Access API handle (Chrome/Edge)
let wfUnlocked = 1;    // max step accessible (0=Config, 1=Ref toujours accessible, …)
let wfCurrentStep = 0; // step actuellement affiché

// ═══════════════════════════════════════════════════════════
//  FILES
// ═══════════════════════════════════════════════════════════
let fileRef = null, fileTgt = null;
const TEXT_EXTS = new Set(['csv','txt','dat','json','jsonl']);

function isBinary(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return !TEXT_EXTS.has(ext);
}

// Lecture d'un fichier texte : UTF-8 strict en premier, fallback windows-1252
async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch(e) {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// ═══════════════════════════════════════════════════════════
//  WORKFLOW NAVIGATION
// ═══════════════════════════════════════════════════════════
function updateSourceLabels() {
  const rL = refLabel || 'Référence';
  const tL = tgtLabel || 'Cible';
  const e = id => document.getElementById(id);
  if (e('lbl-ref'))       e('lbl-ref').textContent       = refLabel || '';
  if (e('lbl-tgt'))       e('lbl-tgt').textContent       = tgtLabel || '';
  if (e('ds-lbl-ref'))    e('ds-lbl-ref').textContent    = refLabel || 'Source A';
  if (e('ds-lbl-tgt'))    e('ds-lbl-tgt').textContent    = tgtLabel || 'Cible B';
  if (e('nav-lbl-tgt'))   e('nav-lbl-tgt').textContent   = tL;
  if (e('nav-lbl-ref'))   e('nav-lbl-ref').textContent   = rL;
  if (e('nav-lbl-tgt2'))  e('nav-lbl-tgt2').textContent  = tL;
  if (e('ctx-title-ref')) e('ctx-title-ref').textContent = rL;
  if (e('ctx-title-tgt')) e('ctx-title-tgt').textContent = tL;
  if (!WS.sources.reference.label) WS.sources.reference.label = refLabel;
  if (!WS.sources.target.label)    WS.sources.target.label    = tgtLabel;
}

function swapSources() {
  // Sauvegarder l'état du côté actif avant le swap
  if (wfCurrentStep === 1) wizReadSourceForm(dsActiveSide);

  // Swap données WS
  const tmp = WS.sources.reference;
  WS.sources.reference = WS.sources.target;
  WS.sources.target    = tmp;

  // Swap fichiers
  const tmpFile = fileRef; fileRef = fileTgt; fileTgt = tmpFile;

  // Swap labels
  const tmpLabel = refLabel; refLabel = tgtLabel; tgtLabel = tmpLabel;

  // Swap inputs label
  const inpRef = document.getElementById('inp-ref-label');
  const inpTgt = document.getElementById('inp-tgt-label');
  if (inpRef && inpTgt) {
    const tv = inpRef.value; inpRef.value = inpTgt.value; inpTgt.value = tv;
  }

  // Swap état visuel des drop zones
  const _swapEl = (idA, idB, prop) => {
    const a = document.getElementById(idA), b = document.getElementById(idB);
    if (!a || !b) return;
    const tv = a[prop]; a[prop] = b[prop]; b[prop] = tv;
  };
  const _swapDisplay = (idA, idB) => {
    const a = document.getElementById(idA), b = document.getElementById(idB);
    if (!a || !b) return;
    const tv = a.style.display; a.style.display = b.style.display; b.style.display = tv;
  };
  const _swapClass = (idA, idB, cls) => {
    const a = document.getElementById(idA), b = document.getElementById(idB);
    if (!a || !b) return;
    const ha = a.classList.contains(cls), hb = b.classList.contains(cls);
    a.classList.toggle(cls, hb); b.classList.toggle(cls, ha);
  };

  _swapEl('dz-ref-label', 'dz-tgt-label', 'textContent');
  _swapEl('dz-ref-sub',   'dz-tgt-sub',   'textContent');
  _swapEl('cfg-ref-pill', 'cfg-tgt-pill',  'textContent');
  _swapClass('dz-ref', 'dz-tgt', 'loaded');
  _swapClass('dz-ref', 'dz-tgt', 'hinted');
  _swapDisplay('eye-ref', 'eye-tgt');
  _swapDisplay('val-ref', 'val-tgt');
  _swapDisplay('val-badge-ref', 'val-badge-tgt');

  // Swap contenu des badges de validation
  const vbr = document.getElementById('val-badge-ref');
  const vbt = document.getElementById('val-badge-tgt');
  if (vbr && vbt) {
    const th = vbr.innerHTML; vbr.innerHTML = vbt.innerHTML; vbt.innerHTML = th;
    const tc = vbr.className; vbr.className = vbt.className; vbt.className = tc;
  }

  updateSourceLabels();
  // Re-render le panneau de config directement (sans re-lire le formulaire via dsActivate)
  const _cfg = document.getElementById('wfv-1-src');
  if (_cfg) {
    const _label = dsActiveSide === 'reference'
      ? 'Source A — ' + (refLabel || 'Référence')
      : 'Source B — ' + (tgtLabel || 'Cible');
    wizRenderSource(_cfg, dsActiveSide, _label);
  }
}

function dsActivate(side) {
  if (wfCurrentStep === 1) wizReadSourceForm(dsActiveSide); // sauvegarde le côté courant avant de changer
  dsActiveSide = side;
  const halfRef = document.getElementById('ds-half-ref');
  const halfTgt = document.getElementById('ds-half-tgt');
  if (halfRef) halfRef.classList.toggle('active', side === 'reference');
  if (halfTgt) halfTgt.classList.toggle('active', side === 'target');
  const cfg = document.getElementById('wfv-1-src');
  if (cfg) { cfg.classList.toggle('cfg-ref', side === 'reference'); cfg.classList.toggle('cfg-tgt', side === 'target'); }
  const label = side === 'reference'
    ? 'Source A — ' + (refLabel || 'Référence')
    : 'Source B — ' + (tgtLabel || 'Cible');
  wizRenderSource(document.getElementById('wfv-1-src'), side, label);
}

function onEnterDatasets() {
  const lblRef = document.getElementById('ds-lbl-ref');
  const lblTgt = document.getElementById('ds-lbl-tgt');
  if (lblRef) lblRef.textContent = refLabel || 'Source A';
  if (lblTgt) lblTgt.textContent = tgtLabel || 'Cible B';
  // Synchroniser les inputs de label
  const inpRef = document.getElementById('inp-ref-label');
  const inpTgt = document.getElementById('inp-tgt-label');
  if (inpRef && !inpRef.value && refLabel) inpRef.value = refLabel;
  if (inpTgt && !inpTgt.value && tgtLabel) inpTgt.value = tgtLabel;
  dsActivate(dsActiveSide || 'reference');
}

function goWFStep(n) {
  if (n > wfUnlocked && n < 6) return;
  // Sauvegarder l'étape courante avant de partir
  _saveCurrentWFStep();
  wfCurrentStep = n;
  document.querySelectorAll('.wf-view').forEach((el, i) => el.classList.toggle('active', i === n));
  updateWFSteps(n);
  // Actions à l'entrée d'une étape
  if (n === 1) onEnterDatasets();
  else if (n === 2) wizRenderJoin();
  else if (n === 3) wizRenderRules();
  else if (n === 4) wizRenderFilters();
  updateGlobalNav(n);
}

function updateGlobalNav(n) {
  const prev    = document.getElementById('gnav-prev');
  const next    = document.getElementById('gnav-next');
  const run     = document.getElementById('gnav-run');
  const navBar  = document.getElementById('global-nav-bar');
  const exports = document.getElementById('gnav-exports');
  if (!prev) return;

  // Masquer sur Historique (step 6)
  navBar.style.display = (n === 6) ? 'none' : '';

  // Bouton Précédent : invisible à l'étape 0
  prev.style.visibility = (n === 0) ? 'hidden' : '';

  // Badges fichiers et nom YAML : masqués en résultats
  const yamlNameEl  = document.getElementById('yaml-config-name');
  const pillRef     = document.getElementById('cfg-ref-pill');
  const pillTgt     = document.getElementById('cfg-tgt-pill');
  const onResults   = (n === 5);
  if (yamlNameEl) yamlNameEl.style.display = onResults ? 'none' : '';
  if (pillRef)    pillRef.style.display    = onResults ? 'none' : '';
  if (pillTgt)    pillTgt.style.display    = onResults ? 'none' : '';
  // audit-name-display : plus utilisé dans la nav
  const auditNameEl = document.getElementById('audit-name-display');
  if (auditNameEl)  auditNameEl.style.display = 'none';
  // Titre de l'audit sur la page résultats (centré, gros)
  const titleEl = document.getElementById('results-title');
  if (titleEl) {
    const name = WS.meta.name || '';
    titleEl.textContent = name;
    titleEl.style.display = (onResults && name) ? '' : 'none';
  }

  // Exports : visibles uniquement à l'étape ⑤
  if (exports) exports.style.display = (n === 5) ? 'flex' : 'none';

  // Bouton Valider (uniquement étape ④)
  const validate = document.getElementById('gnav-validate');
  if (validate) validate.style.display = (n === 4) ? '' : 'none';

  // Bouton Suivant vs Lancer l'audit
  if (n === 4) {
    next.style.display = 'none';
    run.style.display  = '';
  } else if (n >= 5) {
    next.style.display = 'none';
    run.style.display  = 'none';
  } else {
    next.style.display = '';
    run.style.display  = 'none';
    // Disabled si les deux fichiers ne sont pas chargés (étape ①)
    if (n === 1) next.disabled = !(fileRef && fileTgt);
    else         next.disabled = false;
  }
}

function globalPrev() {
  const n = wfCurrentStep;
  if (n <= 0) return;
  goWFStep(n - 1);
}

function globalNext() {
  const n = wfCurrentStep;
  if (n === 0)      goWFStep(1);
  else if (n === 1) { if (fileRef && fileTgt) saveStepAndGo(2); }
  else if (n === 2) saveStepAndGo(3);
  else if (n === 3) saveStepAndGo(4);
  else if (n === 4) saveStepAndGo(5);
}

function _saveCurrentWFStep() {
  if (wfCurrentStep === 1) wizReadSourceForm(dsActiveSide);
  else if (wfCurrentStep === 2) wizReadJoinForm();
  else if (wfCurrentStep === 3) wizReadRulesForm();
  else if (wfCurrentStep === 4) wizReadFiltersForm();
}

function saveStepAndGo(n) {
  _saveCurrentWFStep();
  const err = wizValidateStep(wfCurrentStep);
  if (err) { wizShowErr(err); return; }
  if (wfUnlocked < n) wfUnlocked = n;
  goWFStep(n);
}


function updateWFSteps(activeStep) {
  if (activeStep === undefined) {
    activeStep = [...document.querySelectorAll('.wf-view')].findIndex(el => el.classList.contains('active'));
  }
  for (let i = 0; i <= 5; i++) {
    const btn = document.getElementById('wfs-' + i);
    if (!btn) continue;
    btn.classList.remove('active', 'done');
    btn.disabled = (i > wfUnlocked);
    if (i === activeStep)                       btn.classList.add('active');
    else if (i < activeStep && i <= wfUnlocked) btn.classList.add('done');
  }
  const tabHist = document.getElementById('tab-history');
  if (tabHist) tabHist.classList.toggle('active', activeStep === 6);
}

// ═══════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════
function esc(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showErr(msg) { const e=document.getElementById('err'); e.textContent='⚠ '+msg; e.classList.add('show'); }
function hideErr()    { document.getElementById('err').classList.remove('show'); }
function fmtTs(iso)   {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR') + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}

// ═══════════════════════════════════════════════════════════
//  PERSISTANCE SESSION (localStorage)
// ═══════════════════════════════════════════════════════════
const LS_KEY = 'da_session_v1';

function sessionSave() {
  try {
    const yaml = document.getElementById('yaml')?.value || '';
    localStorage.setItem(LS_KEY, JSON.stringify({
      yaml,
      yamlFilename,
      refName: fileRef?.name  || '',
      tgtName: fileTgt?.name  || '',
    }));
  } catch(_) {}
}

function sessionRestore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);

    // Restaurer le YAML et appliquer la config au wizard
    if (s.yaml && s.yaml.trim()) {
      document.getElementById('yaml').value = s.yaml;
      yamlFilename = s.yamlFilename || 'config.yaml';
      applyYamlContent(s.yaml, yamlFilename);
    }

    // Afficher les noms de fichiers comme indications dans les drop-zones
    if (s.refName) {
      document.getElementById('dz-ref-label').textContent = s.refName;
      document.getElementById('dz-ref-sub').textContent   = 'Dernier fichier utilisé — cliquez pour recharger';
    }
    if (s.tgtName) {
      document.getElementById('dz-tgt-label').textContent = s.tgtName;
      document.getElementById('dz-tgt-sub').textContent   = 'Dernier fichier utilisé — cliquez pour recharger';
    }
  } catch(_) {}
}

function resetAll() {
  if (!confirm('Réinitialiser toute la configuration et les fichiers chargés ?')) return;

  // État
  fileRef = null; fileTgt = null;
  allResults = []; lastSummary = {}; lastConfig = {}; currentToken = null;
  refLabel = ''; tgtLabel = '';
  filterText = ''; sortCol = null; sortDir = 1;
  wfUnlocked = 1; wfCurrentStep = 0; dsActiveSide = 'reference';
  activeFilters = new Set(['BOTH']);
  activeRuleFilters = null;
  ruleFilterLogic = 'OR';
  _pageNum = 1; _pageSize = 100; _pageTot = 0; _pagePages = 1;
  extraRefCols = []; extraTgtCols = []; _extraColOrder = [];
  _liveOA = 0; _liveOB = 0;

  // YAML
  const yamlEl = document.getElementById('yaml');
  if (yamlEl) yamlEl.value = '';
  yamlFilename = 'config.yaml'; yamlOriginal = ''; yamlFileHandle = null;
  updateSaveBtn();

  // Drop zone référence
  document.getElementById('dz-ref').classList.remove('loaded', 'hinted');
  document.getElementById('dz-ref-label').textContent = 'Glissez votre fichier ici';
  document.getElementById('dz-ref-sub').textContent   = 'ou cliquez — CSV, TXT, JSON, JSONL';
  document.getElementById('eye-ref').style.display    = 'none';
  document.getElementById('val-ref').style.display    = 'none';
  document.getElementById('val-badge-ref').style.display = 'none';
  document.getElementById('cfg-ref-pill').textContent = '';
  document.getElementById('f-ref').value = '';

  // Drop zone cible
  document.getElementById('dz-tgt').classList.remove('loaded', 'hinted');
  document.getElementById('dz-tgt-label').textContent = 'Glissez votre fichier ici';
  document.getElementById('dz-tgt-sub').textContent   = 'ou cliquez — CSV, TXT, JSON, JSONL';
  document.getElementById('eye-tgt').style.display    = 'none';
  document.getElementById('val-tgt').style.display    = 'none';
  document.getElementById('val-badge-tgt').style.display = 'none';
  document.getElementById('cfg-tgt-pill').textContent = '';
  document.getElementById('f-tgt').value = '';

  // Drop zone YAML
  document.getElementById('dz-yaml').classList.remove('loaded');
  document.getElementById('dz-yaml-label').textContent = 'Glissez votre fichier YAML ici';
  document.getElementById('dz-yaml-sub').textContent   = 'ou cliquez pour parcourir — .yaml, .yml';
  const yamlSum = document.getElementById('yaml-loaded-summary');
  if (yamlSum) yamlSum.style.display = 'none';
  const btnRld = document.getElementById('btn-reload-yaml');
  if (btnRld) btnRld.style.display = 'none';

  // Labels sources
  document.getElementById('inp-ref-label').value = '';
  document.getElementById('inp-tgt-label').value = '';
  updateSourceLabels();

  // Session locale
  try { localStorage.removeItem(LS_KEY); } catch(_) {}

  // goWFStep appelle _saveCurrentWFStep() qui relirait le DOM → on force wfCurrentStep à 0
  // avant pour court-circuiter la sauvegarde, puis on réinitialise WS après le navigate
  wfCurrentStep = 0;
  goWFStep(0);
  updateGlobalNav(0);

  // Réinitialiser WS APRÈS goWFStep (qui peut relire le DOM via _saveCurrentWFStep)
  WS.sources.reference = wizSrcDefault();
  WS.sources.target    = wizSrcDefault();
  WS.join.keys  = [];
  WS.rules      = [];
  WS.filters    = [];
  WS.report     = { show_matching: false, max_diff_preview: 500 };
  WS.meta       = { name: '', version: '', run_label: '', description: '' };

  // Vider le rendu de la zone config contextuelle
  const src1 = document.getElementById('wfv-1-src');
  if (src1) src1.innerHTML = '<p style="color:var(--muted);font-size:.78rem;text-align:center;padding:2rem">Cliquez sur une source pour configurer ses colonnes.</p>';
  // Réinitialiser l'état visuel des moitiés
  const halfRef = document.getElementById('ds-half-ref');
  const halfTgt = document.getElementById('ds-half-tgt');
  if (halfRef) halfRef.classList.add('active');
  if (halfTgt) halfTgt.classList.remove('active');
}
