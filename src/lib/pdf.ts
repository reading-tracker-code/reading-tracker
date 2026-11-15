// PDF-Export der Auswertungen (jsPDF, wird erst beim Export geladen). Es werden nur Standardschriften genutzt,
// daher werden Sonderzeichen außerhalb von Latin-1 vereinfacht (Umlaute und ß bleiben erhalten).
export type PdfRow = { l: string; a: string; b?: string; d?: string; c?: 'good' | 'bad' };
export type PdfData = {
  title: string; periodA: string; periodB?: string; created: string;
  rows: PdfRow[]; barsTitle: string; bars: { l: string; v: number }[];
  top: { t: string; s: string }[]; finished: string[]; habits: string[];
};
const tx = (s: string) => s.replace(/[–—−]/g, '-').replace(/[„“”]/g, '"').replace(/[’‘]/g, "'").replace(/★/g, '*').replace(/…/g, '...').replace(/[^\u0000-\u00ff]/g, '');

export async function buildPdf(d: PdfData): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' }), W = 210, M = 16, R = W - M;
  let y = 0;
  const room = (h: number) => { if (y + h > 280) { doc.addPage(); y = 20; } };
  const head = (t: string) => { room(18); y += 5; doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(79, 70, 229); doc.text(tx(t), M, y); y += 7; doc.setTextColor(30, 30, 30); };
  const line = (t: string) => { room(6); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(tx(t).slice(0, 95), M, y); y += 6; };

  doc.setFillColor(79, 70, 229); doc.rect(0, 0, W, d.periodB ? 38 : 32, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(tx(d.title), M, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.text(tx(d.periodB ? `Zeitraum A: ${d.periodA}` : d.periodA), M, 24); if (d.periodB) doc.text(tx(`Zeitraum B: ${d.periodB}`), M, 30);
  y = d.periodB ? 44 : 38; doc.setTextColor(30, 30, 30);

  head('Kennzahlen');
  const two = d.rows.some(r => r.b !== undefined);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Kennzahl', M, y);
  if (two) { doc.text('Zeitraum A', 112, y, { align: 'right' }); doc.text('Zeitraum B', 142, y, { align: 'right' }); doc.text('Veränderung', R, y, { align: 'right' }); } else doc.text('Wert', R, y, { align: 'right' });
  y += 5; doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  d.rows.forEach((r, i) => {
    room(7); if (i % 2 === 0) { doc.setFillColor(243, 243, 252); doc.rect(M - 2, y - 4.6, W - 2 * M + 4, 6.4, 'F'); }
    doc.setTextColor(30, 30, 30); doc.text(tx(r.l), M, y);
    if (two) { doc.text(tx(r.a), 112, y, { align: 'right' }); doc.text(tx(r.b ?? ''), 142, y, { align: 'right' }); if (r.c === 'good') doc.setTextColor(5, 150, 105); else if (r.c === 'bad') doc.setTextColor(220, 38, 38); doc.text(tx(r.d ?? ''), R, y, { align: 'right' }); doc.setTextColor(30, 30, 30); }
    else doc.text(tx(r.a), R, y, { align: 'right' });
    y += 6.4;
  });

  if (d.bars.length) {
    head(d.barsTitle); room(62);
    const h = 42, w = R - M, n = d.bars.length, mx = Math.max(1, ...d.bars.map(b => b.v)), bw = w / n;
    doc.setDrawColor(200, 200, 210); doc.line(M, y + h, R, y + h); doc.setFillColor(99, 102, 241);
    d.bars.forEach((b, i) => { const bh = (b.v / mx) * h; if (bh > 0) doc.rect(M + i * bw + bw * 0.12, y + h - bh, bw * 0.76, bh, 'F'); });
    doc.setFontSize(7); doc.setTextColor(90, 90, 100); const k = Math.ceil(n / 12);
    d.bars.forEach((b, i) => { if (i % k === 0) doc.text(tx(b.l), M + i * bw + bw / 2, y + h + 4, { align: 'center' }); });
    doc.text(`Maximum: ${mx}`, R, y - 1, { align: 'right' }); doc.setTextColor(30, 30, 30); y += h + 8;
  }
  if (d.habits.length) { head('Lesegewohnheiten'); d.habits.forEach(line); }
  if (d.top.length) { head('Meistgelesene Bücher im Zeitraum'); d.top.forEach((t, i) => { room(6); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(tx(`${i + 1}. ${t.t}`).slice(0, 62), M, y); doc.text(tx(t.s), R, y, { align: 'right' }); y += 6; }); }
  if (d.finished.length) { head('Abgeschlossene Bücher im Zeitraum'); d.finished.slice(0, 40).forEach(t => line(`- ${t}`)); }

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130, 130, 140); doc.text(tx(`Reading Tracker - erstellt am ${d.created}`), M, 290); doc.text(`Seite ${i} von ${n}`, R, 290, { align: 'right' }); }
  return doc.output('blob');
}
