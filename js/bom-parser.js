// ── BOM Parser ──
// Reads Triana BOM Excel template format:
// Col A: Part # (Artigo)   Col B: Descrição   Col C: Quantidade   Col D: Unidade
// Category rows: col A has text, col C (qty) is empty or non-numeric
// Technician rows are in section "Serviço & Categoria dos Técnicos..."
// Tech rows are read IN ORDER as they appear — no bucketing into senior/intermediate/junior.
// Hours per tech: col D if numeric, else from a "duração/hora" row applied to all with hours=0.

function parseBomFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  const items = [];
  const techInfos = []; // one entry per sheet that has technicians
  let sortOrder = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    let currentCategory = sheetName;
    let inTechSection = false;
    const sheetTech = { sheet_name: sheetName, rows: [] }; // rows in BOM order

    // Find header row (where col B = "Descrição" or similar)
    let dataStart = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const b = String(row[1] || '').toLowerCase();
      if (b.includes('descri')) { dataStart = i + 1; break; }
    }

    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i];
      const colA = String(row[0] || '').trim();
      const colB = String(row[1] || '').trim();
      const colC = String(row[2] || '').trim();
      const colD = String(row[3] || '').trim();

      // Skip empty rows
      if (!colA && !colB) continue;

      // Detect technician section header
      if (colA.toLowerCase().includes('técnico') || colA.toLowerCase().includes('serviço') || colA.toLowerCase().includes('tecnico')) {
        if (colA.toLowerCase().includes('serviço') || colA.toLowerCase().includes('categoria')) {
          inTechSection = true;
          currentCategory = colA;
          continue;
        }
      }

      // Category header: col A has text, qty is empty or non-numeric
      const qty = parseFloat(colC.replace(',', '.'));
      if (colA && (!colC || isNaN(qty))) {
        currentCategory = colA;
        inTechSection = colA.toLowerCase().includes('técnico') || colA.toLowerCase().includes('serviço');
        continue;
      }

      if (!colB || isNaN(qty)) continue;

      if (inTechSection) {
        const desc = colB.toLowerCase();
        // Duration/hours row — apply to all tech rows with hours still 0
        if (desc.includes('duração') || (desc.includes('hora') && !desc.includes('técnico') && !desc.includes('tecnico'))) {
          sheetTech.rows.forEach(r => { if (!r.hours) r.hours = qty; });
          continue;
        }
        // Tech person row — read in order, hours from col D if numeric
        const colDNum = parseFloat(colD.replace(',', '.'));
        sheetTech.rows.push({
          description: colB,
          count: qty,
          hours: isNaN(colDNum) ? 0 : colDNum,
          rate: 0, // set manually in install tab
        });
        continue;
      }

      items.push({
        part_number: colA || null,
        description: colB,
        quantity: qty,
        unit: colD || null,
        category: currentCategory || null,
        sheet_name: sheetName,
        sort_order: sortOrder++,
      });
    }

    if (sheetTech.rows.length) techInfos.push(sheetTech);
  }

  return { items, techInfos };
}
