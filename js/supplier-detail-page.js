function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function showToast(msg,isErr){const t=document.getElementById('toast');t.textContent=msg;t.className='toast'+(isErr?' toast-error':' toast-success')+' show';setTimeout(()=>t.className='toast',3000);}
function formatResponseTime(h){if(!h||h<=0)return '—';return h<24?Math.round(h)+'h':(h/24).toFixed(1)+' dias';}
function fmtDate(d){if(!d)return '—';return new Date(d).toLocaleDateString('pt-PT',{day:'2-digit',month:'short',year:'numeric'});}
function fmtPrice(p,cur){if(!p&&p!==0)return '—';return Number(p).toLocaleString('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2})+' '+(cur||'MZN');}

function computeTrend(items){
  const now=new Date();
  const thisStart=new Date(now.getFullYear(),now.getMonth(),1);
  const prevStart=new Date(now.getFullYear(),now.getMonth()-1,1);
  const priced=items.filter(i=>i.price>0);
  const thisM=priced.filter(i=>new Date(i.created_at)>=thisStart);
  const prevM=priced.filter(i=>{const d=new Date(i.created_at);return d>=prevStart&&d<thisStart;});
  if(!thisM.length||!prevM.length)return null;
  const avg=arr=>arr.reduce((s,i)=>s+Number(i.price),0)/arr.length;
  const tA=avg(thisM),pA=avg(prevM);
  return{thisAvg:tA,prevAvg:pA,change:((tA-pA)/pA)*100,cur:thisM[0].currency||'MZN'};
}

function mkTh(text){const th=document.createElement('th');th.textContent=text;return th;}
function mkTd(content,cls){const td=document.createElement('td');if(cls)td.className=cls;if(typeof content==='string')td.textContent=content;else if(content)td.appendChild(content);return td;}
function mkTable(headers){
  const tbl=document.createElement('table');tbl.className='data-table';
  const thead=document.createElement('thead');const tr=document.createElement('tr');
  headers.forEach(h=>tr.appendChild(mkTh(h)));thead.appendChild(tr);tbl.appendChild(thead);
  const tbody=document.createElement('tbody');tbl.appendChild(tbody);
  return{tbl,tbody};
}

document.addEventListener('DOMContentLoaded', () => {
  const backLink = document.querySelector('.back-link');
  if (backLink) backLink.addEventListener('click', () => { window.location.href = 'suppliers.html'; });
});

window.addEventListener('load',async()=>{
  if(hasRole('commercial')){window.location.href='dashboard.html';return;}
  await requireAuth('index.html');
  mountSidebar(document.getElementById('appSidebar'));
  const params=new URLSearchParams(location.search);
  const name=params.get('name');
  if(!name){window.location.href='suppliers.html';return;}
  try{await loadDetail(name);}
  catch(e){
    const main=document.getElementById('mainContent');
    while(main.firstChild)main.removeChild(main.firstChild);
    const msg=document.createElement('div');msg.className='empty-msg';msg.style.color='var(--danger)';
    msg.textContent='Erro: '+e.message;main.appendChild(msg);
  }
});

async function loadDetail(name){
  const[globalList,processHistory]=await Promise.all([API.getGlobalSuppliers(),API.getSupplierProcessHistory(name)]);
  const gs=globalList.find(g=>g.name.trim().toLowerCase()===name.trim().toLowerCase());
  const supplierIds=processHistory.map(s=>s.id);
  const processIds=processHistory.map(s=>s.process_id);
  const[quotItems,bomCatMap]=await Promise.all([
    API.getSupplierQuotationHistory(supplierIds),
    API.getBomCategoriesByProcessIds(processIds),
  ]);
  const qCountById={};
  quotItems.forEach(qi=>{qCountById[qi.supplier_id]=(qCountById[qi.supplier_id]||0)+1;});
  const isForeign=processHistory.some(s=>s.is_foreign);
  renderPage(name,gs,processHistory,quotItems,bomCatMap,qCountById,isForeign);
}

function renderPage(name,gs,processHistory,quotItems,bomCatMap,qCountById,isForeign){
  const main=document.getElementById('mainContent');
  while(main.firstChild)main.removeChild(main.firstChild);

  // ── Header ──
  const header=document.createElement('div');header.className='supplier-header';
  const nameEl=document.createElement('div');nameEl.className='supplier-name';nameEl.textContent=gs?.name||name;
  header.appendChild(nameEl);
  if(gs?.email||gs?.email_cc){
    const emailEl=document.createElement('div');emailEl.className='supplier-email';
    emailEl.textContent=(gs.email||'')+(gs.email_cc?'  ·  cc: '+gs.email_cc:'');
    header.appendChild(emailEl);
  }
  const tagsRow=document.createElement('div');tagsRow.className='supplier-tags';
  if(isForeign){const c=document.createElement('span');c.className='chip chip-foreign';c.textContent='ESTRANGEIRO';tagsRow.appendChild(c);}
  (gs?.categories||[]).forEach(c=>{const s=document.createElement('span');s.className='chip';s.textContent=c;tagsRow.appendChild(s);});
  (gs?.brands||[]).forEach(b=>{const s=document.createElement('span');s.className='chip chip-brand';s.textContent=b;tagsRow.appendChild(s);});
  if(tagsRow.children.length)header.appendChild(tagsRow);
  if(gs?.notes){const n=document.createElement('div');n.className='notes-row';n.textContent=gs.notes;header.appendChild(n);}
  main.appendChild(header);

  // ── Finance info ──
  if(gs){
    const finSec=document.createElement('div');finSec.className='finance-section';

    const etaField=document.createElement('div');etaField.className='finance-field';
    const etaLabel=document.createElement('div');etaLabel.className='finance-label';etaLabel.textContent='ETA / Entrega';
    const etaVal=document.createElement('div');etaVal.className='finance-value';
    etaVal.textContent=gs.eta_condition==='after_order'?'Após Encomenda':gs.eta_condition==='after_payment'?'Após Pagamento':'Não definido';
    if(!gs.eta_condition)etaVal.style.color='var(--muted)';
    etaField.appendChild(etaLabel);etaField.appendChild(etaVal);

    const accField=document.createElement('div');accField.className='finance-field';
    const accLabel=document.createElement('div');accLabel.className='finance-label';accLabel.textContent='Conta';
    const accBadge=document.createElement('span');
    if(gs.account_status==='open'){accBadge.className='finance-badge open';accBadge.textContent='Aberta';}
    else if(gs.account_status==='blocked'){accBadge.className='finance-badge blocked';accBadge.textContent='Bloqueada';}
    else{accBadge.className='finance-badge unknown';accBadge.textContent='Não definida';}
    accField.appendChild(accLabel);accField.appendChild(accBadge);

    const creditField=document.createElement('div');creditField.className='finance-field';
    const creditLabel=document.createElement('div');creditLabel.className='finance-label';creditLabel.textContent='Crédito';
    const creditBadge=document.createElement('span');
    if(gs.has_credit===true){creditBadge.className='finance-badge open';creditBadge.textContent='Sim';}
    else if(gs.has_credit===false){creditBadge.className='finance-badge blocked';creditBadge.textContent='Não';}
    else{creditBadge.className='finance-badge unknown';creditBadge.textContent='Não definido';}
    creditField.appendChild(creditLabel);creditField.appendChild(creditBadge);

    finSec.appendChild(etaField);finSec.appendChild(accField);finSec.appendChild(creditField);

    if(hasRole('finance','admin')){
      const editBtn=document.createElement('button');editBtn.type='button';editBtn.className='btn btn-ghost btn-sm finance-edit-btn';
      const ico=document.createElement('i');ico.setAttribute('data-lucide','pencil');editBtn.appendChild(ico);
      editBtn.appendChild(document.createTextNode(' Editar'));
      editBtn.addEventListener('click',()=>_openFinanceModal(gs,finSec));
      finSec.appendChild(editBtn);
    }
    main.appendChild(finSec);
  }

  // ── Stats ──
  const statsEl=document.createElement('div');statsEl.className='stats-strip';
  const _respSamples=processHistory.filter(s=>s.contacted_at&&s.replied_at).map(s=>(new Date(s.replied_at)-new Date(s.contacted_at))/3600000).filter(h=>h>0&&h<8760);
  const _avgHours=_respSamples.length?_respSamples.reduce((a,b)=>a+b,0)/_respSamples.length:0;
  const statsData=[
    {label:'Processos',value:processHistory.length,sub:'aparições'},
    {label:'Itens cotados',value:quotItems.length,sub:'total'},
    {label:'Tempo médio',value:_avgHours>0?formatResponseTime(_avgHours):'—',sub:_respSamples.length?'n='+_respSamples.length+' amostras':'sem dados'},
    {label:'Categorias',value:(gs?.categories||[]).length,sub:'cobertas'},
    {label:'Marcas',value:(gs?.brands||[]).length,sub:'registadas'},
  ];
  statsData.forEach(sd=>{
    const card=document.createElement('div');card.className='stat-card';
    const lbl=document.createElement('div');lbl.className='stat-label';lbl.textContent=sd.label;
    const val=document.createElement('div');val.className='stat-value';val.textContent=sd.value;
    const sub=document.createElement('div');sub.className='stat-sub';sub.textContent=sd.sub;
    card.appendChild(lbl);card.appendChild(val);card.appendChild(sub);statsEl.appendChild(card);
  });
  main.appendChild(statsEl);

  // ── Response time per category ──
  const respSec=document.createElement('div');respSec.className='section-wrap';
  const respTitle=document.createElement('div');respTitle.className='section-title';respTitle.textContent='Tempo de Resposta por Categoria';
  respSec.appendChild(respTitle);
  const catRespSamples={};
  processHistory.forEach(s=>{
    if(!s.contacted_at||!s.replied_at)return;
    const hours=(new Date(s.replied_at)-new Date(s.contacted_at))/3600000;
    if(hours<=0||hours>=8760)return;
    const cats=bomCatMap[s.process_id];
    if(cats&&cats.size){cats.forEach(cat=>{if(!catRespSamples[cat])catRespSamples[cat]=[];catRespSamples[cat].push(hours);});}
    else{if(!catRespSamples['Sem categoria'])catRespSamples['Sem categoria']=[];catRespSamples['Sem categoria'].push(hours);}
  });
  const catRespEntries=Object.entries(catRespSamples).sort((a,b)=>{
    const avgA=a[1].reduce((s,h)=>s+h,0)/a[1].length;
    const avgB=b[1].reduce((s,h)=>s+h,0)/b[1].length;
    return avgA-avgB;
  });
  if(!catRespEntries.length){
    const em=document.createElement('div');em.className='empty-msg';em.textContent='Sem dados de resposta registados ainda.';respSec.appendChild(em);
  } else {
    const{tbl,tbody}=mkTable(['Categoria','Tempo Médio','Amostras']);
    catRespEntries.forEach(([cat,samples])=>{
      const avg=samples.reduce((s,h)=>s+h,0)/samples.length;
      const tr=document.createElement('tr');
      const badge=document.createElement('span');badge.className='resp-time-badge';badge.textContent='~'+formatResponseTime(avg);
      const nEl=document.createElement('span');nEl.className='mono-sm';nEl.textContent=samples.length<2?samples.length+' (poucos dados)':String(samples.length);
      tr.appendChild(mkTd(cat));tr.appendChild(mkTd(badge));tr.appendChild(mkTd(nEl));
      tbody.appendChild(tr);
    });
    respSec.appendChild(tbl);
  }
  main.appendChild(respSec);

  // ── Prices per category ──
  const priceSec=document.createElement('div');priceSec.className='section-wrap';
  const priceTitleRow=document.createElement('div');priceTitleRow.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:8px';
  const priceTitle=document.createElement('div');priceTitle.className='section-title';priceTitle.style.cssText='margin-bottom:0;border-bottom:none;padding-bottom:0';priceTitle.textContent='Análise de Preços por Categoria';

  // Time filter
  let _periodMonths=1;
  const filterWrap=document.createElement('div');filterWrap.style.cssText='display:flex;gap:4px';
  const _periodLabels=[['1M',1],['3M',3],['6M',6],['1A',12],['Todos',0]];
  const _filterBtns=[];
  function _applyPeriodFilter(){
    const cutoff=_periodMonths>0?new Date(Date.now()-_periodMonths*30*24*3600*1000):null;
    const filtered=cutoff?quotItems.filter(qi=>new Date(qi.created_at)>=cutoff):quotItems;
    _renderPriceGroups(filtered);
    _filterBtns.forEach(([btn,m])=>{
      btn.style.background=m===_periodMonths?'var(--accent)':'var(--surface)';
      btn.style.color=m===_periodMonths?'#fff':'var(--muted)';
    });
  }
  _periodLabels.forEach(([label,months])=>{
    const btn=document.createElement('button');
    btn.textContent=label;
    btn.style.cssText='font-family:"DM Mono",monospace;font-size:10px;padding:2px 8px;border:1px solid var(--border);border-radius:3px;cursor:pointer;transition:.15s';
    btn.addEventListener('click',()=>{_periodMonths=months;_applyPeriodFilter();});
    _filterBtns.push([btn,months]);
    filterWrap.appendChild(btn);
  });
  priceTitleRow.appendChild(priceTitle);priceTitleRow.appendChild(filterWrap);
  priceSec.appendChild(priceTitleRow);

  const priceBody=document.createElement('div');priceBody.id='priceBody';
  priceSec.appendChild(priceBody);

  function _renderPriceGroups(items){
    while(priceBody.firstChild)priceBody.removeChild(priceBody.firstChild);
    if(!items.length){
      const em=document.createElement('div');em.className='empty-msg';em.textContent='Sem cotações neste período.';priceBody.appendChild(em);return;
    }
    const itemsByCat={};
    const catDisplayNames={};
    items.forEach(qi=>{
      const matches=qi.item_matches||[];
      const cats=matches.map(m=>m.bom_items?.category).filter(Boolean);
      const freq={};cats.forEach(c=>{freq[c]=(freq[c]||0)+1;});
      const raw=(cats.length?Object.keys(freq).sort((a,b)=>freq[b]-freq[a]||a.localeCompare(b))[0]:'Sem categoria').trim()||'Sem categoria';
      const catKey=raw.toLowerCase();
      if(!itemsByCat[catKey]){itemsByCat[catKey]=[];catDisplayNames[catKey]=raw;}
      itemsByCat[catKey].push(qi);
    });
    const sortedCats=Object.keys(itemsByCat).sort((a,b)=>a==='sem categoria'?1:b==='sem categoria'?-1:a.localeCompare(b));
    sortedCats.forEach(cat=>{
      const catItems=itemsByCat[cat].slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
      const group=document.createElement('div');group.className='price-group';
      const groupTitle=document.createElement('div');groupTitle.className='price-group-title';
      const titleText=document.createElement('span');titleText.textContent=catDisplayNames[cat];
      const countChip=document.createElement('span');countChip.className='count-chip';countChip.textContent=catItems.length+' itens';
      groupTitle.appendChild(titleText);groupTitle.appendChild(countChip);group.appendChild(groupTitle);
      const{tbl,tbody}=mkTable(['Descrição','Part #','Preço','Data','Processo']);
      tbl.className='data-table';
      catItems.forEach(qi=>{
        const proc=qi.suppliers?.processes;
        const tr=document.createElement('tr');

        // Descrição: supplier em cima, BOM abaixo em muted
        const descTd=document.createElement('td');
        const suppDescEl=document.createElement('div');suppDescEl.textContent=qi.raw_description||'—';
        descTd.appendChild(suppDescEl);
        const bomItem=qi.item_matches?.[0]?.bom_items;
        const bomDesc=bomItem?.custom_description||bomItem?.description;
        if(bomDesc&&bomDesc!==qi.raw_description){
          const bomDescEl=document.createElement('div');
          bomDescEl.style.cssText='font-size:10px;color:var(--muted);margin-top:2px;font-style:italic';
          bomDescEl.textContent=bomDesc;
          descTd.appendChild(bomDescEl);
        }

        const partTd=document.createElement('td');partTd.className='mono-sm';partTd.textContent=qi.raw_part_number||'—';
        const priceSpan=document.createElement('span');priceSpan.className='price-val';priceSpan.textContent=fmtPrice(qi.price,qi.currency);
        const dateTd=document.createElement('td');dateTd.className='mono-sm';dateTd.textContent=fmtDate(qi.created_at);
        const procTd=document.createElement('td');
        if(proc){const a=document.createElement('a');a.className='proc-link';a.href='process.html?id='+proc.id;a.textContent=proc.project_name+(proc.client_name?' / '+proc.client_name:'');procTd.appendChild(a);}
        else procTd.textContent='—';
        tr.appendChild(descTd);tr.appendChild(partTd);tr.appendChild(mkTd(priceSpan));tr.appendChild(dateTd);tr.appendChild(procTd);
        tbody.appendChild(tr);
      });
      group.appendChild(tbl);
      const trend=computeTrend(catItems);
      const trendBar=document.createElement('div');trendBar.className='trend-bar';
      if(trend){
        const arrow=trend.change>1?'↑':trend.change<-1?'↓':'→';
        const cls=trend.change>1?'trend-up':trend.change<-1?'trend-down':'trend-neutral';
        const s1=document.createElement('span');s1.textContent='Este mês: ';
        const v1=document.createElement('strong');v1.style.color='#fff';v1.textContent=fmtPrice(trend.thisAvg,trend.cur);s1.appendChild(v1);
        const s2=document.createElement('span');s2.textContent='Mês anterior: ';
        const v2=document.createElement('strong');v2.style.color='#fff';v2.textContent=fmtPrice(trend.prevAvg,trend.cur);s2.appendChild(v2);
        const s3=document.createElement('span');s3.className=cls;s3.textContent=arrow+' '+Math.abs(trend.change).toFixed(1)+'%';
        trendBar.appendChild(s1);trendBar.appendChild(s2);trendBar.appendChild(s3);
      } else {
        trendBar.textContent='Dados insuficientes para tendência mensal.';
      }
      group.appendChild(trendBar);
      priceBody.appendChild(group);
    });
  }

  if(!quotItems.length){
    const em=document.createElement('div');em.className='empty-msg';em.textContent='Sem cotações registadas para este fornecedor.';priceBody.appendChild(em);
  } else {
    _applyPeriodFilter();
  }
  main.appendChild(priceSec);

  // ── Process history ──
  const procSec=document.createElement('div');procSec.className='section-wrap';
  const procTitle=document.createElement('div');procTitle.className='section-title';procTitle.textContent='Histórico de Processos';
  procSec.appendChild(procTitle);
  if(!processHistory.length){
    const em=document.createElement('div');em.className='empty-msg';em.textContent='Nenhum processo encontrado.';procSec.appendChild(em);
  } else {
    const{tbl,tbody}=mkTable(['Projeto / Cliente','Estado Processo','Estado Fornecedor','Data','Itens','Extra']);
    processHistory.forEach(s=>{
      const proc=s.processes;
      const tr=document.createElement('tr');
      const projTd=document.createElement('td');
      const a=document.createElement('a');a.className='proc-link';a.href='process.html?id='+proc.id;
      a.textContent=proc.project_name+(proc.client_name?' / '+proc.client_name:'');projTd.appendChild(a);
      const procStatusTd=document.createElement('td');procStatusTd.className='mono-sm';procStatusTd.textContent=proc.status||'—';
      const suppStatusTd=document.createElement('td');suppStatusTd.style.fontSize='12px';suppStatusTd.textContent=s.status||'—';
      const dateTd=document.createElement('td');dateTd.className='mono-sm';dateTd.textContent=fmtDate(s.created_at);
      const itemsTd=document.createElement('td');itemsTd.className='mono-sm';itemsTd.textContent=String(qCountById[s.id]||0);
      const extraTd=document.createElement('td');extraTd.className='mono-sm';
      const extras=[];
      if(s.is_foreign)extras.push('Estrangeiro');
      if(s.cambio)extras.push('Câmbio: '+s.cambio);
      if(s.transport)extras.push('Transport: '+s.transport);
      if(s.direitos)extras.push('Direitos: '+s.direitos+'%');
      extraTd.textContent=extras.join(' · ')||'—';
      tr.appendChild(projTd);tr.appendChild(procStatusTd);tr.appendChild(suppStatusTd);tr.appendChild(dateTd);tr.appendChild(itemsTd);tr.appendChild(extraTd);
      tbody.appendChild(tr);
    });
    procSec.appendChild(tbl);
  }
  main.appendChild(procSec);
}

function _openFinanceModal(gs, finSec) {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:1000';

  const modal = document.createElement('div'); modal.className = 'modal-box';
  modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;min-width:340px;max-width:420px;width:100%';

  const title = document.createElement('div'); title.style.cssText = 'font-size:15px;font-weight:600;color:var(--text);margin-bottom:20px';
  title.textContent = 'Informações Financeiras — ' + gs.name;
  modal.appendChild(title);

  // ETA field
  const etaLabel = document.createElement('label'); etaLabel.style.cssText = 'display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px';
  etaLabel.textContent = 'ETA / Entrega';
  const etaSel = document.createElement('select'); etaSel.style.cssText = 'width:100%;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;margin-bottom:14px';
  [['', 'Não definido'], ['after_order', 'Após Encomenda'], ['after_payment', 'Após Pagamento']].forEach(([val, lbl]) => {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
    if ((gs.eta_condition || '') === val) opt.selected = true;
    etaSel.appendChild(opt);
  });
  modal.appendChild(etaLabel); modal.appendChild(etaSel);

  // Account status field
  const accLabel = document.createElement('label'); accLabel.style.cssText = 'display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px';
  accLabel.textContent = 'Estado da Conta';
  const accSel = document.createElement('select'); accSel.style.cssText = 'width:100%;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;margin-bottom:20px';
  [['', 'Não definido'], ['open', 'Aberta'], ['blocked', 'Bloqueada']].forEach(([val, lbl]) => {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
    if ((gs.account_status || '') === val) opt.selected = true;
    accSel.appendChild(opt);
  });
  modal.appendChild(accLabel); modal.appendChild(accSel);

  // Credit field
  const creditLabel2 = document.createElement('label'); creditLabel2.style.cssText = 'display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px;margin-bottom:4px';
  creditLabel2.textContent = 'Crédito';
  const creditSel = document.createElement('select'); creditSel.style.cssText = 'width:100%;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;margin-bottom:20px';
  [['', 'Não definido'], ['true', 'Sim'], ['false', 'Não']].forEach(([val, lbl]) => {
    const opt = document.createElement('option'); opt.value = val; opt.textContent = lbl;
    if (gs.has_credit === true && val === 'true') opt.selected = true;
    else if (gs.has_credit === false && val === 'false') opt.selected = true;
    else if (gs.has_credit == null && val === '') opt.selected = true;
    creditSel.appendChild(opt);
  });
  modal.appendChild(creditLabel2); modal.appendChild(creditSel);

  // Actions
  const actions = document.createElement('div'); actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
  const resetBtn = document.createElement('button'); resetBtn.type = 'button'; resetBtn.className = 'btn btn-ghost btn-sm'; resetBtn.style.marginRight = 'auto'; resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => { etaSel.value = ''; accSel.value = ''; creditSel.value = ''; });
  const cancelBtn = document.createElement('button'); cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-ghost btn-sm'; cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
  const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.className = 'btn btn-primary btn-sm'; saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = '...';
    const newEta = etaSel.value || null;
    const newAcc = accSel.value || null;
    const newCredit = creditSel.value === 'true' ? true : creditSel.value === 'false' ? false : null;
    try {
      await API.updateSupplierFinance(gs.id, newEta, newAcc, newCredit);
      gs.eta_condition = newEta; gs.account_status = newAcc; gs.has_credit = newCredit;
      const etaValEl = finSec.querySelector('.finance-value');
      if (etaValEl) { etaValEl.textContent = newEta === 'after_order' ? 'Após Encomenda' : newEta === 'after_payment' ? 'Após Pagamento' : 'Não definido'; etaValEl.style.color = newEta ? '' : 'var(--muted)'; }
      const badges = finSec.querySelectorAll('.finance-badge');
      if (badges[0]) { if (newAcc === 'open') { badges[0].className = 'finance-badge open'; badges[0].textContent = 'Aberta'; } else if (newAcc === 'blocked') { badges[0].className = 'finance-badge blocked'; badges[0].textContent = 'Bloqueada'; } else { badges[0].className = 'finance-badge unknown'; badges[0].textContent = 'Não definida'; } }
      if (badges[1]) { if (newCredit === true) { badges[1].className = 'finance-badge open'; badges[1].textContent = 'Sim'; } else if (newCredit === false) { badges[1].className = 'finance-badge blocked'; badges[1].textContent = 'Não'; } else { badges[1].className = 'finance-badge unknown'; badges[1].textContent = 'Não definido'; } }
      document.body.removeChild(overlay);
      showToast('Guardado');
    } catch(e) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; showToast(e.message, true); }
  });
  actions.appendChild(resetBtn); actions.appendChild(cancelBtn); actions.appendChild(saveBtn);
  modal.appendChild(actions);

  overlay.appendChild(modal);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
  setTimeout(() => { if (window.lucide) lucide.createIcons(); }, 0);
}
