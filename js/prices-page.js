let activeDays = 30;
let lastQuery = '';
let lastResults = [];
let filterMatchedOnly = false;

document.addEventListener('DOMContentLoaded', () => {
  const backLink = document.querySelector('.back-link');
  if (backLink) backLink.addEventListener('click', () => { window.location.href = 'dashboard.html'; });

  document.getElementById('searchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch();
  });

  document.getElementById('clearBtn').addEventListener('click', clearSearch);

  document.querySelector('.search-bar .btn-primary').addEventListener('click', doSearch);

  document.getElementById('filterMatchBtn').addEventListener('click', function() {
    filterMatchedOnly = !filterMatchedOnly;
    this.classList.toggle('active', filterMatchedOnly);
    const toRender = filterMatchedOnly ? lastResults.filter(r => r.item_matches?.[0]?.bom_items) : lastResults;
    renderResults(toRender, lastQuery);
  });

  document.querySelectorAll('.date-chip').forEach(chip => {
    chip.addEventListener('click', function() {
      setDateChip(this, parseInt(this.dataset.days, 10));
    });
  });
});

window.addEventListener('load', async () => {
  await requireAuth('index.html');
  if (hasRole('commercial')) { window.location.href = 'dashboard.html'; return; }
  mountSidebar(document.getElementById('appSidebar'));
  document.getElementById('searchInput').addEventListener('input', () => {
    document.getElementById('clearBtn').style.display = document.getElementById('searchInput').value ? '' : 'none';
  });
});

function setDateChip(el, days) {
  document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeDays = days;
  if (lastQuery !== '') doSearch();
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('clearBtn').style.display = 'none';
  lastQuery = '';
  document.getElementById('resultsInfo').textContent = '';
  const area = document.getElementById('resultsArea');
  area.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'empty-search';
  const ic = document.createElement('div');
  ic.className = 'icon';
  ic.textContent = '\u{1F50D}';
  const msg = document.createElement('div');
  msg.className = 'msg';
  msg.textContent = 'Pesquisa por material, equipamento ou referência.';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Usa palavras-chave — não precisas do nome exato.';
  wrap.appendChild(ic);
  wrap.appendChild(msg);
  wrap.appendChild(hint);
  area.appendChild(wrap);
}

async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  lastQuery = q;

  let dateFrom = null;
  if (activeDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() - activeDays);
    dateFrom = d.toISOString();
  }

  const info = document.getElementById('resultsInfo');
  info.textContent = 'A pesquisar\u2026';
  document.getElementById('resultsArea').replaceChildren();

  try {
    const results = await API.searchPriceHistory(q, dateFrom);
    lastResults = results;
    const toRender = filterMatchedOnly ? results.filter(r => r.item_matches?.[0]?.bom_items) : results;
    renderResults(toRender, q);
  } catch(e) {
    info.textContent = '';
    const area = document.getElementById('resultsArea');
    area.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'empty-search';
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.style.color = 'var(--danger)';
    msg.textContent = e.message;
    wrap.appendChild(msg);
    area.appendChild(wrap);
  }
}

function appendHighlightedDesc(el, text, query) {
  if (!query || !query.trim()) {
    el.textContent = text || '';
    return;
  }
  const s = text || '';
  const safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(' + safeQ.replace(/ /g, '|') + ')', 'gi');
  let last = 0;
  s.replace(re, (match, _g, offset) => {
    if (offset > last) el.appendChild(document.createTextNode(s.slice(last, offset)));
    const span = document.createElement('span');
    span.className = 'search-highlight';
    span.textContent = match;
    el.appendChild(span);
    last = offset + match.length;
  });
  if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
}

function renderResults(data, query) {
  const info = document.getElementById('resultsInfo');
  const area = document.getElementById('resultsArea');
  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 86400000);

  if (!data.length) {
    info.textContent = '';
    area.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'empty-search';
    const ic = document.createElement('div');
    ic.className = 'icon';
    ic.textContent = '\u{1F4ED}';
    const msg = document.createElement('div');
    msg.className = 'msg';
    if (query) {
      msg.appendChild(document.createTextNode('Sem resultados para "'));
      const strong = document.createElement('strong');
      strong.style.color = '#fff';
      strong.textContent = query;
      msg.appendChild(strong);
      msg.appendChild(document.createTextNode('" neste período.'));
    } else {
      msg.textContent = 'Sem resultados neste período.';
    }
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Tenta alargar o intervalo de datas ou usar outras palavras-chave.';
    wrap.appendChild(ic);
    wrap.appendChild(msg);
    wrap.appendChild(hint);
    area.appendChild(wrap);
    return;
  }

  info.textContent = data.length + ' resultado' + (data.length !== 1 ? 's' : '') + (query ? ' para "' + query + '"' : '');

  const scroll = document.createElement('div');
  scroll.style.overflowX = 'auto';
  const table = document.createElement('table');
  table.className = 'price-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['Descri\u00e7\u00e3o', 'Fornecedor', 'Processo', 'Pre\u00e7o', 'Data'].forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (i === 3) th.style.textAlign = 'right';
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  for (const row of data) {
    const supplier = row.suppliers;
    const proc = supplier?.processes;
    const isRecent = row.created_at && new Date(row.created_at) >= thirtyDaysAgo;
    const procId = proc?.id;
    const tr = document.createElement('tr');
    const tdDesc = document.createElement('td');
    const bomItem = row.item_matches?.[0]?.bom_items;
    const displayDesc = bomItem?.custom_description || bomItem?.description || row.raw_description || '';
    const supplierDesc = row.raw_description || '';
    const descDiv = document.createElement('div');
    descDiv.className = 'price-desc';
    appendHighlightedDesc(descDiv, displayDesc, query);
    if (bomItem) {
      const badge = document.createElement('span');
      badge.className = 'badge-bom';
      badge.textContent = 'BOM';
      descDiv.appendChild(badge);
    }
    tdDesc.appendChild(descDiv);
    if (supplierDesc && supplierDesc.trim() !== displayDesc.trim()) {
      const sub = document.createElement('div');
      sub.className = 'price-raw';
      appendHighlightedDesc(sub, supplierDesc, query);
      tdDesc.appendChild(sub);
    }
    const tdSupp = document.createElement('td');
    const supSpan = document.createElement('span');
    supSpan.className = 'price-supplier';
    supSpan.textContent = supplier?.name || '\u2014';
    tdSupp.appendChild(supSpan);
    const tdProc = document.createElement('td');
    if (procId) {
      const a = document.createElement('a');
      a.className = 'price-process';
      a.href = 'process.html?id=' + procId;
      a.textContent = (proc.project_name || '') + (proc.client_name ? ' \u00b7 ' + proc.client_name : '');
      tdProc.appendChild(a);
    } else {
      const sp = document.createElement('span');
      sp.style.color = '#334';
      sp.textContent = '\u2014';
      tdProc.appendChild(sp);
    }
    const tdPrice = document.createElement('td');
    tdPrice.style.textAlign = 'right';
    const amt = document.createElement('span');
    amt.className = 'price-amount';
    amt.textContent = fmtPrice(row.price);
    const cur = document.createElement('span');
    cur.className = 'price-currency';
    cur.textContent = row.currency || '';
    tdPrice.appendChild(amt);
    tdPrice.appendChild(cur);
    const tdDate = document.createElement('td');
    const dspan = document.createElement('span');
    dspan.className = 'price-date';
    dspan.textContent = fmtDate(row.created_at);
    const badge = document.createElement('span');
    badge.className = isRecent ? 'badge-fresh' : 'badge-old';
    badge.textContent = isRecent ? 'RECENTE' : 'ANTIGO';
    tdDate.appendChild(dspan);
    tdDate.appendChild(document.createTextNode(' '));
    tdDate.appendChild(badge);
    tr.appendChild(tdDesc);
    tr.appendChild(tdSupp);
    tr.appendChild(tdProc);
    tr.appendChild(tdPrice);
    tr.appendChild(tdDate);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  area.replaceChildren();
  area.appendChild(scroll);
}

function fmtDate(d) { if (!d) return '\u2014'; return new Date(d).toLocaleDateString('pt-PT'); }
function fmtPrice(p) {
  if (p == null || p === '') return '\u2014';
  let n;
  if (typeof p === 'number') { n = p; }
  else {
    const t = String(p).trim().replace(/\s/g, '');
    if (/,\d+$/.test(t) && t.lastIndexOf(',') > t.lastIndexOf('.'))
      n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    else if (/\.\d+$/.test(t) && t.lastIndexOf('.') > t.lastIndexOf(','))
      n = parseFloat(t.replace(/,/g, ''));
    else
      n = parseFloat(t.replace(/[,.]/g, ''));
  }
  if (isNaN(n)) return '\u2014';
  const parts = n.toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '.' + parts[1];
}
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : 'var(--text)';
  el.style.borderLeftColor = isError ? 'var(--danger)' : 'var(--accent)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3200);
}
