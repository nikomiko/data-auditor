// ═══════════════════════════════════════════════════════════
//  RUN AUDIT
// ═══════════════════════════════════════════════════════════
async function runAudit() {
  hideErr();
  // S'assurer que le YAML est à jour depuis le wizard
  _saveCurrentWFStep();
  document.getElementById('yaml').value = wizBuildYaml();
  const yamlText = document.getElementById('yaml').value.trim();
  if (!fileRef)  { showErr('Chargez le fichier de référence (Source A).'); return; }
  if (!fileTgt)  { showErr('Chargez le fichier cible (Source B).'); return; }
  if (!yamlText) { showErr('La configuration YAML est vide.'); return; }
  sessionSave();

  const RUN_BTN_HTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Lancer l\'audit';
  const btn = document.getElementById('gnav-run');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin"></div> Envoi…';

  document.getElementById('results-area').style.display = 'none';
  document.getElementById('trunc').style.display = 'none';
  allResults = [];
  filterText = ''; sortCol = null; sortDir = 1;
  // Réinitialiser les filtres pour chaque nouvel audit
  activeFilters = new Set(['ORPHELIN_A', 'ORPHELIN_B']);
  activeRuleFilters = null;
  document.querySelectorAll('#filter-bar .chip[data-kind="type"]').forEach(btn => btn.classList.add('on'));
  document.querySelectorAll('#filter-bar .chip[data-kind="ruletype"]').forEach(btn => btn.classList.add('on'));
  document.getElementById('filter-dynamic').innerHTML = '';
  const ftEl = document.getElementById('filter-text');
  if (ftEl) ftEl.value = '';
  ['key','type','rule','ref','tgt'].forEach(c => {
    const th = document.getElementById('si-' + c)?.parentElement;
    const ic = document.getElementById('si-' + c);
    if (th) { th.classList.remove('sort-asc','sort-desc'); }
    if (ic) ic.textContent = '↕';
  });
  document.getElementById('tbody').innerHTML = '';

  const fd = new FormData();
  fd.append('file_ref', fileRef);
  fd.append('file_tgt', fileTgt);
  fd.append('config_yaml', yamlText);

  // Toujours basculer vers la page résultats (step 6) dès le lancement
  if (wfUnlocked < 6) wfUnlocked = 6;
  goWFStep(6);
  showProgress(true);
  updateProgress({ pct: 0, done: 0, total: 0, step: 'Envoi de la configuration…' });

  try {
    const resp = await fetch('/api/audit', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      showErr(data.error || 'Erreur serveur.');
      showProgress(false);
      btn.innerHTML = RUN_BTN_HTML;
      btn.disabled = false;
      return;
    }

    currentToken = data.token;
    updateProgress({ pct: 0, done: 0, total: 0, step: 'Démarrage…' });

    // Afficher le tableau de suite (rempli au fil des events)
    document.getElementById('results-area').style.display = 'flex';
    document.getElementById('btn-csv').disabled  = true;
    document.getElementById('btn-html').disabled = true;
    document.getElementById('btn-xlsx').disabled = true;

    listenSSE(currentToken);

    btn.innerHTML = RUN_BTN_HTML;
    btn.disabled = false;

  } catch(e) {
    showErr('Erreur réseau : ' + e.message);
    showProgress(false);
    btn.innerHTML = RUN_BTN_HTML;
    btn.disabled = false;
  }
}

// ═══════════════════════════════════════════════════════════
//  SSE LISTENER
// ═══════════════════════════════════════════════════════════
function listenSSE(token) {
  const es = new EventSource(`/api/stream/${token}`);
  let   config = null;

  try { config = jsyaml.load(document.getElementById('yaml').value); } catch(_) {}

  es.onmessage = function(e) {
    const ev = JSON.parse(e.data);

    if (ev.event === 'progress') {
      updateProgress(ev);

    } else if (ev.event === 'filter_counts') {
      // Mise à jour des compteurs ref/cible après filtrage serveur
      document.getElementById('s-ref').textContent = ev.ref_count.toLocaleString('fr-FR');
      document.getElementById('s-tgt').textContent = ev.tgt_count.toLocaleString('fr-FR');

    } else if (ev.event === 'result') {
      const max = config?.report?.max_diff_preview || 500;
      if (allResults.length < max) {
        allResults.push(ev);
      }
      // Mise à jour compteurs live
      updateLiveCounts();

    } else if (ev.event === 'summary') {
      lastSummary = ev;
      lastConfig  = config || {};
      document.getElementById('s-ref').textContent = ev.total_reference;
      document.getElementById('s-tgt').textContent = ev.total_cible;
      document.getElementById('s-oa').textContent  = ev.orphelins_a;
      document.getElementById('s-ob').textContent  = ev.orphelins_b;
      document.getElementById('s-dv').textContent  = ev.divergents;
      updateChipCounts();
      buildRuleFilterBar(ev, config);

    } else if (ev.event === 'done') {
      updateProgress({ pct: 100, done: ev.total_results, total: ev.total_results,
                       step: `Terminé — ${ev.total_results.toLocaleString('fr-FR')} résultats` });
      document.getElementById('prog-bar').classList.remove('indeterminate');
      document.getElementById('prog-bar').style.width = '100%';

      // Rendre le tableau (allResults est complet)
      rebuildTable();

      // Activer exports
      document.getElementById('btn-csv').disabled  = false;
      document.getElementById('btn-html').disabled = false;
      document.getElementById('btn-xlsx').disabled = false;

      // Débloquer l'étape résultats
      wfUnlocked = 6;
      updateWFSteps();

      // Avertissement si troncature
      const max = config?.report?.max_diff_preview || 500;
      if (ev.total_results > max) {
        const t = document.getElementById('trunc');
        t.style.display = 'block';
        t.textContent = `Affichage limité à ${allResults.length} lignes sur ${ev.total_results.toLocaleString('fr-FR')}. Exportez pour la liste complète.`;
      }
      es.close();

    } else if (ev.event === 'error') {
      showErr(ev.message);
      showProgress(false);
      document.getElementById('gnav-run').disabled = false;
      document.getElementById('gnav-run').innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Lancer l\'audit';
      es.close();
    }
  };

  es.onerror = function() {
    es.close();
  };
}

// ═══════════════════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════════════════
async function loadHistory() {
  const c = document.getElementById('history-list');
  c.innerHTML = '<div class="hist-empty">Chargement…</div>';
  try {
    const data = await fetch('/api/history').then(r => r.json());
    if (!data.length) { c.innerHTML = '<div class="hist-empty">Aucun audit historisé.</div>'; return; }
    const items = data.map(h => `
      <div class="hist-item">
        <div class="hist-main" onclick="loadHistoryEntry('${esc(h.filename)}')">
          <span class="hist-ts">${fmtTs(h.timestamp)}</span>
          <span class="hist-name">${esc(h.audit_name)}</span>
          <div class="hist-stats">
            <span class="hs a">A:${h.summary.orphelins_a||0}</span>
            <span class="hs b">B:${h.summary.orphelins_b||0}</span>
            <span class="hs d">Δ:${h.summary.divergents||0}</span>
          </div>
        </div>
        <button class="hist-del" title="Supprimer" onclick="deleteHistoryEntry(event,'${esc(h.filename)}')">🗑</button>
      </div>`).join('');
    const purgeBtn = `<div class="hist-purge-bar"><button class="btn-xs btn-danger" onclick="purgeAllHistory()">🗑 Tout supprimer</button></div>`;
    c.innerHTML = purgeBtn + items;
  } catch(e) { c.innerHTML = '<div class="hist-empty">Erreur de chargement.</div>'; }
}

async function deleteHistoryEntry(ev, filename) {
  ev.stopPropagation();
  if (!confirm(`Supprimer cet audit ?`)) return;
  await fetch(`/api/history/${encodeURIComponent(filename)}`, {method:'DELETE'});
  loadHistory();
}

async function purgeAllHistory() {
  if (!confirm('Supprimer tout l\'historique ?')) return;
  await fetch('/api/history', {method:'DELETE'});
  loadHistory();
}

async function loadHistoryEntry(filename) {
  try {
    const data = await fetch(`/api/history/${filename}`).then(r => r.json());
    wfUnlocked = 6;
    goWFStep(6);
    allResults  = data.results || [];
    lastSummary = data.summary || {};
    lastConfig  = data.config  || {};
    currentToken = null;

    document.getElementById('s-ref').textContent = lastSummary.total_reference || '—';
    document.getElementById('s-tgt').textContent = lastSummary.total_cible     || '—';
    document.getElementById('s-oa').textContent  = lastSummary.orphelins_a;
    document.getElementById('s-ob').textContent  = lastSummary.orphelins_b;
    document.getElementById('s-dv').textContent  = lastSummary.divergents;
    updateChipCounts();
    rebuildTable();
    showProgress(false);
    document.getElementById('results-area').style.display  = 'flex';
    document.getElementById('btn-csv').disabled  = true;
    document.getElementById('btn-html').disabled = false;
    document.getElementById('btn-xlsx').disabled = true;

    if (data.truncated) {
      const t = document.getElementById('trunc');
      t.style.display  = 'block';
      t.textContent    = `Affichage limité à ${allResults.length} lignes sur ${data.total_results}.`;
    }
  } catch(e) { showErr('Impossible de charger l\'audit : ' + e.message); }
}
