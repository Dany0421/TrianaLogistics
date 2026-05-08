// ── Supplier modal local state ──
let editingSupplierIdx = null;
let pendingSupplierCategories = [];
let pendingSupplierBrands = [];
let rfqLang = 'pt';
/** Aligned with chk_quot_description_length (must not reuse api.js const name — global scope / concat builds) */
const MAX_QUOTATION_LINE_DESC = 2000;

// ── Price Anomaly Detection ──
async function checkPriceAnomalies(items) {
  const partNums = items.map(i => i.raw_part_number).filter(Boolean);
  const descs = items.filter(i => !i.raw_part_number).map(i => i.raw_description);
  let history = [];
  try { history = await API.getPriceHistoryBatch(partNums, descs); } catch(_) { return {}; }
  const histMap = {};
  history.forEach(h => {
    const key = h.raw_part_number
      ? h.raw_part_number.trim().toLowerCase() + ':' + (h.currency||'MZN')
      : h.raw_description.trim().toLowerCase().slice(0,40) + ':' + (h.currency||'MZN');
    if (!histMap[key]) histMap[key] = [];
    histMap[key].push(Number(h.price));
  });
  function median(arr) {
    const s = [...arr].sort((a,b) => a-b);
    const m = Math.floor(s.length/2);
    return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
  }
  const anomalies = {};
  items.forEach((item, idx) => {
    const k = item.raw_part_number
      ? item.raw_part_number.trim().toLowerCase() + ':' + (item.currency||'MZN')
      : item.raw_description.trim().toLowerCase().slice(0,40) + ':' + (item.currency||'MZN');
    const hist = histMap[k];
    if (!hist || hist.length < 3) return;
    const med = median(hist);
    if (!med || med <= 0) return;
    const price = Number(item.price);
    if (price > med * 3) anomalies[idx] = { type:'high', median:med, ratio:(price/med).toFixed(1) };
    else if (price < med / 3) anomalies[idx] = { type:'low', median:med, ratio:(med/price).toFixed(1) };
  });
  return anomalies;
}

// ── Supplier Suggestions ──
// Dismissed set is persisted to DB (processes.dismissed_suggestions) so it survives incognito/cross-browser.
let _dismissedSet = new Set();
function _syncDismissed() {
  try { _dismissedSet = new Set(Array.isArray(process?.dismissed_suggestions) ? process.dismissed_suggestions.map(n => n.trim().toLowerCase()) : []); }
  catch(_) { _dismissedSet = new Set(); }
}
function _dismissSugg(names) {
  names.forEach(n => _dismissedSet.add(n.trim().toLowerCase()));
  const arr = [..._dismissedSet];
  if (process) process.dismissed_suggestions = arr;
  API.saveDismissedSuggestions(processId, arr).catch(() => {});
}

function renderSupplierSuggestions() {
  const banner = document.getElementById('suggBanner');
  if (!banner) return;
  while (banner.firstChild) banner.removeChild(banner.firstChild);

  const bomCats = [...new Set(bomItems.map(b => b.category).filter(Boolean))];
  if (!bomCats.length || !globalSuppliersList.length) return;

  _syncDismissed();
  const addedNames = new Set(suppliers.map(s => s.name.trim().toLowerCase()));
  const dismissed = _dismissedSet;
  const _tok = str => (str||'').toLowerCase().replace(/\s+e\s+/g,'|').split(/[\/&,|]/).map(t=>t.trim()).filter(Boolean);
  const bomTokenSets = bomCats.map(c => new Set(_tok(c)));

  const suggestions = globalSuppliersList.filter(gs => {
    const norm = gs.name.trim().toLowerCase();
    if (addedNames.has(norm) || dismissed.has(norm)) return false;
    return (gs.categories || []).some(suppCat =>
      _tok(suppCat).some(t => bomTokenSets.some(bs => bs.has(t)))
    );
  });

  if (!suggestions.length) return;

  const header = document.createElement('div');
  header.className = 'sugg-banner-header';
  const title = document.createElement('span');
  title.textContent = 'Fornecedores sugeridos — categorias do BOM';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.appendChild(licon('x', 13));
  closeBtn.setAttribute('aria-label', 'Fechar');
  closeBtn.onclick = () => {
    _dismissSugg(suggestions.map(gs => gs.name));
    while (banner.firstChild) banner.removeChild(banner.firstChild);
  };
  header.appendChild(title);
  header.appendChild(closeBtn);

  const cards = document.createElement('div');
  cards.className = 'sugg-cards';

  suggestions.forEach(gs => {
    const matchedCats = (gs.categories || []).filter(suppCat =>
      _tok(suppCat).some(t => bomTokenSets.some(bs => bs.has(t)))
    );
    const card = document.createElement('div');
    card.className = 'sugg-card';

    const cardTop = document.createElement('div');
    cardTop.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:4px';

    const nameEl = document.createElement('div');
    nameEl.className = 'sugg-card-name';
    nameEl.textContent = gs.name;
    cardTop.appendChild(nameEl);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'btn btn-ghost btn-sm';
    dismissBtn.style.cssText = 'padding:1px 4px;opacity:.5;flex-shrink:0';
    dismissBtn.appendChild(licon('x', 11));
    dismissBtn.setAttribute('aria-label', 'Não mostrar');
    dismissBtn.onclick = () => { _dismissSugg([gs.name]); card.remove(); if (!cards.children.length) while (banner.firstChild) banner.removeChild(banner.firstChild); };
    cardTop.appendChild(dismissBtn);

    card.appendChild(cardTop);

    if (matchedCats.length) {
      const catsEl = document.createElement('div');
      catsEl.className = 'sugg-card-cats';
      matchedCats.forEach(c => {
        const chip = document.createElement('span');
        chip.className = 'sugg-cat-chip';
        chip.textContent = c;
        catsEl.appendChild(chip);
      });
      card.appendChild(catsEl);
    }

    if (gs.avg_response_hours > 0) {
      const badge = document.createElement('span');
      badge.className = 'resp-time-badge';
      badge.textContent = '~' + formatResponseTime(gs.avg_response_hours);
      card.appendChild(badge);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-ghost btn-sm';
    addBtn.textContent = '+ Adicionar';
    addBtn.style.marginTop = '2px';
    addBtn.onclick = () => openSupplierModal(null, { name: gs.name, email: gs.email || '', email_cc: gs.email_cc || '', categories: [...(gs.categories || [])] });
    card.appendChild(addBtn);

    cards.appendChild(card);
  });

  banner.className = 'sugg-banner';
  banner.appendChild(header);
  banner.appendChild(cards);
}

// ── Render Suppliers ──
function renderSuppliers() {
  document.getElementById('suppCount').textContent = `${suppliers.length} fornecedor${suppliers.length !== 1 ? 'es' : ''}`;
  const el = document.getElementById('suppliersContent');
  el.replaceChildren();
  if (!suppliers.length) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    empty.appendChild(document.createTextNode('Sem fornecedores.')); empty.appendChild(document.createElement('br'));
    empty.appendChild(document.createTextNode('Adiciona o primeiro fornecedor.'));
    el.appendChild(empty); return;
  }

  suppliers.forEach((s, i) => {
    const qItems = quotationMap[s.id] || [];
    const qCount = qItems.length;
    const gs = supplierHistory[s.name?.trim().toLowerCase()];

    const card = document.createElement('div'); card.className = 'supplier-card';

    // Header
    const header = document.createElement('div'); header.className = 'supplier-card-header';
    header.addEventListener('click', () => toggleSupplier(i));

    const leftDiv = document.createElement('div'); leftDiv.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    const nameSpan = document.createElement('span'); nameSpan.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:var(--accent)"; nameSpan.textContent = s.name; leftDiv.appendChild(nameSpan);
    const statusBadge = document.createElement('span'); statusBadge.className = 'badge ' + suppStatusClass(s.status); statusBadge.textContent = s.status; leftDiv.appendChild(statusBadge);
    if (s.is_foreign) { const fb = document.createElement('span'); fb.className = 'badge'; fb.style.cssText = 'background:#3a2a00;color:#ffaa00;border:1px solid #5a4a00'; fb.textContent = 'ESTRANGEIRO'; leftDiv.appendChild(fb); }
    const quotBadge = document.createElement('span'); quotBadge.className = 'quot-badge' + (qCount ? ' has-items' : ''); quotBadge.textContent = qCount ? `${qCount} itens cotação` : 'sem cotação'; leftDiv.appendChild(quotBadge);
    if (qItems.some(qi => savedAnomalyMap[qi.id])) { const an = document.createElement('span'); an.className = 'anomaly-high'; an.title = 'Preços fora do histórico detectados'; an.appendChild(licon('alert-triangle', 11)); an.appendChild(document.createTextNode('\u00a0outlier')); leftDiv.appendChild(an); }
    if (gs?.avg_response_hours > 0) { const rb = document.createElement('span'); rb.className = 'resp-time-badge'; rb.textContent = '~' + formatResponseTime(gs.avg_response_hours); leftDiv.appendChild(rb); }
    header.appendChild(leftDiv);

    const rightDiv = document.createElement('div'); rightDiv.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap'; rightDiv.addEventListener('click', e => e.stopPropagation());
    if (s.email) { const rfqBtn = document.createElement('button'); rfqBtn.className = 'btn btn-ghost btn-sm'; lbtn(rfqBtn, 'mail', 'RFQ'); rfqBtn.addEventListener('click', e => { e.stopPropagation(); openRFQModal(i); }); rightDiv.appendChild(rfqBtn); }
    const manBtn = document.createElement('button'); manBtn.className = 'btn btn-ghost btn-sm'; lbtn(manBtn, 'pencil', 'Manual'); manBtn.addEventListener('click', () => openManualQuotEntry(s.id)); rightDiv.appendChild(manBtn);
    const quotBtn = document.createElement('button'); quotBtn.className = 'btn btn-ghost btn-sm'; lbtn(quotBtn, 'paperclip', 'Cotação'); quotBtn.addEventListener('click', () => uploadQuotation(s.id)); rightDiv.appendChild(quotBtn);
    const editBtn = document.createElement('button'); editBtn.className = 'btn btn-ghost btn-sm'; lbtn(editBtn, 'settings', 'Editar'); editBtn.addEventListener('click', () => openSupplierModal(i)); rightDiv.appendChild(editBtn);
    const delBtn = document.createElement('button'); delBtn.className = 'btn btn-danger btn-sm'; delBtn.appendChild(licon('trash-2', 13)); delBtn.setAttribute('aria-label', 'Eliminar'); delBtn.addEventListener('click', () => deleteSupplier(s.id)); rightDiv.appendChild(delBtn);
    header.appendChild(rightDiv);
    card.appendChild(header);

    // Body
    const body = document.createElement('div'); body.className = 'supplier-card-body'; body.id = 'suppBody-' + i;

    const grid = document.createElement('div'); grid.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;margin-bottom:${qCount ? '12px' : '0'}`;

    const mkInfo = (label, ...parts) => {
      const d = document.createElement('div');
      const lbl = document.createElement('span'); lbl.style.cssText = 'color:var(--muted);font-size:11px'; lbl.textContent = label; d.appendChild(lbl); d.appendChild(document.createElement('br'));
      parts.forEach(p => d.appendChild(typeof p === 'string' ? document.createTextNode(p) : p));
      return d;
    };

    const emailParts = [s.email || '—'];
    if (s.email_cc) { const br = document.createElement('br'); const ccSpan = document.createElement('span'); ccSpan.style.cssText = 'font-size:11px;color:var(--muted)'; ccSpan.textContent = 'CC: ' + s.email_cc; emailParts.push(br, ccSpan); }
    grid.appendChild(mkInfo('EMAIL', ...emailParts));
    grid.appendChild(mkInfo('ÚLTIMO CONTACTO', s.last_contact_at ? fmtDate(s.last_contact_at) : '—'));
    grid.appendChild(mkInfo('FOLLOW-UP', s.next_followup_at ? fmtDate(s.next_followup_at) : '—'));
    grid.appendChild(mkInfo('NOTAS', s.notes || '—'));
    body.appendChild(grid);

    // Quotation preview
    if (qCount) {
      const quotSec = document.createElement('div'); quotSec.style.cssText = 'border-top:1px solid var(--border);padding-top:12px';
      const quotHdr = document.createElement('div'); quotHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px';
      const quotLbl = document.createElement('div'); quotLbl.style.cssText = "font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:1px"; quotLbl.textContent = `COTAÇÃO — ${qCount} ITENS`; quotHdr.appendChild(quotLbl);
      if (quotationFilesMap[s.id]) { const vBtn = document.createElement('button'); vBtn.className = 'btn btn-ghost btn-sm'; lbtn(vBtn, 'file-text', 'Ver original'); vBtn.addEventListener('click', e => { e.stopPropagation(); viewQuotFile(quotationFilesMap[s.id].file_path); }); quotHdr.appendChild(vBtn); }
      quotSec.appendChild(quotHdr);
      const qTable = document.createElement('table'); qTable.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
      qItems.slice(0, 6).forEach(qi => {
        const anom = savedAnomalyMap[qi.id];
        const priceColor = anom ? (anom.type === 'high' ? '#fb923c' : '#818cf8') : '#fff';
        const priceTitle = anom ? (anom.type === 'high' ? `${anom.ratio}× acima da mediana histórica` : `${anom.ratio}× abaixo da mediana histórica`) : '';
        const tr = document.createElement('tr');
        const tdDesc = document.createElement('td'); tdDesc.style.cssText = 'padding:2px 0;color:var(--text)';
        const rawD = qi.raw_description; tdDesc.textContent = rawD.length > 55 ? rawD.substring(0, 55) + '…' : rawD;
        const tdPrice = document.createElement('td'); tdPrice.style.cssText = `text-align:right;font-family:'IBM Plex Mono',monospace;color:${priceColor};white-space:nowrap`; if (priceTitle) tdPrice.title = priceTitle;
        tdPrice.textContent = `${fmtPrice(qi.price)} ${qi.currency}`;
        if (anom) { const w = document.createElement('span'); w.style.cssText = 'display:inline-flex;align-items:center;margin-left:3px;color:var(--warn)'; w.appendChild(licon('alert-triangle', 10)); tdPrice.appendChild(w); }
        tr.appendChild(tdDesc); tr.appendChild(tdPrice); qTable.appendChild(tr);
      });
      if (qCount > 6) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 2; td.style.cssText = 'color:var(--muted);padding-top:4px'; td.textContent = `…e mais ${qCount - 6} itens`; tr.appendChild(td); qTable.appendChild(tr); }
      quotSec.appendChild(qTable); body.appendChild(quotSec);
    }

    card.appendChild(body);
    el.appendChild(card);
  });
}

function toggleSupplier(i) {
  const el = document.getElementById('suppBody-' + i);
  el.classList.toggle('open');
}

// ── RFQ ──
function _rfqBomSort(items) {
  // Category order = first appearance in BOM (by sort_order)
  const catFirst = {};
  bomItems.forEach(bi => {
    if (bi.category && catFirst[bi.category] === undefined) catFirst[bi.category] = bi.sort_order ?? 0;
  });
  return [...items].sort((a, b) => {
    const cA = a.bi.category ? (catFirst[a.bi.category] ?? 999999) : -1;
    const cB = b.bi.category ? (catFirst[b.bi.category] ?? 999999) : -1;
    if (cA !== cB) return cA - cB;
    return (a.bi.sort_order ?? 0) - (b.bi.sort_order ?? 0);
  });
}

function openRFQModal(supplierIdx) {
  const s = suppliers[supplierIdx];

  const semPreco = [], comPreco = [];
  bomItems.forEach((bi, idx) => {
    if (bi.is_service) return;
    const hasPrice = matches.some(m => m.bom_item_id === bi.id);
    (hasPrice ? comPreco : semPreco).push({ bi, idx });
  });
  _rfqBomSort(semPreco).forEach((v, i) => semPreco[i] = v);
  _rfqBomSort(comPreco).forEach((v, i) => comPreco[i] = v);

  const el = document.createElement('div');

  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = 'Pedido de Cotação — RFQ'; el.appendChild(tag);

  const titleRow = document.createElement('div'); titleRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:4px';
  const title = document.createElement('div'); title.className = 'modal-title'; title.style.marginBottom = '0'; title.textContent = s.name; titleRow.appendChild(title);
  const emailSpan = document.createElement('div'); emailSpan.style.cssText = "font-size:12px;color:var(--muted);font-family:'DM Mono',monospace;flex:1"; emailSpan.textContent = s.email; titleRow.appendChild(emailSpan);

  // Language toggle — language lives on global_suppliers, not process suppliers
  const _gsForLang = globalSuppliersList.find(g => g.name.trim().toLowerCase() === s.name.trim().toLowerCase());
  rfqLang = _gsForLang?.language || 'pt';
  const langWrap = document.createElement('div'); langWrap.style.cssText = 'display:flex;border:1px solid var(--border);border-radius:5px;overflow:hidden;flex-shrink:0';
  ['pt','en'].forEach(lang => {
    const btn = document.createElement('button'); btn.type = 'button'; btn.dataset.lang = lang;
    btn.textContent = lang.toUpperCase();
    btn.style.cssText = 'padding:3px 10px;font-family:DM Mono,monospace;font-size:11px;font-weight:600;border:none;cursor:pointer;transition:.15s;letter-spacing:.5px';
    const setActive = () => langWrap.querySelectorAll('button').forEach(b => {
      const active = b.dataset.lang === rfqLang;
      b.style.background = active ? 'var(--accent)' : 'var(--surface2)';
      b.style.color = active ? '#fff' : 'var(--muted)';
    });
    btn.addEventListener('click', () => { rfqLang = lang; setActive(); });
    langWrap.appendChild(btn);
  });
  titleRow.appendChild(langWrap);
  el.appendChild(titleRow);
  // Set initial active state after buttons are in DOM
  langWrap.querySelectorAll('button').forEach(b => {
    const active = b.dataset.lang === rfqLang;
    b.style.background = active ? 'var(--accent)' : 'var(--surface2)';
    b.style.color = active ? '#fff' : 'var(--muted)';
  });

  if (!bomItems.length) {
    const msg = document.createElement('div'); msg.style.cssText = 'color:var(--muted);font-size:13px;margin:20px 0'; msg.textContent = 'Carrega o BOM primeiro.'; el.appendChild(msg);
  } else {
    const listHdr = document.createElement('div'); listHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px';
    const listLbl = document.createElement('div'); listLbl.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);letter-spacing:.8px;text-transform:uppercase"; listLbl.textContent = 'Seleciona os itens a pedir'; listHdr.appendChild(listLbl);
    const allLbl = document.createElement('label'); allLbl.style.cssText = 'cursor:pointer;font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;font-family:DM Mono,monospace;font-weight:400;margin-bottom:0';
    const allCb = document.createElement('input'); allCb.type = 'checkbox'; allCb.id = 'rfq_all'; allCb.checked = true; allCb.style.width = 'auto';
    allCb.addEventListener('change', () => toggleAllRFQ(allCb.checked));
    allLbl.appendChild(allCb); allLbl.appendChild(document.createTextNode(' Selecionar tudo')); listHdr.appendChild(allLbl);
    el.appendChild(listHdr);

    const listContainer = document.createElement('div'); listContainer.style.cssText = 'border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:420px;overflow-y:auto;margin-bottom:16px';

    const buildSecHdr = (label, color) => {
      const h = document.createElement('div'); h.style.cssText = `padding:5px 12px;font-family:'DM Mono',monospace;font-size:10px;color:${color};letter-spacing:.8px;text-transform:uppercase;background:var(--surface2);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:1`; h.textContent = label; return h;
    };
    const buildGroup = (group, dimmed) => {
      const frag = document.createDocumentFragment(); let lastCat = null;
      for (const { bi, idx } of group) {
        if (bi.category && bi.category !== lastCat) {
          const catDiv = document.createElement('div'); catDiv.style.cssText = "display:flex;align-items:center;justify-content:space-between;background:var(--surface2);padding:5px 12px;border-bottom:1px solid var(--border);position:sticky;top:34px;z-index:1";
          const catName = document.createElement('span'); catName.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:var(--accent);letter-spacing:.8px;text-transform:uppercase"; catName.textContent = bi.category;
          const selCat = document.createElement('span'); selCat.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);cursor:pointer;user-select:none;padding:1px 6px;border-radius:3px;border:1px solid var(--border)"; selCat.textContent = 'sel. tudo';
          const catKey = bi.category;
          selCat.addEventListener('click', () => {
            const cbs = document.querySelectorAll(`.rfq-item-cb[data-rfq-cat="${CSS.escape(catKey)}"]`);
            const allChecked = [...cbs].every(c => c.checked);
            cbs.forEach(c => { c.checked = !allChecked; });
          });
          catDiv.appendChild(catName); catDiv.appendChild(selCat); frag.appendChild(catDiv); lastCat = bi.category;
        }
        const lbl = document.createElement('label'); lbl.style.cssText = `display:grid;grid-template-columns:20px 1fr auto;align-items:start;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:.1s${dimmed ? ';opacity:.45' : ''}`;
        lbl.addEventListener('mouseover', () => { lbl.style.background = 'rgba(37,99,235,.05)'; }); lbl.addEventListener('mouseout', () => { lbl.style.background = ''; });
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'rfq-item-cb'; cb.value = idx; cb.checked = true; cb.dataset.rfqCat = bi.category || ''; cb.style.cssText = 'margin-top:3px;width:auto'; lbl.appendChild(cb);
        const infoDiv = document.createElement('div');
        const descEl = document.createElement('div'); descEl.style.cssText = 'font-size:13px;color:var(--text);line-height:1.4'; descEl.textContent = bi.description; infoDiv.appendChild(descEl);
        if (bi.part_number) { const pnEl = document.createElement('div'); pnEl.style.cssText = "font-size:11px;color:var(--muted);font-family:'DM Mono',monospace;margin-top:2px"; pnEl.textContent = bi.part_number; infoDiv.appendChild(pnEl); }
        lbl.appendChild(infoDiv);
        const qtyEl = document.createElement('div'); qtyEl.style.cssText = "font-family:'DM Mono',monospace;font-size:11px;color:var(--muted);white-space:nowrap;padding-top:2px"; qtyEl.textContent = `× ${bi.quantity} ${bi.unit || ''}`; lbl.appendChild(qtyEl);
        frag.appendChild(lbl);
      }
      return frag;
    };

    if (semPreco.length) { listContainer.appendChild(buildSecHdr(`Sem preço — a pedir (${semPreco.length})`, 'var(--accent)')); listContainer.appendChild(buildGroup(semPreco, false)); }
    if (comPreco.length) { listContainer.appendChild(buildSecHdr(`Já com preço (${comPreco.length})`, 'var(--muted)')); listContainer.appendChild(buildGroup(comPreco, true)); }
    el.appendChild(listContainer);
  }

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  if (bomItems.length) {
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'btn btn-primary';
    sendBtn.textContent = '✉ Gerar Email';
    sendBtn.addEventListener('click', () => { void sendRFQ(supplierIdx); });
    actions.appendChild(sendBtn);
  }
  el.appendChild(actions);

  showModalLg(el);
}

function toggleAllRFQ(checked) {
  document.querySelectorAll('.rfq-item-cb').forEach(cb => cb.checked = checked);
}

function buildRFQHtml(selected, lang) {
  const en = lang === 'en';
  /* Explicit backgrounds — dark-mode mail clients paint unspecified TD backgrounds black */
  const td = 'style="border:1px solid #cbd5e1;padding:7px 10px;background:#ffffff;color:#1e293b"';
  const tdC = 'style="border:1px solid #cbd5e1;padding:7px 10px;text-align:center;background:#ffffff;color:#1e293b"';
  const tdMono = 'style="border:1px solid #cbd5e1;padding:7px 10px;font-family:monospace;font-size:12px;background:#ffffff;color:#1e293b"';

  const hasPartNum = selected.some(bi => bi.part_number);
  const colSpan = hasPartNum ? 4 : 3;

  let rows = '';
  let lastCat = undefined;
  for (const bi of selected) {
    if (bi.category !== lastCat) {
      if (bi.category) {
        rows += '<tr style="background:#e8f0fe"><td colspan="' + colSpan + '" style="border:1px solid #cbd5e1;padding:5px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#1e40af;background:#e8f0fe">' + esc(bi.category) + '</td></tr>';
      }
      lastCat = bi.category;
    }
    rows += '<tr style="background:#ffffff">';
    if (hasPartNum) rows += '<td ' + tdMono + '>' + esc(bi.part_number || '-') + '</td>';
    rows += '<td ' + td + '>' + esc(bi.description || '-') + '</td>';
    rows += '<td ' + tdC + '>' + (bi.quantity || 1) + '</td>';
    rows += '<td ' + td + '>' + esc(bi.unit || (en ? 'Unit' : 'Unidade')) + '</td>';
    rows += '</tr>';
  }

  const thStyle = 'style="border:1px solid #cbd5e1;padding:8px 10px;text-align:left;font-weight:600;background:#f0f4f8;color:#1e293b"';
  const thCStyle = 'style="border:1px solid #cbd5e1;padding:8px 10px;text-align:center;font-weight:600;background:#f0f4f8;color:#1e293b"';

  const table = '<table border="1" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border-collapse:collapse;font-size:13px;width:100%;max-width:720px;background:#ffffff;color:#1e293b">'
    + '<thead><tr>'
    + (hasPartNum ? '<th ' + thStyle + '>' + (en ? 'Reference' : 'Artigo') + '</th>' : '')
    + '<th ' + thStyle + '>' + (en ? 'Description' : 'Descri&ccedil;&atilde;o') + '</th>'
    + '<th ' + thCStyle + '>' + (en ? 'Qty.' : 'Qtd.') + '</th>'
    + '<th ' + thStyle + '>' + (en ? 'Unit' : 'Unidade') + '</th>'
    + '</tr></thead>'
    + '<tbody style="background:#ffffff">' + rows + '</tbody>'
    + '</table>';

  const body = en
    ? '<p style="color:#1e293b;margin:0 0 1em 0">Good day,</p>'
      + '<p style="color:#1e293b;margin:0 0 1em 0">I trust this message finds you well.</p>'
      + '<p style="color:#1e293b;margin:0 0 1em 0">We are reaching out to formally request a quotation for the following requirement:</p>'
      + table
      + '<p style="color:#1e293b;margin:1em 0 0 0">Could you also kindly include the shipping cost and ETA?</p>'
    : '<p style="color:#1e293b;margin:0 0 1em 0">Boa tarde, Prezados,</p>'
      + '<p style="color:#1e293b;margin:0 0 1em 0">Espero que este e-mail os encontre bem.</p>'
      + '<p style="color:#1e293b;margin:0 0 1em 0">Queria solicitar uma cota&ccedil;&atilde;o para o equipamento abaixo:</p>'
      + table;

  const inner = '<div style="font-family:Arial,sans-serif;font-size:14px;background:#ffffff;color:#1e293b;line-height:1.6">' + body + '</div>';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:12px;background:#ffffff;color:#1e293b">' + inner + '</body></html>';
}

/**
 * Synchronous rich HTML copy (same user gesture as the click). Required because opening mailto first
 * consumes activation — async navigator.clipboard.write then often fails and paste is empty.
 * Do NOT add pointer-events:none here — some engines won't copy/focus correctly.
 */
function _copyRfqRichSync(html) {
  try {
    const wrap = document.createElement('div');
    wrap.setAttribute('contenteditable', 'true');
    wrap.tabIndex = -1;
    wrap.style.cssText = 'position:fixed;left:-8000px;top:0;width:720px;max-height:90vh;overflow:auto;opacity:0;z-index:2147483646';
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    wrap.innerHTML = bodyMatch ? bodyMatch[1] : html;
    document.body.appendChild(wrap);
    wrap.focus();
    const range = document.createRange();
    range.selectNodeContents(wrap);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    wrap.remove();
    return !!ok;
  } catch (e) {
    console.warn('[RFQ] execCommand copy failed:', e);
    return false;
  }
}

/**
 * Async Clipboard API (best when it works). Callers may start this BEFORE mailto and await AFTER.
 */
function _copyRfqClipboardApiPromise(html) {
  if (!navigator.clipboard || !window.ClipboardItem) return null;
  return navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
    }),
  ]).then(() => true).catch((e) => {
    console.warn('[RFQ] ClipboardItem failed:', e);
    return false;
  });
}

/**
 * Open mailto while still in the same synchronous user gesture as the button click.
 * After `await` (clipboard), browsers block location.assign / mailto — looks like "nothing happens".
 * Do not use target=_blank for mailto — it can behave oddly and confuse activation in some browsers.
 */
function _openMailtoSync(mailto) {
  try {
    const a = document.createElement('a');
    a.href = mailto;
    a.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch (e) {
    console.warn('[RFQ] mailto anchor click failed:', e);
  }
  try {
    const w = window.open(mailto, '_blank', 'noopener,noreferrer');
    if (w) return true;
  } catch (e2) {
    console.warn('[RFQ] window.open mailto failed:', e2);
  }
  try {
    window.location.href = mailto;
    return true;
  } catch (e3) {
    console.warn('[RFQ] location mailto failed:', e3);
  }
  return false;
}

/**
 * RFQ "Gerar Email" — ordering (both matter):
 * 1) Opening mailto AFTER `await` clipboard → mail blocked (silent).
 * 2) Opening mailto BEFORE async clipboard finishes → clipboard often blocked → paste empty.
 * So: start Clipboard API write (no await), sync rich copy, open mailto, await API, optional second sync.
 */
async function sendRFQ(supplierIdx) {
  try {
    const s = suppliers[supplierIdx];
    if (!s || !String(s.email || '').trim()) {
      showToast('Este fornecedor não tem email principal.', true);
      return;
    }
    const catFirst = {};
    bomItems.forEach(bi => { if (bi.category && catFirst[bi.category] === undefined) catFirst[bi.category] = bi.sort_order ?? 0; });
    const selected = [...document.querySelectorAll('.rfq-item-cb:checked')]
      .map(cb => bomItems[parseInt(cb.value)])
      .filter(Boolean)
      .sort((a, b) => {
        const cA = a.category ? (catFirst[a.category] ?? 999999) : -1;
        const cB = b.category ? (catFirst[b.category] ?? 999999) : -1;
        if (cA !== cB) return cA - cB;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      });
    if (!selected.length) { showToast('Seleciona pelo menos um item.', true); return; }

    const lang = rfqLang === 'en' ? 'en' : 'pt';
    const subject = lang === 'en'
      ? 'Request for Quotation - ' + process.project_name
      : 'Pedido de Cotacao - ' + process.project_name;
    const html = buildRFQHtml(selected, lang);
    const ccEmails = ['procurement@triana.co.mz', ...(s.email_cc ? [s.email_cc] : [])].map(encodeURIComponent).join(',');
    const mailto = 'mailto:' + encodeURIComponent(s.email) + '?cc=' + ccEmails + '&subject=' + encodeURIComponent(subject);

    const clipPending = _copyRfqClipboardApiPromise(html);
    let copied = _copyRfqRichSync(html);
    const mailOpened = _openMailtoSync(mailto);

    if (clipPending) {
      try {
        if (await clipPending) copied = true;
      } catch (e) {
        console.error('[RFQ] Clipboard error:', e);
      }
    }
    if (!copied) copied = _copyRfqRichSync(html);

    closeModal();
    if (mailOpened && copied) {
      showToast('Cliente de email aberto. Corpo copiado — cola no email (Ctrl+V).');
    } else if (mailOpened && !copied) {
      showToast('Cliente de email aberto. Copiar para a área de transferência falhou — cola o corpo manualmente se precisares.', true);
    } else if (!mailOpened && copied) {
      showToast('Corpo copiado. Se o email não abriu, abre o cliente manualmente para ' + s.email + '.', true);
    } else {
      showToast('Não foi possível abrir o email nem copiar. Tenta noutro browser ou verifica permissões.', true);
    }
  } catch (e) {
    console.error('[RFQ] sendRFQ:', e);
    showToast('Erro ao gerar email: ' + (e && e.message ? e.message : String(e)), true);
  }
}

function autoFillSupplierEmail(name) {
  const known = supplierHistory[name.trim().toLowerCase()];
  if (!known) return;
  const eEl = document.getElementById('sf_email');
  const ccEl = document.getElementById('sf_email_cc');
  if (eEl && !eEl.value) eEl.value = known.email || '';
  if (ccEl && !ccEl.value) ccEl.value = known.email_cc || '';
}

// ── Tag Box (shared for suppliers and process categories) ──
function renderTagBox(boxId, arr, type) {
  const box = document.getElementById(boxId);
  if (!box) return;
  while (box.firstChild) box.removeChild(box.firstChild);
  arr.forEach((c, i) => {
    const span = document.createElement('span');
    span.className = 'tag-chip';
    span.textContent = c;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '\u00d7';
    btn.onclick = () => removeSupplierTag(type, i);
    span.appendChild(btn);
    box.appendChild(span);
  });
  const inp = document.createElement('input');
  inp.id = 'tagInput_' + type;
  inp.className = 'tag-input-field';
  inp.placeholder = 'Adicionar, Enter para confirmar...';
  inp.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = this.value.trim().replace(/,/g, '');
      if (!val) return;
      if (type === 'cat') { if (!pendingSupplierCategories.includes(val)) pendingSupplierCategories.push(val); }
      else if (type === 'pcat') { if (!pendingProcessCategories.includes(val)) pendingProcessCategories.push(val); }
      else { if (!pendingSupplierBrands.includes(val)) pendingSupplierBrands.push(val); }
      renderTagBox(boxId, type === 'cat' ? pendingSupplierCategories : type === 'pcat' ? pendingProcessCategories : pendingSupplierBrands, type);
      document.getElementById('tagInput_' + type)?.focus();
    }
  };
  box.appendChild(inp);
}

function removeSupplierTag(type, idx) {
  if (type === 'cat') pendingSupplierCategories.splice(idx, 1);
  else if (type === 'pcat') pendingProcessCategories.splice(idx, 1);
  else pendingSupplierBrands.splice(idx, 1);
  const boxId = type === 'cat' ? 'sfCatBox' : type === 'pcat' ? 'ep_catBox' : 'sfBrandBox';
  const arr = type === 'cat' ? pendingSupplierCategories : type === 'pcat' ? pendingProcessCategories : pendingSupplierBrands;
  renderTagBox(boxId, arr, type);
}

// ── Supplier Modal ──
function openSupplierModal(idx = null, prefill = {}) {
  // If caller used addEventListener('click', openSupplierModal), idx is the MouseEvent — treat as new supplier
  if (typeof idx === 'object' && idx !== null) idx = null;
  editingSupplierIdx = idx;
  const s = idx !== null ? suppliers[idx] : null;
  const gs = s ? globalSuppliersList.find(g => g.name.trim().toLowerCase() === s.name.trim().toLowerCase()) : null;
  pendingSupplierCategories = gs ? [...(gs.categories || [])] : (prefill.categories || []);
  pendingSupplierBrands = gs ? [...(gs.brands || [])] : [];

  const el = document.createElement('div');
  // Static skeleton — no user data
  el.appendChild(document.createRange().createContextualFragment(`
    <div class="modal-tag"></div>
    <div class="modal-title"></div>
    <datalist id="supplierNameList"></datalist>
    <div class="form-grid-2">
      <div><label>Nome</label><input id="sf_name" placeholder="Ex: Tech Solutions" list="supplierNameList"></div>
      <div><label>Email Principal</label><input id="sf_email" placeholder="email@fornecedor.com"></div>
    </div>
    <div class="form-grid-2">
      <div><label>Email CC <span style="font-size:11px;color:var(--muted);font-weight:400">(2º contacto — opcional)</span></label><input id="sf_email_cc" placeholder="cc@fornecedor.com"></div>
      <div></div>
    </div>
    <div class="form-grid-2">
      <div><label>Estado</label><select id="sf_status"></select></div>
      <div style="display:flex;align-items:center;gap:10px;padding-top:20px">
        <label style="display:flex;align-items:center;gap:8px;margin:0;cursor:pointer">
          <input type="checkbox" id="sf_foreign" style="width:auto">
          <span style="font-size:13px;color:var(--text)">Fornecedor Estrangeiro</span>
        </label>
      </div>
    </div>
    <div class="form-grid-2">
      <div><label>Último Contacto</label><input type="date" id="sf_last"></div>
      <div><label>Próximo Follow-up</label><input type="date" id="sf_followup"></div>
    </div>
    <div class="form-row"><label>Notas</label><textarea id="sf_notes"></textarea></div>
    <div class="form-grid-2">
      <div>
        <label>Categorias <span style="font-size:11px;color:var(--muted);font-weight:400">(tipos de equipamento — opcional)</span></label>
        <div class="tag-input-box" id="sfCatBox"></div>
      </div>
      <div>
        <label>Marcas <span style="font-size:11px;color:var(--muted);font-weight:400">(opcional)</span></label>
        <div class="tag-input-box" id="sfBrandBox"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="sf_cancel">Cancelar</button>
      <button class="btn btn-primary" id="sf_save">Guardar</button>
    </div>
  `));

  // Fill in user data (el.querySelector works on detached elements)
  el.querySelector('.modal-tag').textContent = s ? 'Editar Fornecedor' : 'Novo Fornecedor';
  el.querySelector('.modal-title').textContent = s ? s.name : 'Adicionar Fornecedor';

  // Datalist — supplier names from history (user data → textContent only)
  const datalist = el.querySelector('#supplierNameList');
  Object.values(supplierHistory).forEach(sh => { const opt = document.createElement('option'); opt.value = sh.name; datalist.appendChild(opt); });

  // Status options
  const statusSel = el.querySelector('#sf_status');
  const sfStatuses = ['Not contacted','Request sent','Waiting response','Follow-up needed','Replied partial','Replied complete','No stock','Not available','Ignored / no response'];
  sfStatuses.forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.textContent = v; if ((s?.status || 'Not contacted') === v) opt.selected = true; statusSel.appendChild(opt); });

  // Foreign checkbox
  const foreignCb = el.querySelector('#sf_foreign');
  if (s?.is_foreign) foreignCb.checked = true;
  foreignCb.addEventListener('change', function() { toggleForeignBox(this.checked); });

  // Input values
  const _sf = (id, v) => { const inp = el.querySelector('#' + id); if (inp) inp.value = v == null ? '' : String(v); };
  _sf('sf_name', s?.name || prefill.name || '');
  _sf('sf_email', s?.email || gs?.email || prefill.email || '');
  _sf('sf_email_cc', s?.email_cc || gs?.email_cc || prefill.email_cc || '');
  _sf('sf_notes', s?.notes || '');
  _sf('sf_last', s?.last_contact_at || '');
  _sf('sf_followup', s?.next_followup_at || '');

  el.querySelector('#sf_name').addEventListener('input', function() { autoFillSupplierEmail(this.value); });
  el.querySelector('#sf_cancel').addEventListener('click', closeModal);
  el.querySelector('#sf_save').addEventListener('click', saveSupplier);

  showModal(el);
  renderTagBox('sfCatBox', pendingSupplierCategories, 'cat');
  renderTagBox('sfBrandBox', pendingSupplierBrands, 'brand');
  if (document.getElementById('ep_catBox')) renderTagBox('ep_catBox', pendingProcessCategories, 'pcat');
}

function toggleForeignBox(_val) { /* sf_foreignBox removed — cambio/transport/direitos moved to quotation modal */ }

async function saveSupplier() {
  const fields = {
    process_id:       processId,
    name:             document.getElementById('sf_name').value.trim(),
    email:            document.getElementById('sf_email').value.trim() || null,
    status:           document.getElementById('sf_status').value,
    is_foreign:       document.getElementById('sf_foreign').checked,
    last_contact_at:  document.getElementById('sf_last').value || null,
    next_followup_at: document.getElementById('sf_followup').value || null,
    notes:            document.getElementById('sf_notes').value.trim() || null,
    email_cc:         document.getElementById('sf_email_cc').value.trim() || null,
  };
  if (!fields.name) { showToast('Nome do fornecedor é obrigatório.', true); return; }
  if (fields.name.length > 200) { showToast('Nome demasiado longo (máx 200 caracteres).', true); return; }
  if (fields.email && (fields.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))) { showToast('Email inválido.', true); return; }
  if (fields.email_cc && (fields.email_cc.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email_cc))) { showToast('Email CC inválido.', true); return; }
  if (fields.notes && fields.notes.length > 5000) { showToast('Notas demasiado longas (máx 5000 caracteres).', true); return; }

  // Response time tracking
  const prev = editingSupplierIdx !== null ? suppliers[editingSupplierIdx] : null;
  const now = new Date().toISOString();
  const repliedStatuses = ['Replied partial', 'Replied complete', 'No stock', 'Not available', 'Ignored/no response'];
  if (fields.status === 'Request sent' && prev?.status !== 'Request sent') {
    fields.contacted_at = now;
  }
  let shouldRecordResponse = false;
  let responseHours = 0;
  if (!repliedStatuses.includes(prev?.status) && repliedStatuses.includes(fields.status)) {
    fields.replied_at = now;
    if (prev?.contacted_at) {
      responseHours = (new Date(now) - new Date(prev.contacted_at)) / 3600000;
      if (responseHours > 0 && responseHours < 8760) shouldRecordResponse = true;
    }
  }

  try {
    if (editingSupplierIdx !== null) {
      await API.updateSupplier(suppliers[editingSupplierIdx].id, fields);
    } else {
      await API.createSupplier(fields);
    }
    if (shouldRecordResponse) {
      try { await API.recordSupplierResponse(fields.name, responseHours); } catch(_) {}
    }
    // Silently merge categories/brands into global supplier profile
    try { await API.upsertGlobalSupplier(fields.name, fields.email || '', fields.email_cc || '', pendingSupplierCategories, pendingSupplierBrands); globalSuppliersList = await API.getGlobalSuppliers(); } catch(_) {}
    closeModal();
    suppliers = await API.getSuppliers(processId);
    renderSuppliers();
    renderSupplierSuggestions();
    showToast('Fornecedor guardado.');
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

function deleteSupplier(id) {
  if (!UUID_RE.test(id)) return;
  const s = suppliers.find(x => x.id === id);

  const el = document.createElement('div');
  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = 'Confirmar'; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = 'Apagar Fornecedor'; el.appendChild(title);
  const msg = document.createElement('div'); msg.style.cssText = 'color:var(--muted);font-size:14px;margin-bottom:24px';
  msg.appendChild(document.createTextNode('Apagar '));
  const strong = document.createElement('strong'); strong.style.color = '#fff'; strong.textContent = s?.name || ''; msg.appendChild(strong);
  msg.appendChild(document.createTextNode('? Esta ação não pode ser desfeita.')); el.appendChild(msg);
  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  const delBtn = document.createElement('button'); delBtn.className = 'btn btn-danger'; delBtn.textContent = 'Apagar'; delBtn.addEventListener('click', () => doDeleteSupplier(id)); actions.appendChild(delBtn);
  el.appendChild(actions);
  showModal(el);
}

async function doDeleteSupplier(id) {
  if (!UUID_RE.test(id)) return;
  try {
    await API.deleteSupplier(id);
    suppliers = suppliers.filter(s => s.id !== id);
    closeModal();
    renderSuppliers();
    renderMatchingTab();
    showToast('Fornecedor removido.');
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── Quotation Upload ──
function uploadQuotation(supplierId) {
  if (!UUID_RE.test(supplierId)) return;
  currentQuotSuppId = supplierId;
  const input = document.getElementById('quotFileInput');
  input.value = '';
  input.click();
}

function openManualQuotEntry(supplierId) {
  if (!UUID_RE.test(supplierId)) return;
  currentQuotSuppId = supplierId;
  const existing = quotationMap[supplierId] || [];
  pendingQuotItems = existing.map(qi => ({
    id: qi.id,
    raw_part_number: qi.raw_part_number,
    raw_sku: qi.raw_sku || null,
    raw_description: qi.raw_description,
    quantity: qi.quantity,
    price: qi.price,
    currency: qi.currency,
    discount: qi.discount || 0,
    _enteredPrice: (qi.price || 0) * (1 - (qi.discount || 0) / 100),
    eta_value: qi.eta_value || '',
    eta_unit: qi.eta_unit || 'dias',
  }));
  pendingQuotFile = null;
  openQuotationValModal(existing.length ? 'Editar Cotação' : 'Entrada Manual');
}

// Carry over DB ids from existing items to newly parsed items by part_number or description match
function _carryIds(existing, newItems) {
  return newItems.map(ni => {
    const m = existing.find(e =>
      (ni.raw_part_number && e.raw_part_number &&
       ni.raw_part_number.trim() === e.raw_part_number.trim()) ||
      ni.raw_description.trim().toLowerCase() === e.raw_description.trim().toLowerCase()
    );
    return m ? { ...ni, id: m.id } : ni;
  });
}

function _askReplaceOrAppend(existingItems, newItems, onReplace, onAppend) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center';
  const box = document.createElement('div');
  box.style.cssText = 'background:var(--surface);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.4)';
  const title = document.createElement('div');
  title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:8px';
  title.textContent = 'Cotação já existente';
  const body = document.createElement('div');
  body.style.cssText = 'font-size:13px;color:var(--muted);margin-bottom:22px;line-height:1.5';
  body.textContent = `Este fornecedor já tem ${existingItems.length} item(ns) guardado(s). O que pretendes fazer com os ${newItems.length} item(ns) novos?`;
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';
  const btnCancel = document.createElement('button');
  btnCancel.className = 'btn btn-ghost btn-sm';
  btnCancel.textContent = 'Cancelar';
  const btnAppend = document.createElement('button');
  btnAppend.className = 'btn btn-secondary btn-sm';
  btnAppend.textContent = 'Adicionar aos existentes';
  const btnReplace = document.createElement('button');
  btnReplace.className = 'btn btn-primary btn-sm';
  btnReplace.textContent = 'Substituir tudo';
  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnAppend);
  btnRow.appendChild(btnReplace);
  box.appendChild(title);
  box.appendChild(body);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => document.body.removeChild(overlay);
  btnCancel.addEventListener('click', close);
  btnReplace.addEventListener('click', () => { close(); onReplace(); });
  btnAppend.addEventListener('click', () => { close(); onAppend(); });
}

async function handleQuotationUpload(input) {
  if (!input.files.length || !currentQuotSuppId) return;
  const file = input.files[0];

  if (file.size > MAX_UPLOAD_SIZE) { showToast(`Ficheiro demasiado grande (máx ${MAX_UPLOAD_SIZE / 1024 / 1024}MB).`, true); return; }
  if (!ALLOWED_QUOT_TYPES.includes(file.type) && !file.name.match(/\.(xlsx?|pdf)$/i)) { showToast('Tipo de ficheiro não permitido. Usa .xlsx, .xls ou .pdf.', true); return; }

  pendingQuotFile = file;
  if (file.name.toLowerCase().endsWith('.pdf')) {
    await handlePdfQuotation(file);
  } else {
    const buf = await file.arrayBuffer();
    const { items, detected } = parseQuotationExcel(buf);
    const newItems = detected ? items.map(i => ({...i})) : [];
    if (!detected) showToast('Formato não detetado — adiciona itens manualmente.', true);
    const existing = (quotationMap[currentQuotSuppId] || []).map(qi => ({
      id: qi.id,
      raw_part_number: qi.raw_part_number || null,
      raw_sku: qi.raw_sku || null,
      raw_description: qi.raw_description,
      quantity: qi.quantity,
      price: qi.price,
      currency: qi.currency,
    }));
    if (existing.length && newItems.length) {
      _askReplaceOrAppend(existing, newItems,
        () => { pendingQuotItems = _carryIds(existing, newItems); openQuotationValModal(file.name); },
        () => { pendingQuotItems = [...existing, ...newItems]; openQuotationValModal(file.name); }
      );
    } else {
      pendingQuotItems = newItems;
      openQuotationValModal(file.name);
    }
  }
}

function parseQuotationExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const priceKw = ['preço','preco','price','valor','unit','unitár','unitár','custo'];
  const descKw  = ['descri','artigo','produto','item','designa','material','equipment'];
  const qtyKw   = ['qty','quant','quantidade','qnt'];
  const partKw  = ['part','ref','código','codigo','code','p/n','sku'];

  let headerRow = -1, colDesc = -1, colQty = -1, colPrice = -1, colPart = -1;

  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map(c => String(c||'').toLowerCase().trim());
    let price=-1, desc=-1, qty=-1, part=-1;
    for (let j = 0; j < cells.length; j++) {
      const c = cells[j];
      if (price===-1 && priceKw.some(k=>c.includes(k))) price=j;
      if (desc ===-1 && descKw .some(k=>c.includes(k))) desc=j;
      if (qty  ===-1 && qtyKw  .some(k=>c.includes(k))) qty=j;
      if (part ===-1 && partKw .some(k=>c.includes(k))) part=j;
    }
    if (price !== -1 && desc !== -1) {
      headerRow=i; colPrice=price; colDesc=desc; colQty=qty; colPart=part; break;
    }
  }

  if (headerRow === -1) return { items: [], detected: false };

  const items = [];
  for (let i = headerRow+1; i < rows.length; i++) {
    const row = rows[i];
    const desc  = String(row[colDesc]||'').trim();
    const price = parseNum(String(row[colPrice]||''));
    const qty   = colQty!==-1 ? parseFloat(String(row[colQty]||'').replace(',','.')) : 1;
    const part  = colPart!==-1 ? String(row[colPart]||'').trim() : null;
    if (!desc || isNaN(price) || price <= 0) continue;
    items.push({
      raw_part_number: part||null,
      raw_description: desc,
      quantity: isNaN(qty)||qty<=0 ? 1 : qty,
      price,
      currency: 'MZN',
    });
  }
  return { items, detected: true };
}

function openQuotationValModal(fileName, rawPdfText) {
  const s = suppliers.find(x => x.id === currentQuotSuppId);

  const el = document.createElement('div');
  const tag = document.createElement('div'); tag.className = 'modal-tag'; tag.textContent = `Cotação — ${s?.name || ''}`; el.appendChild(tag);
  const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = fileName; el.appendChild(title);
  const sub = document.createElement('div'); sub.style.cssText = 'font-size:13px;color:var(--muted);margin-bottom:12px'; sub.textContent = `${pendingQuotItems.length} linha(s) detetada(s). Revê e confirma antes de guardar.`; el.appendChild(sub);

  // Reset global discount + ETA controls (per-item values already loaded from DB)
  quotGlobalDiscount = 0;
  quotGlobalEta = { value: '', unit: 'dias' };
  pendingQuotItems.forEach(item => {
    if (item.discount == null) item.discount = 0;
    item._discountManual = false;
    item._etaManual = false;
    if (item.eta_value == null) item.eta_value = '';
    if (item.eta_unit == null) item.eta_unit = 'dias';
  });

  // Discount bar
  const discBar = document.createElement('div'); discBar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px';
  const discLabel = document.createElement('label'); discLabel.style.cssText = 'font-size:12px;color:var(--muted)'; discLabel.textContent = 'Desconto global';
  const discIn = document.createElement('input'); discIn.type = 'number'; discIn.min = '0'; discIn.max = '100'; discIn.step = '0.1'; discIn.value = '0'; discIn.style.cssText = 'width:70px;padding:4px 6px;font-size:12px';
  const discPct = document.createElement('span'); discPct.style.cssText = 'font-size:12px;color:var(--muted)'; discPct.textContent = '%';
  discIn.oninput = function() {
    quotGlobalDiscount = parseFloat(this.value) || 0;
    pendingQuotItems.forEach(item => {
      if (!item._discountManual) {
        item.discount = quotGlobalDiscount;
        const entered = item._enteredPrice ?? item.price;
        item.price = quotGlobalDiscount > 0 && quotGlobalDiscount < 100
          ? Math.round((entered / (1 - quotGlobalDiscount / 100)) * 100) / 100
          : entered;
      }
    });
    renderQuotValTable();
  };
  const resetDiscBtn = document.createElement('button'); resetDiscBtn.className = 'btn btn-ghost btn-sm'; resetDiscBtn.textContent = 'Reset 0%';
  resetDiscBtn.onclick = function() {
    quotGlobalDiscount = 0; discIn.value = '0';
    pendingQuotItems.forEach(item => {
      item.discount = 0; item._discountManual = false;
      if (item._enteredPrice != null) item.price = item._enteredPrice;
    });
    renderQuotValTable();
  };
  discBar.appendChild(discLabel); discBar.appendChild(discIn); discBar.appendChild(discPct); discBar.appendChild(resetDiscBtn);
  el.appendChild(discBar);

  // ETA global bar
  const etaBar = document.createElement('div'); etaBar.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px';
  const etaLabel = document.createElement('label'); etaLabel.style.cssText = 'font-size:12px;color:var(--muted)'; etaLabel.textContent = 'ETA global';
  const etaValIn = document.createElement('input'); etaValIn.type = 'text'; etaValIn.placeholder = '—'; etaValIn.value = ''; etaValIn.style.cssText = 'width:70px;padding:4px 6px;font-size:12px';
  const etaGlobalUnitBtn = document.createElement('button');
  etaGlobalUnitBtn.textContent = 'Dias'; etaGlobalUnitBtn.dataset.unit = 'dias';
  etaGlobalUnitBtn.style.cssText = 'font-size:11px;padding:3px 8px;background:var(--surface);border:1px solid var(--border);border-radius:3px;color:var(--muted);cursor:pointer;font-family:inherit';
  etaGlobalUnitBtn.addEventListener('click', () => {
    const next = etaGlobalUnitBtn.dataset.unit === 'dias' ? 'semanas' : 'dias';
    etaGlobalUnitBtn.dataset.unit = next;
    etaGlobalUnitBtn.textContent = next === 'dias' ? 'Dias' : 'Semanas';
    quotGlobalEta.unit = next;
    pendingQuotItems.forEach(item => { if (!item._etaManual) item.eta_unit = next; });
    renderQuotValTable();
  });
  etaValIn.addEventListener('input', () => {
    quotGlobalEta.value = etaValIn.value.trim();
    pendingQuotItems.forEach(item => { if (!item._etaManual) { item.eta_value = quotGlobalEta.value; item.eta_unit = quotGlobalEta.unit; } });
    renderQuotValTable();
  });
  const resetEtaBtn = document.createElement('button'); resetEtaBtn.className = 'btn btn-ghost btn-sm'; resetEtaBtn.textContent = 'Reset';
  resetEtaBtn.onclick = function() {
    quotGlobalEta = { value: '', unit: 'dias' }; etaValIn.value = ''; etaGlobalUnitBtn.dataset.unit = 'dias'; etaGlobalUnitBtn.textContent = 'Dias';
    pendingQuotItems.forEach(item => { item.eta_value = ''; item.eta_unit = 'dias'; item._etaManual = false; });
    renderQuotValTable();
  };
  etaBar.appendChild(etaLabel); etaBar.appendChild(etaValIn); etaBar.appendChild(etaGlobalUnitBtn); etaBar.appendChild(resetEtaBtn);
  el.appendChild(etaBar);

  // Ref type toggle — pre-fill from global supplier record
  const _gsForRef = globalSuppliersList.find(g => g.name.trim().toLowerCase() === (s?.name || '').trim().toLowerCase());
  _quotRefType = _gsForRef?.last_ref_type || 'part_number';
  // Apply initial remap: if SKU mode, move raw_part_number → raw_sku on parsed items
  if (_quotRefType === 'sku') {
    pendingQuotItems.forEach(item => {
      if (item.raw_part_number && !item.raw_sku) { item.raw_sku = item.raw_part_number; item.raw_part_number = null; }
    });
  }
  const refBar = document.createElement('div'); refBar.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;font-size:12px;color:var(--muted)';
  const refBarLabel = document.createElement('span'); refBarLabel.textContent = 'Campo de referência:';
  const _makeRefOpt = (value, label) => {
    const wrap = document.createElement('label'); wrap.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text)';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'quotRefType'; radio.value = value;
    if (_quotRefType === value) radio.checked = true;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const prev = _quotRefType;
      _quotRefType = value;
      // Remap values in pendingQuotItems
      pendingQuotItems.forEach(item => {
        if (value === 'sku' && prev === 'part_number') {
          if (item.raw_part_number) { item.raw_sku = item.raw_part_number; item.raw_part_number = null; }
        } else if (value === 'part_number' && prev === 'sku') {
          if (item.raw_sku) { item.raw_part_number = item.raw_sku; item.raw_sku = null; }
        }
      });
      // Update column header
      const th = table.querySelector('thead th');
      if (th) th.textContent = value === 'sku' ? 'SKU' : 'Part #';
      renderQuotValTable();
    });
    wrap.appendChild(radio); wrap.appendChild(document.createTextNode(label));
    return wrap;
  };
  refBar.appendChild(refBarLabel);
  refBar.appendChild(_makeRefOpt('part_number', 'Part Number'));
  refBar.appendChild(_makeRefOpt('sku', 'SKU fornecedor'));
  el.appendChild(refBar);

  // Rates block — shown only when any item has currency != MZN
  const ratesBlock = document.createElement('div');
  ratesBlock.id = 'quotRatesBlock';
  ratesBlock.style.cssText = 'display:none;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.2);border-radius:8px';
  const ratesLabel = document.createElement('span');
  ratesLabel.style.cssText = "font-family:'DM Mono',monospace;font-size:10px;color:#f97316;letter-spacing:.5px;text-transform:uppercase;flex-shrink:0";
  ratesLabel.textContent = 'Câmbio / custos importação';
  ratesBlock.appendChild(ratesLabel);
  function _makeRateField(id, label, placeholder) {
    const wrap = document.createElement('div'); wrap.style.cssText = 'display:flex;align-items:center;gap:6px';
    const lbl = document.createElement('label'); lbl.style.cssText = 'font-size:12px;color:var(--muted);white-space:nowrap;margin:0'; lbl.textContent = label;
    const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.step = '0.01'; inp.id = id; inp.placeholder = placeholder;
    inp.style.cssText = 'width:90px;padding:4px 6px;font-size:12px';
    wrap.appendChild(lbl); wrap.appendChild(inp);
    return wrap;
  }
  ratesBlock.appendChild(_makeRateField('qf_cambio', 'Câmbio (MZN)', '64.00'));
  ratesBlock.appendChild(_makeRateField('qf_transport', 'Transporte (MZN)', '1500.00'));
  ratesBlock.appendChild(_makeRateField('qf_direitos', 'Direitos (%)', '7.5'));
  el.appendChild(ratesBlock);
  // Pre-populate with existing supplier values (el not in DOM yet — use el.querySelector)
  const _setRate = (id, v) => { const inp = el.querySelector('#' + id); if (inp && v) inp.value = v; };
  _setRate('qf_cambio', s?.cambio);
  _setRate('qf_transport', s?.transport);
  _setRate('qf_direitos', s?.direitos);

  // Table (static thead, dynamic tbody populated by renderQuotValTable)
  const tableWrap = document.createElement('div'); tableWrap.style.cssText = 'max-height:380px;overflow-y:auto;margin-bottom:12px';
  const table = document.createElement('table'); table.className = 'bom-validate-table';
  table.insertAdjacentHTML('afterbegin', `<thead><tr>
    <th style="width:9%">${_quotRefType === 'sku' ? 'SKU' : 'Part #'}</th><th style="width:34%">Descrição</th>
    <th style="width:5%">Qty</th><th style="width:10%">Preço Unit.</th>
    <th style="width:6%">Desc.%</th>
    <th style="width:10%">Moeda</th><th style="width:13%">ETA</th><th style="width:13%"></th>
  </tr></thead>`);
  const tbody = document.createElement('tbody'); tbody.id = 'quotValTbody'; table.appendChild(tbody);
  tableWrap.appendChild(table);

  // Search bar
  _quotValFilter = '';
  const qSearchWrap = document.createElement('div');
  qSearchWrap.style.cssText = 'position:relative;margin-bottom:8px';
  const qSearchIn = document.createElement('input');
  qSearchIn.type = 'text';
  qSearchIn.placeholder = 'Pesquisar part # ou descrição…';
  qSearchIn.style.cssText = 'width:100%;padding:6px 28px 6px 8px;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);box-sizing:border-box';
  qSearchIn.oninput = function() { _quotValFilter = this.value; renderQuotValTable(); };
  const qClearBtn = document.createElement('button');
  qClearBtn.appendChild(licon('x', 13));
  qClearBtn.setAttribute('aria-label', 'Limpar pesquisa');
  qClearBtn.style.cssText = 'position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;display:flex;align-items:center;padding:0';
  qClearBtn.addEventListener('click', () => { qSearchIn.value = ''; _quotValFilter = ''; renderQuotValTable(); });
  qSearchWrap.appendChild(qSearchIn);
  qSearchWrap.appendChild(qClearBtn);
  el.appendChild(qSearchWrap);
  el.appendChild(tableWrap);

  const btnRow = document.createElement('div'); btnRow.style.cssText = 'margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap';
  const addRowBtn = document.createElement('button'); addRowBtn.className = 'btn btn-ghost btn-sm'; addRowBtn.textContent = '+ Linha'; addRowBtn.addEventListener('click', addQuotRow); btnRow.appendChild(addRowBtn);
  if (rawPdfText) {
    const toggleBtn = document.createElement('button'); toggleBtn.className = 'btn btn-ghost btn-sm'; toggleBtn.textContent = 'Ver texto extraído';
    toggleBtn.addEventListener('click', () => { const raw = document.getElementById('quotRaw'); raw.style.display = raw.style.display === 'none' ? 'block' : 'none'; }); btnRow.appendChild(toggleBtn);
  }
  el.appendChild(btnRow);

  if (rawPdfText) {
    const rawDiv = document.createElement('div'); rawDiv.id = 'quotRaw'; rawDiv.style.cssText = 'display:none;margin-bottom:12px';
    const ta = document.createElement('textarea'); ta.id = 'quotRawTa'; ta.style.cssText = 'width:100%;min-height:100px;max-height:180px;background:#0a0a0a;border:1px solid var(--border);color:var(--muted);font-family:IBM Plex Mono,monospace;font-size:11px;padding:10px;resize:none;border-radius:4px'; ta.readOnly = true; ta.value = rawPdfText;
    rawDiv.appendChild(ta); el.appendChild(rawDiv);
  }

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn btn-ghost'; cancelBtn.textContent = 'Cancelar'; cancelBtn.addEventListener('click', closeModal); actions.appendChild(cancelBtn);
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn btn-primary'; saveBtn.textContent = 'Guardar Cotação'; saveBtn.addEventListener('click', confirmQuotation); actions.appendChild(saveBtn);
  el.appendChild(actions);

  showModalLg(el);
  priceAnomalies = {};
  renderQuotValTable();
  checkPriceAnomalies(pendingQuotItems).then(a => {
    if (Object.keys(a).length) { priceAnomalies = a; renderQuotValTable(); }
  });
}

function renderQuotValTable() {
  const tbody = document.getElementById('quotValTbody');
  if (!tbody) return;
  const _scrollBox = tbody.closest('.modal-box-lg, .modal-box');
  const _savedScroll = _scrollBox ? _scrollBox.scrollTop : 0;
  while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  const hasNonMzn = pendingQuotItems.some(i => i.currency && i.currency !== 'MZN');
  const ratesBlock = document.getElementById('quotRatesBlock');
  if (ratesBlock) ratesBlock.style.display = hasNonMzn ? 'flex' : 'none';
  const _norm = s => (s || '').toLowerCase();
  const _tokens = _norm(_quotValFilter).split(/\s+/).filter(Boolean);

  pendingQuotItems.forEach((item, i) => {
    if (_tokens.length && !_tokens.every(t =>
      _norm(item.raw_part_number).includes(t) || _norm(item.raw_sku).includes(t) || _norm(item.raw_description).includes(t)
    )) return;

    const tr = document.createElement('tr');

    // Part #
    const tdPart = document.createElement('td');
    const inPart = document.createElement('input');
    inPart.type = 'text'; inPart.value = (_quotRefType === 'sku' ? item.raw_sku : item.raw_part_number) || ''; inPart.style.width = '100%';
    inPart.onchange = function() {
      if (_quotRefType === 'sku') { pendingQuotItems[i].raw_sku = this.value || null; }
      else { pendingQuotItems[i].raw_part_number = this.value || null; }
    };
    tdPart.appendChild(inPart);

    // Descrição
    const tdDesc = document.createElement('td');
    const inDesc = document.createElement('input');
    inDesc.type = 'text';
    inDesc.maxLength = MAX_QUOTATION_LINE_DESC;
    inDesc.value = item.raw_description; inDesc.style.width = '100%';
    inDesc.onchange = function() { pendingQuotItems[i].raw_description = this.value; };
    tdDesc.appendChild(inDesc);

    // Qty
    const tdQty = document.createElement('td');
    const inQty = document.createElement('input');
    inQty.type = 'text'; inQty.value = item.quantity; inQty.style.width = '100%';
    inQty.onchange = function() { pendingQuotItems[i].quantity = parseFloat(this.value) || 1; };
    tdQty.appendChild(inQty);

    // Desconto %
    const tdDisc = document.createElement('td');
    const inDisc = document.createElement('input');
    inDisc.type = 'number'; inDisc.min = '0'; inDisc.max = '100'; inDisc.step = '0.1';
    inDisc.value = item.discount ?? 0; inDisc.style.width = '100%';
    inDisc.onchange = function() {
      const d = parseFloat(this.value) || 0;
      pendingQuotItems[i].discount = d;
      pendingQuotItems[i]._discountManual = true;
      const entered = pendingQuotItems[i]._enteredPrice ?? pendingQuotItems[i].price;
      pendingQuotItems[i].price = d > 0 && d < 100
        ? Math.round((entered / (1 - d / 100)) * 100) / 100
        : entered;
      renderQuotValTable();
    };
    tdDisc.appendChild(inDisc);

    // Preço + anomaly badge
    const tdPrice = document.createElement('td');
    const inPrice = document.createElement('input');
    const _displayPrice = item._enteredPrice != null ? item._enteredPrice : item.price;
    inPrice.type = 'text'; inPrice.value = _displayPrice > 0 ? fmtPrice(_displayPrice) : ''; inPrice.style.width = '80px';
    inPrice.oninput = function() { /* allow formatted input — parseNum handles it on change */ };
    inPrice.onchange = function() {
      const entered = parseNum(this.value) || 0;
      pendingQuotItems[i]._enteredPrice = entered;
      const d = pendingQuotItems[i].discount || 0;
      pendingQuotItems[i].price = d > 0 && d < 100
        ? Math.round((entered / (1 - d / 100)) * 100) / 100
        : entered;
      checkPriceAnomalies(pendingQuotItems).then(a => { priceAnomalies = a; renderQuotValTable(); });
    };
    tdPrice.appendChild(inPrice);
    const a = priceAnomalies[i];
    if (a) {
      const badge = document.createElement('span');
      badge.className = a.type === 'high' ? 'anomaly-high' : 'anomaly-low';
      badge.appendChild(licon('alert-triangle', 10));
      badge.appendChild(document.createTextNode('\u00a0' + a.ratio + '\u00d7 ' + (a.type === 'high' ? 'acima' : 'abaixo') + ' (\u00f8' + fmtPrice(a.median) + ')'));
      tdPrice.appendChild(badge);
    }

    // Moeda
    const tdCur = document.createElement('td');
    const sel = document.createElement('select'); sel.style.width = '100%';
    ['MZN','USD','EUR','ZAR'].forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if ((item.currency || 'MZN') === c) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = function() { pendingQuotItems[i].currency = this.value; };
    tdCur.appendChild(sel);

    // ETA
    const tdEta = document.createElement('td'); tdEta.style.cssText = 'white-space:nowrap';
    const etaWrap = document.createElement('div'); etaWrap.style.cssText = 'display:flex;align-items:center;gap:4px';
    const etaIn = document.createElement('input');
    etaIn.type = 'text'; etaIn.placeholder = '—'; etaIn.value = item.eta_value || '';
    etaIn.style.cssText = 'width:48px;padding:3px 5px;font-size:11px;background:var(--surface);border:1px solid var(--border);border-radius:3px;color:var(--text)';
    const etaUnitBtn = document.createElement('button');
    const _etaUnit = item.eta_unit || 'dias';
    etaUnitBtn.textContent = _etaUnit === 'dias' ? 'D' : 'S';
    etaUnitBtn.dataset.unit = _etaUnit;
    etaUnitBtn.style.cssText = 'font-size:10px;padding:2px 5px;background:var(--surface);border:1px solid var(--border);border-radius:3px;color:var(--muted);cursor:pointer;font-family:inherit';
    etaUnitBtn.addEventListener('click', () => {
      const next = etaUnitBtn.dataset.unit === 'dias' ? 'semanas' : 'dias';
      etaUnitBtn.dataset.unit = next;
      etaUnitBtn.textContent = next === 'dias' ? 'D' : 'S';
      pendingQuotItems[i].eta_unit = next;
      pendingQuotItems[i]._etaManual = true;
    });
    etaIn.addEventListener('change', () => { pendingQuotItems[i].eta_value = etaIn.value.trim(); pendingQuotItems[i]._etaManual = true; });
    etaWrap.appendChild(etaIn); etaWrap.appendChild(etaUnitBtn);
    tdEta.appendChild(etaWrap);

    // Actions (\u25b2 \u25bc \u00d7)
    const tdDel = document.createElement('td');
    tdDel.style.cssText = 'display:flex;gap:3px;align-items:center';

    const upBtn = document.createElement('button');
    upBtn.type = 'button'; upBtn.className = 'btn btn-ghost btn-sm'; upBtn.textContent = '\u25b2';
    upBtn.title = 'Mover para cima'; upBtn.style.padding = '3px 6px';
    upBtn.disabled = i === 0;
    if (i === 0) upBtn.style.opacity = '0.25';
    upBtn.onclick = () => { [pendingQuotItems[i-1], pendingQuotItems[i]] = [pendingQuotItems[i], pendingQuotItems[i-1]]; renderQuotValTable(); };

    const downBtn = document.createElement('button');
    downBtn.type = 'button'; downBtn.className = 'btn btn-ghost btn-sm'; downBtn.textContent = '\u25bc';
    downBtn.title = 'Mover para baixo'; downBtn.style.padding = '3px 6px';
    downBtn.disabled = i === pendingQuotItems.length - 1;
    if (i === pendingQuotItems.length - 1) downBtn.style.opacity = '0.25';
    downBtn.onclick = () => { [pendingQuotItems[i], pendingQuotItems[i+1]] = [pendingQuotItems[i+1], pendingQuotItems[i]]; renderQuotValTable(); };

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm'; delBtn.textContent = '\u00d7';
    delBtn.onclick = () => { pendingQuotItems.splice(i, 1); renderQuotValTable(); };

    tdDel.appendChild(upBtn); tdDel.appendChild(downBtn); tdDel.appendChild(delBtn);

    tr.appendChild(tdPart); tr.appendChild(tdDesc); tr.appendChild(tdQty);
    tr.appendChild(tdPrice); tr.appendChild(tdDisc); tr.appendChild(tdCur); tr.appendChild(tdEta); tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  if (_scrollBox) requestAnimationFrame(() => { _scrollBox.scrollTop = _savedScroll; });
}

function addQuotRow() {
  pendingQuotItems.push({ raw_part_number: null, raw_description: '', quantity: 1, price: 0, currency: 'MZN', discount: quotGlobalDiscount, eta_value: quotGlobalEta.value, eta_unit: quotGlobalEta.unit });
  renderQuotValTable();
}

async function confirmQuotation() {
  const valid = pendingQuotItems.filter(i => i.raw_description.trim() && i.price > 0);
  if (!valid.length) { showToast('Adiciona pelo menos um item com preço.', true); return; }
  for (let v = 0; v < valid.length; v++) {
    if (String(valid[v].raw_description).length > MAX_QUOTATION_LINE_DESC) {
      showToast(`Descrição com mais de ${MAX_QUOTATION_LINE_DESC} caracteres (linha ${v + 1} com preço).`, true);
      return;
    }
  }
  try {
    const existingQ = quotationMap[currentQuotSuppId] || [];
    const existingIds = new Set(existingQ.map(e => e.id).filter(Boolean));
    const keepIds = new Set(valid.filter(i => i.id).map(i => i.id));
    const idsToDelete = [...existingIds].filter(id => !keepIds.has(id));
    await API.updateQuotationItems(
      valid.map(i => {
        const { _discountManual, _etaManual, _enteredPrice, ...rest } = i;
        return {
          ...rest,
          supplier_id: currentQuotSuppId,
          raw_description: String(rest.raw_description).slice(0, MAX_QUOTATION_LINE_DESC),
        };
      }),
      idsToDelete
    );
    quotationMap[currentQuotSuppId] = await API.getQuotationItems(currentQuotSuppId);

    // Persist last_ref_type on global supplier
    const _suppName = suppliers.find(s => s.id === currentQuotSuppId)?.name;
    if (_suppName) {
      try { await API.updateGlobalSupplierRefType(_suppName, _quotRefType); } catch(_) {}
      const _gsRef = globalSuppliersList.find(g => g.name.trim().toLowerCase() === _suppName.trim().toLowerCase());
      if (_gsRef) _gsRef.last_ref_type = _quotRefType;
    }

    // Save or clear exchange rates on the supplier record
    const hasNonMzn = valid.some(i => i.currency && i.currency !== 'MZN');
    const rateFields = hasNonMzn ? {
      cambio:    parseFloat(document.getElementById('qf_cambio')?.value) || null,
      transport: parseFloat(document.getElementById('qf_transport')?.value) || null,
      direitos:  parseFloat(document.getElementById('qf_direitos')?.value) || 0,
    } : { cambio: null, transport: null, direitos: 0 };
    await API.updateSupplier(currentQuotSuppId, rateFields);
    const suppIdx = suppliers.findIndex(s => s.id === currentQuotSuppId);
    if (suppIdx !== -1) Object.assign(suppliers[suppIdx], rateFields);

    if (pendingQuotFile) {
      const ext = pendingQuotFile.name.split('.').pop();
      const filePath = `quotations/${currentQuotSuppId}/${Date.now()}.${ext}`;
      await API.uploadFile('procurement-files', filePath, pendingQuotFile);
      await API.saveQuotationFile(currentQuotSuppId, filePath, pendingQuotFile.name);
      quotationFilesMap[currentQuotSuppId] = { file_path: filePath, original_name: pendingQuotFile.name };
      pendingQuotFile = null;
    }

    // Populate savedAnomalyMap for supplier card display
    // Match by ID (existing items) or by description (new items) — NOT by index (order may differ after upsert)
    const savedItems = quotationMap[currentQuotSuppId] || [];
    const anomalyCount = Object.keys(priceAnomalies).length;
    if (anomalyCount) {
      const savedByDesc = {};
      savedItems.forEach(s => { if (s.raw_description) savedByDesc[s.raw_description.trim().toLowerCase()] = s; });
      valid.forEach((item, idx) => {
        if (!priceAnomalies[idx]) return;
        const savedId = item.id || savedByDesc[item.raw_description?.trim().toLowerCase()]?.id;
        if (savedId) savedAnomalyMap[savedId] = priceAnomalies[idx];
      });
    }

    closeModal();
    if (anomalyCount) {
      const el = document.getElementById('toast');
      el.textContent = `Cotação guardada. ${anomalyCount} item(ns) com preço fora do histórico — verifica os valores.`;
      el.style.color = '#fb923c';
      el.style.borderLeftColor = '#fb923c';
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 4500);
    } else {
      showToast(`${valid.length} itens de cotação guardados.`);
    }
    renderSuppliers();
    await loadMatchData();
    renderMatchingTab();
  } catch(e) { showToast('Erro: ' + e.message, true); }
}

// ── File View (Quotation) ──
async function viewQuotFile(filePath) {
  if (!_isValidFilePath(filePath)) { showToast('Caminho de ficheiro inválido.', true); return; }
  try {
    const url = await API.getSignedUrl('procurement-files', filePath);
    window.open(url, '_blank');
  } catch(e) { showToast('Erro ao abrir ficheiro.', true); }
}

// ── PDF Quotation (ported from planilha-generator) ──
async function extractPdfText(ab){
  const pdf=await pdfjsLib.getDocument({data:ab}).promise;let ft='';
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);const content=await page.getTextContent();
    const lm=new Map();
    for(const item of content.items){if(!item.str.trim())continue;const y=Math.round(item.transform[5]/3)*3;if(!lm.has(y))lm.set(y,[]);lm.get(y).push({x:item.transform[4],w:item.width||0,text:item.str});}
    const sy=[...lm.keys()].sort((a,b)=>b-a);
    for(const y of sy){const cells=lm.get(y).sort((a,b)=>a.x-b.x);let line='',pr=null;for(const cell of cells){if(pr!==null){const g=cell.x-pr;line+=g>8?'\t':(g>0.5?' ':'');}line+=cell.text;pr=cell.x+(cell.w||cell.text.length*5);}if(line.trim())ft+=line+'\n';}
    ft+='\n';
  }
  return ft;
}
function parseNum(s){const t=s.trim().replace(/\s/g,'');if(/,\d+$/.test(t)&&t.lastIndexOf(',')>t.lastIndexOf('.'))return parseFloat(t.replace(/\./g,'').replace(',','.'));if(/\.\d+$/.test(t)&&t.lastIndexOf('.')>t.lastIndexOf(','))return parseFloat(t.replace(/,/g,''));return parseFloat(t.replace(/[,.]/g,''));}
function parsePdf(text){
  const SKIP=/^(total|subtotal|grand total|vat|iva|tax|date|page|invoice|quotation|quote|ref|description|qty|quantity|unit price|unit|price|amount|s\.?no\.?|nr\.?|from|to|tel|email|www|http)/i;
  const items=[];
  for(const raw of text.split('\n')){
    const line=raw.trim();if(line.length<4)continue;if(SKIP.test(line))continue;if(!/[a-zA-Z]/.test(line))continue;if(!/\d/.test(line))continue;
    const cols=line.split('\t').map(c=>c.trim()).filter(c=>c.length>0);if(cols.length<2)continue;
    const UR=/\b(UN|MT|M|PC|KG|L|UNID|PÇ|PCS|CX|RL|ROL|ML|CM|G|T|HR|H)\b/i;
    let qty='1',qci=-1,price='';const nc=[];
    for(let i=0;i<cols.length;i++){const c=cols[i];if(c.includes('%'))continue;const m=c.match(/^([\d.,]+(?:\s[\d.,]+)*)\s*([A-Za-z].*)?$/);if(!m)continue;const np=m[1].trim();const sf=(m[2]||'').trim();const v=parseNum(np);if(isNaN(v)||v<=0)continue;if(sf&&UR.test(sf.split(/\s/)[0])){if(qci===-1){qty=String(Math.round(v));qci=i;}}else{nc.push({i,c,v});}}
    if(!nc.length)continue;const pe=nc[nc.length-1];price=String(pe.v);
    if(qci===-1){for(const n of nc){if(n.i===pe.i)continue;const r=Math.round(n.v);if(r>=1&&r<=9999){qty=String(r);qci=n.i;break;}}}
    const ei=new Set([qci,...nc.map(n=>n.i)]);
    const dc=cols.filter((c,i)=>{if(ei.has(i))return false;if(c.includes('%'))return false;if(UR.test(c.trim())&&!/[a-zA-Z]{4,}/.test(c))return false;return true;});
    if(!dc.length)continue;
    let part='',model=dc.join(' ');
    // Recover reference from cols[0] if it was classified as numeric but looks like a catalog code
    const fc=cols[0];
    if(fc&&ei.has(0)&&!/\s/.test(fc)&&fc.length>=4&&((/\d/.test(fc)&&/[A-Za-z]/.test(fc))||/^\d{5,}$/.test(fc)||/^\d{2,}\.\d{4,}$/.test(fc))){part=fc;}
    const fd=dc[0];
    if(!part){const lr=!/\s/.test(fd)&&fd.length>=4&&((/\d/.test(fd)&&/[A-Za-z]/.test(fd))||/^\d{4,}$/.test(fd));if(lr&&dc.length>1){part=fd;model=dc.slice(1).join(' ').trim();if(model.length<2){model=dc.join(' ');part='';}}}
    if(!model||model.length<2)continue;
    items.push({part,model,qty,price});
  }
  return items;
}
async function handlePdfQuotation(file) {
  if (!window.pdfjsLib) { showToast('PDF.js não carregou.', true); return; }
  try {
    const buf = await file.arrayBuffer();
    const rawText = await extractPdfText(buf);
    const parsed = parsePdf(rawText);
    // PDF price = total; convert to unit price
    const newPdfItems = parsed.map(item => {
      const qty = parseFloat(item.qty) || 1;
      const total = parseFloat(item.price) || 0;
      const unitPrice = total > 0 ? Math.round((total / qty) * 100) / 100 : 0;
      return { raw_part_number: item.part || null, raw_description: item.model, quantity: qty, price: unitPrice, currency: 'MZN', discount: 0, _enteredPrice: unitPrice };
    });
    if (!newPdfItems.length) showToast('Nenhum item detetado no PDF — adiciona manualmente.', true);
    const existingPdf = (quotationMap[currentQuotSuppId] || []).map(qi => ({
      id: qi.id,
      raw_part_number: qi.raw_part_number || null,
      raw_sku: qi.raw_sku || null,
      raw_description: qi.raw_description,
      quantity: qi.quantity,
      price: qi.price,
      currency: qi.currency,
    }));
    if (existingPdf.length && newPdfItems.length) {
      _askReplaceOrAppend(existingPdf, newPdfItems,
        () => { pendingQuotItems = _carryIds(existingPdf, newPdfItems); openQuotationValModal(file.name, rawText); },
        () => { pendingQuotItems = [...existingPdf, ...newPdfItems]; openQuotationValModal(file.name, rawText); }
      );
    } else {
      pendingQuotItems = newPdfItems;
      openQuotationValModal(file.name, rawText);
    }
  } catch(e) { showToast('Erro ao ler PDF: ' + e.message, true); }
}
