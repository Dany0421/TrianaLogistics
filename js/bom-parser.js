// ── BOM Parser ──
// Reads Triana BOM Excel template format:
// Col A: Part # (Artigo)   Col B: Descrição   Col C: Quantidade   Col D: Unidade
// Category rows: col A has text, col C (qty) is empty or non-numeric

function parseBomFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  const items = [];
  let sortOrder = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    let currentCategory = sheetName;

    // Find header row (where col B = "Descrição" or similar)
    let dataStart = 0;
    for (let i = 0; i < rows.length; i++) {
      const b = String(rows[i][1] || '').toLowerCase();
      if (b.includes('descri')) { dataStart = i + 1; break; }
    }

    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i];
      const colA = String(row[0] || '').trim();
      const colB = String(row[1] || '').trim();
      const colC = String(row[2] || '').trim();
      const colD = String(row[3] || '').trim();

      if (!colA && !colB) continue;

      const qty = parseFloat(colC.replace(',', '.'));

      // Category header: col A has text, qty is empty or non-numeric
      if (colA && (!colC || isNaN(qty))) {
        currentCategory = colA;
        continue;
      }

      if (!colB || isNaN(qty)) continue;

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
  }

  return { items };
}
