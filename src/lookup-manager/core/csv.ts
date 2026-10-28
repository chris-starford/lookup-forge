// Minimal RFC 4180 CSV parsing and serialization (quoted fields, embedded commas, quotes and newlines).

export function parseCsv(text: string, delimiter = ','): Record<string, string>[] {
  const records = parseRows(text.replace(/^\uFEFF/, ''), delimiter);
  if (records.length === 0) return [];
  const header = records[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < records.length; i++) {
    const r = records[i];
    if (r.length === 1 && r[0] === '') continue; // blank line
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = r[idx] ?? '';
    });
    out.push(obj);
  }
  return out;
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function escapeField(v: string): string {
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const lines = [columns.map(escapeField).join(',')];
  for (const r of rows) lines.push(columns.map((c) => escapeField(r[c] ?? '')).join(','));
  // No trailing blank line: Cribl Stream CIDR/Regex lookups require none.
  return lines.join('\n');
}
