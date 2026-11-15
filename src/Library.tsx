import { useMemo, useState } from 'react';
import { ArrowUpDown, BookOpen, Filter, Layers } from 'lucide-react';
import { getSeriesStatus, remove, save } from './lib/data';
import { BookSearch } from './BookSearch';
import { BookEditor } from './Edit';
import { Empty, btn, card, inp } from './ui';
import { TZ } from './lib/tz';
import { dayKey, isValid, pagesOf, type Book, type Session } from './lib/stats';

export const BOOK_STATUS: Record<string, string> = { wishlist: 'Leseliste', reading: 'Aktuell am Lesen', paused: 'Pausiert', abandoned: 'Abgebrochen', finished: 'Abgeschlossen' };
const SORTS: [string, string][] = [['title', 'Titel A–Z'], ['title_desc', 'Titel Z–A'], ['author', 'Autor A–Z'], ['rating', 'Bewertung (beste zuerst)'], ['recent', 'Zuletzt gelesen'], ['progress', 'Fortschritt'], ['most', 'Meistgelesen (Lesezeit)'], ['series', 'Reihe & Band']];
const col = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
type Use = { last: string; min: number; pages: number };
const pct = (b: Book) => (b.status === 'finished' ? 100 : b.total_pages ? Math.min(100, (b.current_page / b.total_pages) * 100) : 0);
const uniq = (a: (string | null | undefined)[]) => [...new Set(a.filter((x): x is string => !!x && x.trim() !== ''))].sort(col.compare);
const fd = (k: string) => `${k.slice(8)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;
const nr = (b: Book) => (b.series_number == null ? 1e9 : Number(b.series_number));
const bySeries = (a: Book, b: Book) => (a.series_name ? 0 : 1) - (b.series_name ? 0 : 1) || col.compare(a.series_name ?? '', b.series_name ?? '') || nr(a) - nr(b) || col.compare(a.title, b.title);
const cmp = (k: string, u: Map<string, Use>) => (a: Book, b: Book): number => {
  const ua = u.get(a.id), ub = u.get(b.id), t = col.compare(a.title, b.title);
  switch (k) {
    case 'title_desc': return col.compare(b.title, a.title);
    case 'author': return (a.author ? 0 : 1) - (b.author ? 0 : 1) || col.compare(a.author, b.author) || t;
    case 'rating': return (b.rating ?? 0) - (a.rating ?? 0) || t;
    case 'recent': return (ub?.last ?? '').localeCompare(ua?.last ?? '') || t;
    case 'progress': return pct(b) - pct(a) || t;
    case 'most': return (ub?.min ?? 0) - (ua?.min ?? 0) || t;
    case 'series': return bySeries(a, b);
    default: return t;
  }
};
const Prog = ({ v }: { v: number }) => <div className="mt-2 h-2 rounded bg-zinc-200 dark:bg-zinc-700"><div className="h-2 rounded bg-indigo-500" style={{ width: `${Math.min(100, v)}%` }} /></div>;

export function Library({ books, sessions, uid }: { books: Book[]; sessions: Session[]; uid: string }) {
  const ls = (k: string, d: string) => localStorage.getItem(k) ?? d;
  const [f, setF] = useState({ title: '', author: '', genre: '', total_pages: 0, series_name: '', series_number: '' }), [err, setErr] = useState('');
  const [q, setQ] = useState(''), [st, setSt] = useState(''), [genre, setGenre] = useState(''), [author, setAuthor] = useState(''), [ser, setSer] = useState(''), [minR, setMinR] = useState(0);
  const [sort, setSort] = useState(ls('rt-book-sort', 'title')), [view, setView] = useState(ls('rt-book-view', 'list')), [ed, setEd] = useState<string | null>(null);
  const use = useMemo(() => { const m = new Map<string, Use>(); for (const s of sessions) { if (!isValid(s)) continue; const u = m.get(s.book_id) ?? { last: '', min: 0, pages: 0 }; if (s.session_date > u.last) u.last = s.session_date; u.min += s.duration_minutes; u.pages += pagesOf(s); m.set(s.book_id, u); } return m; }, [sessions]);
  const opts = useMemo(() => ({ genres: uniq(books.map(b => b.genre)), authors: uniq(books.map(b => b.author)), series: uniq(books.map(b => b.series_name)) }), [books]);
  const grouped = view === 'series';
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return books.filter(b => (!st || b.status === st) && (!genre || b.genre === genre) && (!author || b.author === author) && (!minR || (b.rating ?? 0) >= minR)
      && (!ser || (ser === '__none' ? !b.series_name : ser === '__any' ? !!b.series_name : b.series_name === ser)) && (!n || `${b.title} ${b.author} ${b.series_name ?? ''}`.toLowerCase().includes(n))).sort(cmp(grouped ? 'series' : sort, use));
  }, [books, q, st, genre, author, ser, minR, sort, grouped, use]);
  const groups = useMemo(() => { if (!grouped) return []; const m = new Map<string, Book[]>(); for (const b of list) { const k = b.series_name?.trim() || ''; m.set(k, [...(m.get(k) ?? []), b]); } return [...m.entries()].sort((a, b) => (a[0] === '' ? 1 : 0) - (b[0] === '' ? 1 : 0) || col.compare(a[0], b[0])); }, [list, grouped]);
  const filtered = !!(q || st || genre || author || ser || minR);
  const reset = () => { setQ(''); setSt(''); setGenre(''); setAuthor(''); setSer(''); setMinR(0); };

  const add = () => {
    if (!f.title.trim()) return;
    const sn = f.series_number.trim() === '' ? null : Number(f.series_number.replace(',', '.'));
    if (sn !== null && !(sn > 0)) return setErr('Die Band-Nummer muss größer als 0 sein.');
    if (sn !== null && !f.series_name.trim()) return setErr('Für eine Band-Nummer fehlt der Name der Reihe.');
    setErr('');
    void save('books', { id: crypto.randomUUID(), user_id: uid, title: f.title.trim(), author: f.author, genre: f.genre || null, series_name: f.series_name.trim() || null, series_number: sn, total_pages: f.total_pages, current_page: 0, status: 'wishlist', rating: null });
    setF({ title: '', author: '', genre: '', total_pages: 0, series_name: '', series_number: '' });
  };
  const upd = (b: Book, p: Partial<Book>) => { const n = { ...b, ...p }; if (p.status === 'finished') { n.finish_date = dayKey(new Date(), TZ); if (n.total_pages) n.current_page = n.total_pages; } void save('books', n, b.updated_at); };

  const item = (b: Book, inGroup: boolean) => {
    if (ed === b.id) return <div key={b.id} className={card}><BookEditor book={b} all={books} onClose={() => setEd(null)} /></div>;
    const u = use.get(b.id);
    return <div key={b.id} className={card + ' flex flex-wrap items-center justify-between gap-2'}><div>
      {b.cover_url && /^https?:\/\//.test(b.cover_url) && <img src={b.cover_url} alt="" referrerPolicy="no-referrer" className="mb-1 h-16 rounded object-cover" />}
      <div className="font-medium">{inGroup && b.series_number != null ? `Band ${b.series_number}: ` : ''}{b.title}</div>
      <div className="text-sm text-zinc-500">{b.author}{b.total_pages ? ` · ${Math.round((b.current_page / b.total_pages) * 100)} % (${b.current_page}/${b.total_pages})` : ''}</div>
      {!inGroup && b.series_name && <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-300"><Layers className="h-3 w-3" />{b.series_name}{b.series_number != null ? ` · Band ${b.series_number}` : ''}</div>}
      {u?.last && <div className="text-xs text-zinc-500">Zuletzt gelesen: {fd(u.last)} · {Math.round(u.min)} Min. gesamt</div>}</div>
      <div className="flex items-center gap-2"><select className={inp} value={b.status} onChange={e => upd(b, { status: e.target.value })}>{Object.entries(BOOK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className={inp} value={b.rating ?? ''} onChange={e => upd(b, { rating: e.target.value ? +e.target.value : null })}><option value="">★</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}★</option>)}</select>
        <button onClick={() => setEd(b.id)}>Bearbeiten</button><button className="text-red-600" onClick={() => confirm('Buch und zugehörige Sessions löschen?') && void remove('books', b.id)}>Löschen</button></div></div>;
  };

  const group = ([k, bs]: [string, Book[]]) => {
    const all = k ? books.filter(x => x.series_name === k).sort(bySeries) : [], done = all.filter(x => x.status === 'finished').length, next = all.find(x => x.status === 'reading') ?? all.find(x => x.status === 'wishlist' || x.status === 'paused');
    return <div key={k || '__none'} className="space-y-2"><div className={card + ' !p-4'}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-medium"><Layers className="h-4 w-4 text-indigo-500" />{k || 'Einzelbände (ohne Reihe)'}</h3>{k && <span className="text-xs text-zinc-500">{done} von {all.length} {all.length === 1 ? 'Band' : 'Bänden'} gelesen</span>}</div>
      {k && <Prog v={all.length ? (done / all.length) * 100 : 0} />}{k && next && <div className="mt-1 text-xs text-zinc-500">Als Nächstes: {next.series_number != null ? `Band ${next.series_number} – ` : ''}{next.title}</div>}</div>
      {bs.map(b => item(b, true))}</div>;
  };

  const tog = (v: string, l: string) => <button key={v} onClick={() => { setView(v); localStorage.setItem('rt-book-view', v); }} className={`rounded-lg px-3 py-1.5 text-sm ${view === v ? 'bg-indigo-600 text-white' : 'hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}>{l}</button>;
  return <div className="space-y-4"><BookSearch books={books} uid={uid} />
    {getSeriesStatus() === 'missing' && <div className="rounded-2xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-zinc-900 dark:text-amber-200">Für Reihen und Bandnummern fehlen noch zwei Datenbankfelder. Führe die Datei <b>004_series.sql</b> im Supabase-SQL-Editor aus (siehe README). Bis dahin werden Reihen nur auf diesem Gerät angezeigt und nicht gespeichert.</div>}
    <datalist id="rt-series">{opts.series.map(s => <option key={s} value={s} />)}</datalist>
    <div className={card + ' flex flex-wrap gap-2'}>
      <input className={inp} placeholder="Titel" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /><input className={inp} placeholder="Autor" value={f.author} onChange={e => setF({ ...f, author: e.target.value })} />
      <input className={inp} placeholder="Genre" value={f.genre} onChange={e => setF({ ...f, genre: e.target.value })} /><input className={inp + ' w-28'} type="number" min={0} placeholder="Seiten" value={f.total_pages || ''} onChange={e => setF({ ...f, total_pages: Math.max(0, +e.target.value) })} />
      <input className={inp} list="rt-series" maxLength={200} placeholder="Reihe (optional)" value={f.series_name} onChange={e => setF({ ...f, series_name: e.target.value })} /><input className={inp + ' w-28'} type="number" min={0} step="any" placeholder="Band-Nr." value={f.series_number} onChange={e => setF({ ...f, series_number: e.target.value })} />
      <button className={btn} onClick={add}>Buch hinzufügen</button>{err && <p className="w-full text-sm text-red-600">{err}</p>}</div>
    <div className={card + ' space-y-3'}>
      <div className="flex flex-wrap items-center gap-2"><Filter className="h-4 w-4 text-indigo-500" /><input className={inp} placeholder="Suchen (Titel, Autor, Reihe)…" value={q} onChange={e => setQ(e.target.value)} />
        <select className={inp} value={st} onChange={e => setSt(e.target.value)}><option value="">Alle Status</option>{Object.entries(BOOK_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className={inp} value={genre} onChange={e => setGenre(e.target.value)}><option value="">Alle Genres</option>{opts.genres.map(g => <option key={g}>{g}</option>)}</select>
        <select className={inp} value={author} onChange={e => setAuthor(e.target.value)}><option value="">Alle Autor*innen</option>{opts.authors.map(a => <option key={a}>{a}</option>)}</select>
        <select className={inp} value={ser} onChange={e => setSer(e.target.value)}><option value="">Alle Reihen</option><option value="__any">Nur Bücher in Reihen</option><option value="__none">Nur Einzelbände</option>{opts.series.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select className={inp} value={minR} onChange={e => setMinR(+e.target.value)}><option value={0}>Jede Bewertung</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>ab {n}★</option>)}</select>
        {filtered && <button onClick={reset}>Filter zurücksetzen</button>}</div>
      <div className="flex flex-wrap items-center gap-2 text-sm"><ArrowUpDown className="h-4 w-4 text-indigo-500" />
        <select className={inp} value={sort} disabled={grouped} onChange={e => { setSort(e.target.value); localStorage.setItem('rt-book-sort', e.target.value); }} aria-label="Sortierung">{SORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <div className="flex gap-1">{tog('list', 'Liste')}{tog('series', 'Nach Reihen')}</div><span className="text-zinc-500">{list.length} von {books.length} Büchern</span></div></div>
    {list.length === 0 && <Empty icon={BookOpen} title={books.length ? 'Keine Treffer' : 'Keine Bücher'} text={books.length ? 'Passe die Filter an oder setze sie zurück.' : 'Füge oben dein erstes Buch hinzu.'} />}
    {grouped ? groups.map(group) : list.map(b => item(b, false))}</div>;
}
