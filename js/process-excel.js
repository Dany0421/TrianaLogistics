// ── Excel Generation (ported from planilha-generator) ──
const MB={top:{style:'medium'},left:{style:'medium'},bottom:{style:'medium'},right:{style:'medium'}};
const TB={top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};
const OF={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFC000'}};
const YF={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFFF00'}};
function sc2(cell,opts={}){const{value,font,fill,border,alignment,numFmt}=opts;if(value!==undefined)cell.value=value;if(font)cell.font=font;if(fill)cell.fill=fill;if(border)cell.border=border;if(alignment)cell.alignment=alignment;if(numFmt)cell.numFmt=numFmt;}
function col2l(n){let s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}

function buildSupSheet(wb, supplier) {
  const items = supplier.items.filter(i => i.model && i.model.trim());
  const isForeign = supplier.isForeign;
  const cambio = parseFloat(supplier.cambio) || 1;
  const transport = parseFloat(supplier.transport) || 0;
  const direitos = (parseFloat(supplier.direitos) || 0) / 100;
  const name = (supplier.name || 'Fornecedor').substring(0, 31);
  const ws = wb.addWorksheet(name, {properties:{tabColor:{argb:'FFC00000'}},views:[{showGridLines:false}]});
  ws.columns=[{width:15.7},{width:40},{width:12},{width:13},{width:15.5},{width:18.2},{width:19.5},{width:13},{width:15.1},{width:14.8},{width:15.8},{width:18.8},{width:15.5},{width:11.8},{width:18.2},{width:12.5},{width:9.8},{width:17.8},{width:16.5},{width:14.5}];
  const DS=4,lastItemRow=DS+items.length-1,totalRow=lastItemRow+2,transportRow=totalRow+1,cambioRow=transportRow+2;
  ws.getRow(2).height=19.25;
  sc2(ws.getCell(2,16),{value:'Homologacao',font:{bold:true,size:14,name:'Calibri'},alignment:{horizontal:'center',vertical:'middle'}});
  sc2(ws.getCell(2,17),{value:'Selos',font:{bold:true,size:14,name:'Calibri'},alignment:{horizontal:'center',vertical:'middle'}});
  ws.getRow(3).height=56.25;
  const hF={bold:true,size:14,name:'Calibri',color:{argb:'FF000000'}};
  const hA={horizontal:'center',vertical:'middle',wrapText:true};
  const OC=new Set([16,17,19,20]);
  ['Part','Model','Direitos %','Transporte','QTY','Unit price (MZN)','Total price (MZN)','Transporte','Margem Infinitreach','Custo com Transporte','Direitos Aduaneiros','Custo da mercadoria DDP','Outros Custos de Importacao','DDP Final','Custo DDP MZN',3000,25,'Custo DDP MZN Final','Preco de Venda','Preco Total'].forEach((lbl,i)=>{
    sc2(ws.getCell(3,i+1),{value:lbl,font:hF,fill:OC.has(i+1)?OF:undefined,border:MB,alignment:hA});
  });
  const dF={size:11,name:'Calibri',color:{argb:'FF000000'}};
  const dA={horizontal:'center',vertical:'middle'};
  const rF={size:11,name:'Calibri',color:{argb:'FFFF0000'}};
  const NF='#,##0.00',NFD='#,##0.00;-#,##0.00;"-"';
  items.forEach((item,idx)=>{
    const r=DS+idx,qty=parseFloat(item.qty)||1,up=parseFloat(item.price)||0;
    ws.getRow(r).height=18.5;
    sc2(ws.getCell(r,1),{value:item.part||'',font:dF,border:TB,alignment:dA});
    sc2(ws.getCell(r,2),{value:item.model,font:dF,border:TB,alignment:{horizontal:'left',vertical:'middle',wrapText:true}});
    sc2(ws.getCell(r,3),{value:direitos,font:dF,border:TB,alignment:dA,numFmt:'0.0%'});
    sc2(ws.getCell(r,4),{value:{formula:`+$F$${transportRow}/$G$${totalRow}`},font:dF,border:TB,alignment:dA,numFmt:'0.0%'});
    sc2(ws.getCell(r,5),{value:qty,font:dF,border:TB,alignment:{horizontal:'center',vertical:'middle',wrapText:true}});
    sc2(ws.getCell(r,6),{value:up,font:dF,border:TB,alignment:{horizontal:'right',vertical:'middle'},numFmt:NF});
    sc2(ws.getCell(r,7),{value:{formula:`+F${r}*E${r}`},font:dF,border:TB,alignment:{horizontal:'right',vertical:'middle',wrapText:true},numFmt:NFD});
    sc2(ws.getCell(r,8),{value:{formula:`F${r}*D${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,9),{value:{formula:`+F${r}*0%`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,10),{value:{formula:`H${r}+F${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,11),{value:{formula:`J${r}*C${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,12),{value:{formula:`K${r}+J${r}+I${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,13),{value:{formula:`L${r}*${isForeign?'5':'0'}%`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,14),{value:{formula:`M${r}+L${r}`},font:rF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,15),{value:{formula:`+N${r}*$F$${cambioRow}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,16),{border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,17),{border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,18),{value:{formula:`+Q${r}+P${r}+O${r}`},font:dF,border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,19),{border:TB,alignment:dA,numFmt:NFD});
    sc2(ws.getCell(r,20),{border:TB,alignment:dA,numFmt:NFD});
  });
  ws.getRow(totalRow).height=18.5;
  sc2(ws.getCell(totalRow,7),{value:{formula:`SUM(G${DS}:G${lastItemRow})`},font:{bold:true,size:11,name:'Calibri'},alignment:{horizontal:'right',vertical:'middle'},numFmt:NF});
  sc2(ws.getCell(transportRow,5),{value:'TRANSPORTE',font:{size:14,name:'Calibri'},fill:YF});
  sc2(ws.getCell(transportRow,6),{value:transport,font:{size:14,name:'Calibri'},fill:YF,numFmt:'"MZN" #,##0.00'});
  sc2(ws.getCell(cambioRow,5),{value:'Cambio',font:{size:14,name:'Calibri'},fill:YF});
  sc2(ws.getCell(cambioRow,6),{value:cambio,font:{size:14,name:'Calibri'},fill:YF,numFmt:'"MZN" #,##0.00'});
  return { dataStart: DS };
}

function fillMain(ws, suppliers, sheetNames, dataStarts, allRows, hasServices) {
  const trCol=hasServices?4+suppliers.length:null;
  const vc=hasServices?trCol+1:4+suppliers.length;
  const tc=vc+1;
  ws.columns=hasServices
    ?[{width:4.5},{width:45.8},{width:4.5},...suppliers.map(()=>({width:17.8})),{width:14.5},{width:14.5},{width:13.9}]
    :[{width:4.5},{width:45.8},{width:4.5},...suppliers.map(()=>({width:17.8})),{width:14.5},{width:13.9}];
  const hF={bold:true,size:11,name:'Calibri',color:{argb:'FF000000'}};
  const hA={horizontal:'center',vertical:'middle',wrapText:true};
  const dF={size:11,name:'Calibri'};
  const svcF={size:11,name:'Calibri',color:{argb:'FFFF8800'}};
  const NF='#,##0.00';
  ws.getRow(3).height=40;
  sc2(ws.getCell(3,1),{value:'Part',font:hF,border:MB,alignment:hA});
  sc2(ws.getCell(3,2),{value:'Model',font:hF,border:MB,alignment:hA});
  sc2(ws.getCell(3,3),{value:'QTY',font:hF,border:MB,alignment:hA});
  suppliers.forEach((s,si)=>sc2(ws.getCell(3,4+si),{value:sheetNames[si],font:hF,border:MB,alignment:hA}));
  if(hasServices)sc2(ws.getCell(3,trCol),{value:'Triana',font:hF,border:MB,alignment:hA});
  sc2(ws.getCell(3,vc),{value:'Preco de Venda',font:hF,fill:OF,border:MB,alignment:hA});
  sc2(ws.getCell(3,tc),{value:'Preco Total',font:hF,fill:OF,border:MB,alignment:hA});
  let row=4;
  const vl=col2l(vc);
  const trL=trCol?col2l(trCol):null;

  for (const item of allRows) {
    for(let c=1;c<=tc;c++)ws.getCell(row,c).border=TB;

    if (item.type === 'equip') {
      const si=suppliers.findIndex(s=>s.id===item.suppId);
      if(si<0){row++;continue;}
      const ss=sheetNames[si].includes(' ')?`'${sheetNames[si]}'`:sheetNames[si];
      const ds=dataStarts[si];
      sc2(ws.getCell(row,1),{value:item.part||'',font:dF,alignment:{horizontal:'center',vertical:'middle'}});
      sc2(ws.getCell(row,2),{value:item.model,font:dF,alignment:{horizontal:'left',vertical:'middle',wrapText:true}});
      sc2(ws.getCell(row,3),{value:item.qty,font:dF,alignment:{horizontal:'center',vertical:'middle'}});
      sc2(ws.getCell(row,4+si),{value:{formula:`${ss}!R${ds+item.indexInSupplier}`},font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
      sc2(ws.getCell(row,tc),{value:{formula:`+${vl}${row}*C${row}`},font:dF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
    } else {
      sc2(ws.getCell(row,2),{value:item.model,font:svcF,alignment:{horizontal:'left',vertical:'middle',wrapText:true}});
      sc2(ws.getCell(row,3),{value:item.qty,font:svcF,alignment:{horizontal:'center',vertical:'middle'}});
      if(trCol) sc2(ws.getCell(row,trCol),{value:item.unitPrice,font:svcF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
      sc2(ws.getCell(row,tc),{value:{formula:`+${trL}${row}*C${row}`},font:svcF,alignment:{horizontal:'center',vertical:'middle'},numFmt:NF});
    }
    row++;
  }
}

async function generateExcel() {
  if (hasRole('commercial')) { showToast('Sem permissão para gerar Excel.', true); return; }

  // Build selected offer lookup
  const selLookup = {};
  for (const o of selectedOffers) selLookup[o.bom_item_id] = o;

  // Build match lookup: bomItemId → supplierId → match
  const matchLookup = {};
  for (const m of matches) {
    if (!matchLookup[m.bom_item_id]) matchLookup[m.bom_item_id] = {};
    matchLookup[m.bom_item_id][m.supplier_id] = m;
  }

  // Build supplier items AND ordered row list (BOM order) in one pass
  const supplierItems = {};       // supplierId → items array for buildSupSheet
  const supplierCounters = {};    // supplierId → how many items added so far
  const allRows = [];             // flat list in BOM order: equip + service interleaved
  const skippedItems = [];
  let hasServices = false;

  for (const bi of bomItems) {
    if (bi.is_service) {
      if ((bi.service_price || 0) > 0) hasServices = true;
      allRows.push({ type: 'service', model: bi.description, qty: bi.quantity || 1, unitPrice: bi.service_price || 0 });
      continue;
    }

    const confirmed = selLookup[bi.id];
    let suppId = null, qi = null;

    if (confirmed) {
      qi = (quotationMap[confirmed.supplier_id] || []).find(q => q.id === confirmed.quotation_item_id);
      if (qi) suppId = confirmed.supplier_id;
    } else {
      const itemMatches = matchLookup[bi.id];
      if (itemMatches) {
        for (const [sid, m] of Object.entries(itemMatches)) {
          const q = (quotationMap[sid] || []).find(q => q.id === m.quotation_item_id);
          if (q && q.price != null) { suppId = sid; qi = q; break; }
        }
      }
    }

    if (!suppId || !qi) { skippedItems.push(bi.description || bi.part_number || '?'); continue; }

    if (!supplierItems[suppId]) { supplierItems[suppId] = []; supplierCounters[suppId] = 0; }
    const indexInSupplier = supplierCounters[suppId]++;
    supplierItems[suppId].push({ part: qi.raw_part_number || bi.part_number || '', model: qi.raw_description || bi.description, qty: String(qi.quantity || bi.quantity), price: String(qi.price) });
    allRows.push({ type: 'equip', part: qi.raw_part_number || bi.part_number || '', model: qi.raw_description || bi.description, qty: qi.quantity || bi.quantity, suppId, indexInSupplier });
  }

  const activeSuppliers = suppliers.filter(s => supplierItems[s.id]?.length > 0);

  if (!activeSuppliers.length && !hasServices) { showToast('Sem itens com preço no Matching nem serviços.', true); return; }
  if (skippedItems.length) {
    const noun = skippedItems.length === 1 ? 'item sem preço' : 'itens sem preço';
    console.warn('[Excel] Itens ignorados por falta de preço:', skippedItems);
    showToast(`${skippedItems.length} ${noun} não incluído(s) no Excel — faz matching primeiro.`, true);
    await new Promise(r => setTimeout(r, 1200));
  }

  try {
    const wb = new ExcelJS.Workbook();
    const mainWs = wb.addWorksheet((process.client_name||'Principal').substring(0,31), {views:[{showGridLines:false}]});
    const sheetNames=[], dataStarts=[];
    const suppliersForMain = activeSuppliers.map(s => ({
      name: s.name, isForeign: s.is_foreign, cambio: s.cambio||1, transport: s.transport||0, direitos: s.direitos||0,
      items: supplierItems[s.id],
    }));
    for (const s of suppliersForMain) {
      const { dataStart } = buildSupSheet(wb, s);
      sheetNames.push(s.name.substring(0, 31));
      dataStarts.push(dataStart);
    }
    fillMain(mainWs, activeSuppliers, sheetNames, dataStarts, allRows, hasServices);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Planilha_Financeira_${(process.project_name||'Processo').replace(/[^a-zA-Z0-9\s\-_]/g,'').replace(/\s+/g,'_')}_${(process.client_name||'').replace(/[^a-zA-Z0-9\s\-_]/g,'').replace(/\s+/g,'_')}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Excel gerado!');
  } catch(e) { showToast('Erro ao gerar Excel: ' + e.message, true); console.error(e); }
}
