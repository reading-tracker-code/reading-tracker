import { useMemo, useState } from 'react';
import { BarChart3, FileDown, Mail } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { buildPdf, type PdfData } from './lib/pdf';
import { computeStats, dayKey, isValid, pagesOf, rangeFor, type Book, type Session } from './lib/stats';
import { TZ } from './lib/tz';
import { Empty, btn, card, inp } from './ui';

type R = { from: string; to: string };
type S = ReturnType<typeof computeStats>;
const dn = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 864e5;
const iso = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
const de = (n: number, d = 0) => n.toLocaleString('de-DE', { maximumFractionDigits: d });
const fmtMin = (m: number) => { const t = Math.round(m); return `${Math.floor(t / 60)} h ${t % 60} min`; };
const fd = (k: string) => `${k.slice(8)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
const lab = (r: R) => `${fd(r.from)} – ${fd(r.to)}`;
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const PRESETS: [string, string][] = [['7', 'Letzte 7 Tage'], ['30', 'Letzte 30 Tage'], ['90', 'Letzte 90 Tage'], ['month', 'Aktueller Monat'], ['lastmonth', 'Letzter Monat'], ['quarter', 'Aktuelles Quartal'], ['lastquarter', 'Letztes Quartal'], ['year', 'Aktuelles Jahr'], ['lastyear', 'Letztes Jahr'], ['all', 'Gesamter Zeitraum'], ['custom', 'Eigener Zeitraum …']];
const MODES: [string, string][] = [['none', 'Kein Vergleich'], ['prev', 'Vorheriger Zeitraum (gleich lang)'], ['lastyear', 'Gleicher Zeitraum im Vorjahr'], ['custom', 'Eigener Vergleichszeitraum …']];

const METRICS: { l: string; get: (s: S) => number; f: (n: number) => string; inv?: boolean }[] = [
  { l: 'Gelesene Seiten', get: s => s.pages, f: n => de(n) }, { l: 'Lesezeit', get: s => s.minutes, f: fmtMin }, { l: 'Sessions', get: s => s.sessionsCount, f: n => de(n) },
  { l: 'Aktive Lesetage', get: s => s.activeDays, f: n => de(n) }, { l: 'Lesefreie Tage', get: s => s.restDays, f: n => de(n), inv: true },
  { l: 'Ø Minuten pro Tag', get: s => s.avgMinutesPerDay, f: n => de(n, 1) }, { l: 'Ø Seiten pro Tag', get: s => s.avgPagesPerDay, f: n => de(n, 1) },
  { l: 'Seiten pro Stunde', get: s => s.pagesPerHour ?? 0, f: n => de(n, 1) }, { l: 'Ø Minuten pro Session', get: s => s.avgSessionMinutes, f: n => de(n, 1) },
  { l: 'Längste Session (Min.)', get: s => s.record.longestSession, f: n => de(n) }, { l: 'Meiste Seiten an einem Tag', get: s => s.record.maxPagesDay?.pages ?? 0, f: n => de(n) },
  { l: 'Längster Streak (Tage)', get: s => s.longestStreak, f: n => de(n) }, { l: 'Abgeschlossene Bücher', get: s => s.finishedBooks, f: n => de(n) },
];
const sg = (d: number, f: (n: number) => string) => (d > 0 ? '+' : d < 0 ? '-' : '') + f(Math.abs(d));

function resolve(p: string, today: string, first: string, c: R): R {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  if (p === 'custom') return c;
  if (p === 'all') return { from: first || today, to: today };
  if (p === 'quarter' || p === 'lastquarter') {
    const qi = Math.floor((m - 1) / 3) - (p === 'lastquarter' ? 1 : 0), yy = y + Math.floor(qi / 4), q = ((qi % 4) + 4) % 4;
    return { from: iso(Date.UTC(yy, q * 3, 1) / 864e5), to: iso(Date.UTC(yy, q * 3 + 3, 0) / 864e5) };
  }
  return rangeFor(p, TZ) ?? { from: today, to: today };
}
function other(mode: string, a: R, c: R): R | null {
  if (mode === 'none') return null;
  if (mode === 'custom') return c;
  if (mode === 'prev') { const n = dn(a.to) - dn(a.from) + 1; return { from: iso(dn(a.from) - n), to: iso(dn(a.from) - 1) }; }
  const sh = (k: string) => { const y = +k.slice(0, 4) - 1, m = +k.slice(5, 7), d = Math.min(+k.slice(8, 10), new Date(Date.UTC(y, m, 0)).getUTCDate()); return `${y}-${k.slice(5, 7)}-${String(d).padStart(2, '0')}`; };
  return { from: sh(a.from), to: sh(a.to) };
}
// Tage (bis 45 Tage), Wochen (bis 200 Tage) oder Monate
function buckets(daily: { day: string; pages: number; minutes: number }[], r: R) {
  const n = dn(r.to) - dn(r.from) + 1, key = (d: string) => (n <= 45 ? d : n <= 200 ? iso(dn(d) - ((new Date(dn(d) * 864e5).getUTCDay() + 6) % 7)) : d.slice(0, 7));
  const map = new Map<string, { pages: number; minutes: number }>();
  for (const d of daily) { const k = key(d.day), e = map.get(k) ?? { pages: 0, minutes: 0 }; e.pages += d.pages; e.minutes += d.minutes; map.set(k, e); }
  const out: { l: string; pages: number; minutes: number }[] = []; let last = '';
  for (let t = dn(r.from); t <= dn(r.to); t++) { const k = key(iso(t)); if (k === last) continue; last = k; const e = map.get(k) ?? { pages: 0, minutes: 0 }; out.push({ l: n > 200 ? `${k.slice(5)}/${k.slice(2, 4)}` : `${k.slice(8)}.${k.slice(5, 7)}`, pages: e.pages, minutes: Math.round(e.minutes) }); }
  return { data: out, unit: n <= 45 ? 'Tag' : n <= 200 ? 'Woche' : 'Monat' };
}
function cumulative(daily: { day: string; pages: number }[], r: R) { const m = new Map(daily.map(d => [d.day, d.pages] as const)), out: number[] = []; let c = 0; for (let t = dn(r.from); t <= dn(r.to); t++) { c += m.get(iso(t)) ?? 0; out.push(c); } return out; }
function habits(s: S): string[] {
  const o: string[] = [], w = s.weekday.map((v, i) => ({ i, m: v.minutes })).sort((a, b) => b.m - a.m)[0];
  if (w && w.m > 0) o.push(`Meiste Lesezeit: ${WD[w.i]} (${fmtMin(w.m)} gesamt)`);
  const tot = Object.values(s.buckets).reduce((a, b) => a + b, 0), bt = Object.entries(s.buckets).sort((a, b) => b[1] - a[1])[0];
  if (tot > 0 && bt[1] > 0) o.push(`Liebste Tageszeit: ${bt[0]} (${Math.round((bt[1] / tot) * 100)} % der Lesezeit)`);
  if (s.avgSessionMinutes) o.push(`Durchschnittliche Session: ${Math.round(s.avgSessionMinutes)} Minuten`);
  if (s.pagesPerHour) o.push(`Lesetempo: ${Math.round(s.pagesPerHour)} Seiten pro Stunde`);
  return o;
}

export function Reports({ books, sessions }: { books: Book[]; sessions: Session[] }) {
  const today = dayKey(new Date(), TZ), first = useMemo(() => sessions.reduce((m, s) => (m === '' || s.session_date < m ? s.session_date : m), ''), [sessions]);
  const [p, setP] = useState('30'), [cf, setCf] = useState(iso(dn(today) - 29)), [ct, setCt] = useState(today), [mode, setMode] = useState('prev'), [bf, setBf] = useState(iso(dn(today) - 59)), [bt, setBt] = useState(iso(dn(today) - 30));
  const [mail, setMail] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const A = useMemo(() => { const r = resolve(p, today, first, { from: cf, to: ct }); return { from: r.from, to: r.to > today ? today : r.to }; }, [p, today, first, cf, ct]);
  const B = useMemo(() => { const r = other(mode, A, { from: bf, to: bt }); return r ? { from: r.from, to: r.to > today ? today : r.to } : null; }, [mode, A, bf, bt, today]);
  const errA = A.from > A.to, errB = !!B && B.from > B.to, ok = !errA && !errB;
  const sa = useMemo(() => computeStats(sessions, books, A, TZ), [sessions, books, A]);
  const sb = useMemo(() => (B ? computeStats(sessions, books, B, TZ) : null), [sessions, books, B]);
  const bk = useMemo(() => buckets(sa.daily, A), [sa, A]);
  const cmpData = useMemo(() => { if (!sb || !B) return []; const a = cumulative(sa.daily, A), b = cumulative(sb.daily, B), n = Math.max(a.length, b.length), st = Math.max(1, Math.ceil(n / 150)), out: { d: number; A?: number; B?: number }[] = []; for (let i = 0; i < n; i += st) out.push({ d: i + 1, A: a[i], B: b[i] }); return out; }, [sa, sb, A, B]);
  const top = useMemo(() => { const m = new Map<string, { p: number; m: number }>(), b = new Map(books.map(x => [x.id, x] as const)); for (const s of sessions) if (isValid(s) && s.session_date >= A.from && s.session_date <= A.to) { const e = m.get(s.book_id) ?? { p: 0, m: 0 }; e.p += pagesOf(s); e.m += s.duration_minutes; m.set(s.book_id, e); } return [...m].map(([id, v]) => ({ t: b.get(id)?.title ?? '(gelöschtes Buch)', ...v })).sort((x, y) => y.p - x.p).slice(0, 5); }, [sessions, books, A]);
  const fin = useMemo(() => books.filter(b => b.status === 'finished' && b.finish_date && b.finish_date >= A.from && b.finish_date <= A.to).map(b => (b.author ? `${b.title} (${b.author})` : b.title)), [books, A]);
  const hab = useMemo(() => habits(sa), [sa]);
  const rows = METRICS.map(m => { const a = m.get(sa), b = sb ? m.get(sb) : undefined, d = b === undefined ? 0 : a - b, pc = b ? Math.round((a / b - 1) * 100) : null;
    return { l: m.l, a: m.f(a), b: b === undefined ? undefined : m.f(b), d: b === undefined ? undefined : `${sg(d, m.f)}${pc === null ? '' : ` (${pc > 0 ? '+' : ''}${pc} %)`}`, c: d === 0 || b === undefined ? undefined : ((d > 0) !== !!m.inv ? 'good' : 'bad') as 'good' | 'bad' }; });

  const pdfData = (): PdfData => ({ title: 'Mein Leseverhalten', periodA: lab(A), periodB: B ? lab(B) : undefined, created: fd(today), rows, barsTitle: `Gelesene Seiten pro ${bk.unit}`, bars: bk.data.map(b => ({ l: b.l, v: b.pages })),
    top: top.map(t => ({ t: t.t, s: `${de(t.p)} Seiten, ${fmtMin(t.m)}` })), finished: fin, habits: hab });
  const makeFile = async () => new File([await buildPdf(pdfData())], `lesebericht-${A.from}_${A.to}.pdf`, { type: 'application/pdf' });
  const saveFile = (f: File) => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(''); try { await fn(); } catch (e) { setMsg('Das hat nicht geklappt: ' + ((e as Error)?.message ?? String(e))); } finally { setBusy(false); } };
  const download = () => run(async () => { saveFile(await makeFile()); setMsg('Das PDF wurde erstellt und heruntergeladen.'); });
  const send = () => run(async () => {
    const f = await makeFile(), nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }, text = `Mein Leseverhalten, ${lab(A)}\n\n${rows.map(r => `${r.l}: ${r.a}${r.b !== undefined ? ` (Vergleich: ${r.b})` : ''}`).join('\n')}`;
    if (nav.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: 'Mein Leseverhalten', text }); setMsg('Wähle in der Liste dein Mailprogramm – das PDF hängt bereits an.'); } catch (e) { if ((e as Error).name !== 'AbortError') throw e; } return; }
    saveFile(f); const to = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.trim()) ? mail.trim() : '';
    location.href = `mailto:${to}?subject=${encodeURIComponent('Mein Leseverhalten ' + lab(A))}&body=${encodeURIComponent(text + '\n\n(Bitte das heruntergeladene PDF als Anhang hinzufügen.)')}`;
    setMsg('Das PDF wurde heruntergeladen und dein Mailprogramm öffnet sich. Bitte füge das PDF dort als Anhang hinzu.');
  });

  if (!sessions.length) return <Empty icon={BarChart3} title="Noch keine Daten" text="Sobald du Lesesessions erfasst hast, kannst du hier beliebige Zeiträume auswerten und vergleichen." />;
  const dates = (f: string, t: string, sf: (v: string) => void, st: (v: string) => void) => <div className="flex flex-wrap items-center gap-2 text-sm"><input className={inp} type="date" value={f} max={today} onChange={e => sf(e.target.value)} /><span>bis</span><input className={inp} type="date" value={t} max={today} onChange={e => st(e.target.value)} /></div>;
  return <div className="space-y-4">
    <div className={card + ' space-y-3'}><div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2"><div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Zeitraum A</div><select className={inp + ' w-full'} value={p} onChange={e => setP(e.target.value)}>{PRESETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{p === 'custom' && dates(cf, ct, setCf, setCt)}
        <div className="text-sm text-zinc-500">{errA ? <span className="text-red-600">Das Startdatum liegt nach dem Enddatum.</span> : lab(A)}</div></div>
      <div className="space-y-2"><div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Vergleich mit Zeitraum B</div><select className={inp + ' w-full'} value={mode} onChange={e => setMode(e.target.value)}>{MODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{mode === 'custom' && dates(bf, bt, setBf, setBt)}
        {B && <div className="text-sm text-zinc-500">{errB ? <span className="text-red-600">Das Startdatum liegt nach dem Enddatum.</span> : lab(B)}</div>}</div></div></div>
    {ok && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Seiten', de(sa.pages)], ['Lesezeit', fmtMin(sa.minutes)], ['Aktive Tage', de(sa.activeDays)], ['Bücher abgeschlossen', de(sa.finishedBooks)]].map(([l, v]) => <div key={l} className={card + ' !p-4'}><div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{l}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{v}</div></div>)}</div>
      <div className={card + ' overflow-x-auto'}><table className="w-full text-sm"><thead><tr className="text-left text-zinc-500"><th className="py-1">Kennzahl</th><th className="text-right">Zeitraum A</th>{sb && <><th className="text-right">Zeitraum B</th><th className="text-right">Veränderung</th></>}</tr></thead>
        <tbody>{rows.map(r => <tr key={r.l} className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-1.5">{r.l}</td><td className="text-right tabular-nums">{r.a}</td>{sb && <><td className="text-right tabular-nums">{r.b}</td><td className={`text-right tabular-nums ${r.c === 'good' ? 'text-emerald-600' : r.c === 'bad' ? 'text-red-600' : 'text-zinc-500'}`}>{r.d}</td></>}</tr>)}</tbody></table></div>
      <div className={card}><h3 className="mb-2 font-medium">Gelesene Seiten pro {bk.unit}</h3><div className="h-56"><ResponsiveContainer><BarChart data={bk.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="l" /><YAxis /><Tooltip /><Bar dataKey="pages" name="Seiten" fill="#6366f1" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
      {sb && <div className={card}><h3 className="mb-2 font-medium">Verlauf im Vergleich (Seiten kumuliert, ab Tag 1 des Zeitraums)</h3><div className="h-56"><ResponsiveContainer><LineChart data={cmpData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="d" /><YAxis /><Tooltip /><Legend /><Line type="monotone" dataKey="A" name="Zeitraum A" stroke="#6366f1" dot={false} strokeWidth={2} /><Line type="monotone" dataKey="B" name="Zeitraum B" stroke="#f59e0b" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div></div>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className={card}><h3 className="mb-2 font-medium">Lesegewohnheiten</h3>{hab.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{hab.map(h => <li key={h}>{h}</li>)}</ul> : <p className="text-sm text-zinc-500">Im Zeitraum A gibt es keine Sessions.</p>}</div>
        <div className={card}><h3 className="mb-2 font-medium">Meistgelesene Bücher (Zeitraum A)</h3>{top.length ? top.map(t => <div key={t.t} className="flex justify-between gap-2 border-b border-zinc-100 py-1 text-sm last:border-0 dark:border-zinc-700"><span className="truncate">{t.t}</span><span className="shrink-0 text-zinc-500">{de(t.p)} S. · {fmtMin(t.m)}</span></div>) : <p className="text-sm text-zinc-500">Keine Sessions im Zeitraum.</p>}
          {fin.length > 0 && <><h4 className="mt-3 text-sm font-medium">Abgeschlossen</h4><ul className="list-disc pl-5 text-sm">{fin.map(t => <li key={t}>{t}</li>)}</ul></>}</div></div></>}
    <div className={card + ' space-y-3'}><h3 className="font-medium">Als PDF exportieren oder per E-Mail senden</h3>
      <div className="flex flex-wrap items-center gap-2"><input className={inp} type="email" placeholder="E-Mail-Adresse (optional)" value={mail} onChange={e => setMail(e.target.value)} />
        <button className={btn} disabled={!ok || busy} onClick={() => void download()}><FileDown className="h-4 w-4" />PDF herunterladen</button>
        <button className={btn} disabled={!ok || busy} onClick={() => void send()}><Mail className="h-4 w-4" />Per E-Mail senden</button></div>
      {msg && <p className="text-sm text-indigo-700 dark:text-indigo-300">{msg}</p>}
      <p className="text-xs text-zinc-500">Das PDF enthält den gewählten Zeitraum, den Vergleich, ein Diagramm und die wichtigsten Bücher. Auf dem Handy öffnet „Per E-Mail senden“ die Teilen-Funktion mit angehängtem PDF. Am Computer wird das PDF heruntergeladen und dein Mailprogramm geöffnet – dort hängst du die Datei an.</p></div></div>;
}
