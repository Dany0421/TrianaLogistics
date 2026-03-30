// ── BOM Parser ──
// Reads Triana BOM Excel template format:
// Col A: Part # (Artigo)   Col B: Descrição   Col C: Quantidade   Col D: Unidade
// Category rows: col A has text, col C (qty) is empty or non-numeric
// Technician rows are in section "Serviço & Categoria dos Técnicos..."

function parseBomFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  const items = [];
  const techInfo = { senior: 0, intermediate: 0, junior: 0, hours: 0 };
  let sortOrder = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    let currentCategory = sheetName; // use sheet name as default category
    let inTechSection = false;

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

      // Detect technician section
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

      // Technician rows — extract for installation_costs
      if (inTechSection) {
        const desc = colB.toLowerCase();
        if (desc.includes('senior') || desc.includes('sénior')) {
          techInfo.senior = qty;
        } else if (desc.includes('interm')) {
          techInfo.intermediate = qty;
        } else if (desc.includes('junior') || desc.includes('júnior')) {
          techInfo.junior = qty;
        } else if (desc.includes('duração') || desc.includes('hora')) {
          techInfo.hours = qty;
        }
        continue;
      }

      items.push({
        part_number: colA || null,
        description: colB,
        quantity: qty,
        unit: colD || null,
        category: currentCategory || null,
        sort_order: sortOrder++,
      });
    }
  }

  return { items, techInfo };
}
