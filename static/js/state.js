// ═══════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════
let allResults     = [];
let lastSummary    = {};
let lastConfig     = {};
let currentToken   = null;
let _ctxKey        = null;
let refLabel       = '';
let tgtLabel       = '';
let activeFilters  = new Set(['ORPHELIN_A','ORPHELIN_B']);  // KO filtré par rule uniquement
let activeRuleFilters = null;
let filterText     = '';
let sortCol        = null;   // 'key'|'type'|'rule'|'ref'|'tgt'
let sortDir        = 1;      // 1=asc, -1=desc
let yamlFilename   = 'config.yaml';
let yamlOriginal   = '';
let yamlFileHandle = null;  // File System Access API handle (Chrome/Edge)
let wfUnlocked = 1;    // max step accessible (0=Config, 1=Ref toujours accessible, …)
let wfCurrentStep = 0; // step actuellement affiché

// ═══════════════════════════════════════════════════════════
//  FILES
// ═══════════════════════════════════════════════════════════
let fileRef = null, fileTgt = null;
const TEXT_EXTS = new Set(['csv','txt','dat','json']);

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
  if (e('lbl-ref'))       e('lbl-ref').textContent       = rL;
  if (e('lbl-tgt'))       e('lbl-tgt').textContent       = tL;
  if (e('nav-lbl-tgt'))   e('nav-lbl-tgt').textContent   = tL;
  if (e('nav-lbl-ref'))   e('nav-lbl-ref').textContent   = rL;
  if (e('nav-lbl-ref0'))  e('nav-lbl-ref0').textContent  = rL;
  if (e('nav-lbl-tgt2'))  e('nav-lbl-tgt2').textContent  = tL;
  if (e('ctx-title-ref')) e('ctx-title-ref').textContent = rL;
  if (e('ctx-title-tgt')) e('ctx-title-tgt').textContent = tL;
  if (!WS.sources.reference.label) WS.sources.reference.label = refLabel;
  if (!WS.sources.target.label)    WS.sources.target.label    = tgtLabel;
}

function goWFStep(n) {
  if (n > wfUnlocked && n < 7) return;
  // Sauvegarder l'étape courante avant de partir
  _saveCurrentWFStep();
  wfCurrentStep = n;
  document.querySelectorAll('.wf-view').forEach((el, i) => el.classList.toggle('active', i === n));
  updateWFSteps(n);
  // Actions à l'entrée d'une étape
  if (n === 1) onEnterRef();
  else if (n === 2) onEnterTgt();
  else if (n === 3) wizRenderJoin();
  else if (n === 4) wizRenderRules();
  else if (n === 5) wizRenderFilters();
}

function _saveCurrentWFStep() {
  if (wfCurrentStep === 1) wizReadSourceForm('reference');
  else if (wfCurrentStep === 2) wizReadSourceForm('target');
  else if (wfCurrentStep === 3) wizReadJoinForm();
  else if (wfCurrentStep === 4) wizReadRulesForm();
  else if (wfCurrentStep === 5) wizReadFiltersForm();
}

function saveStepAndGo(n) {
  _saveCurrentWFStep();
  const err = wizValidateStep(wfCurrentStep);
  if (err) { wizShowErr(err); return; }
  if (wfUnlocked < n) wfUnlocked = n;
  goWFStep(n);
}

function onEnterRef() {
  if (refLabel && !WS.sources.reference.label) WS.sources.reference.label = refLabel;
  wizRenderSource(document.getElementById('wfv-1-src'), 'reference',
    'Source A — ' + (refLabel || 'Référence'));
}

function onEnterTgt() {
  if (tgtLabel && !WS.sources.target.label) WS.sources.target.label = tgtLabel;
  wizRenderSource(document.getElementById('wfv-2-src'), 'target',
    'Source B — ' + (tgtLabel || 'Cible'));
}

function updateWFSteps(activeStep) {
  if (activeStep === undefined) {
    activeStep = [...document.querySelectorAll('.wf-view')].findIndex(el => el.classList.contains('active'));
  }
  for (let i = 0; i <= 6; i++) {
    const btn = document.getElementById('wfs-' + i);
    if (!btn) continue;
    btn.classList.remove('active', 'done');
    btn.disabled = (i > wfUnlocked);
    if (i === activeStep)                       btn.classList.add('active');
    else if (i < activeStep && i <= wfUnlocked) btn.classList.add('done');
  }
  const tabHist = document.getElementById('tab-history');
  if (tabHist) tabHist.classList.toggle('active', activeStep === 7);
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
  wfUnlocked = 1; wfCurrentStep = 0;
  activeFilters = new Set(['ORPHELIN_A','ORPHELIN_B']);
  activeRuleFilters = null;

  // YAML
  const yamlEl = document.getElementById('yaml');
  if (yamlEl) yamlEl.value = '';
  yamlFilename = 'config.yaml'; yamlOriginal = ''; yamlFileHandle = null;

  // Drop zone référence
  document.getElementById('dz-ref').classList.remove('loaded');
  document.getElementById('dz-ref-label').textContent = 'Glissez votre fichier ici';
  document.getElementById('dz-ref-sub').textContent   = 'ou cliquez pour parcourir — CSV, TXT, DAT, JSON, XLSX';
  document.getElementById('eye-ref').style.display    = 'none';
  document.getElementById('val-ref').style.display    = 'none';
  document.getElementById('val-badge-ref').style.display = 'none';
  document.getElementById('btn-ref-next').disabled    = true;
  document.getElementById('cfg-ref-pill').textContent = '';
  document.getElementById('f-ref').value = '';

  // Drop zone cible
  document.getElementById('dz-tgt').classList.remove('loaded');
  document.getElementById('dz-tgt-label').textContent = 'Glissez votre fichier ici';
  document.getElementById('dz-tgt-sub').textContent   = 'ou cliquez pour parcourir — CSV, TXT, DAT, JSON, XLSX';
  document.getElementById('eye-tgt').style.display    = 'none';
  document.getElementById('val-tgt').style.display    = 'none';
  document.getElementById('val-badge-tgt').style.display = 'none';
  document.getElementById('btn-tgt-next').disabled    = true;
  document.getElementById('cfg-tgt-pill').textContent = '';
  document.getElementById('f-tgt').value = '';

  // Drop zone YAML
  document.getElementById('dz-yaml').classList.remove('loaded');
  document.getElementById('dz-yaml-label').textContent = 'Glissez votre fichier YAML ici';
  document.getElementById('dz-yaml-sub').textContent   = 'ou cliquez pour parcourir — .yaml, .yml';
  const yamlSum = document.getElementById('yaml-loaded-summary');
  if (yamlSum) yamlSum.style.display = 'none';

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

  // Réinitialiser WS APRÈS goWFStep (qui peut relire le DOM via _saveCurrentWFStep)
  wizSrcDefault();

  // Vider le rendu des étapes source pour ne pas afficher de contenu résiduel
  const src1 = document.getElementById('wfv-1-src');
  const src2 = document.getElementById('wfv-2-src');
  const placeholder = '<p style="color:var(--muted);font-size:.78rem;text-align:center;padding:2rem">Chargez un fichier ou configurez la source manuellement ci-dessous une fois le fichier chargé.</p>';
  if (src1) src1.innerHTML = placeholder;
  if (src2) src2.innerHTML = placeholder;
}
