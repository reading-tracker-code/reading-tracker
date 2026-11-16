import { AlertTriangle, BarChart3, BookOpen, Cloud, CloudOff, FileText, LayoutDashboard, LogOut, Menu, Moon, RefreshCw, Settings as SettingsIcon, Sparkles, Sun, Target, Timer, Trophy, Users, type LucideIcon } from 'lucide-react';
import { Empty, Skeleton, SubTabs, btn, card, inp } from './ui';
import { useEffect, useMemo, useState } from 'react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from './lib/supabase';
import { gameReady, getAll, getConflicts, getGameStatus, getStatus, remove, save, sync, type SyncStatus } from './lib/data';
import { GameCtx, PopupLayer, useGame } from './Game';
import { protectedFrom, type GameEvent } from './lib/game';
import { Goals, Heat, Settings, type Goal } from './Extra';
import { Wrapped } from './Wrapped';
import { More, MORE_TABS } from './More';
import { Tour } from './Tour';
import { Friends, useFriends } from './Friends';
import { Library } from './Library';
import { Reports } from './Reports';
import { Motivation } from './Motivation';
import { useReminder } from './notify';
import { Dash } from './Dash';
import { Conflicts } from './Conflicts';
import { SessionEditor, deleteSession } from './Edit';
import { computeStats, dayKey, insights, rangeFor, setProtectedDays, type Book, type Session } from './lib/stats';

import { TZ } from './lib/tz';
const NAV = ['Dashboard', 'Meine Bücher', 'Lesesessions', 'Statistiken', 'Auswertungen', 'Leseziele', 'Motivation', 'Reading Wrapped', 'Freunde', 'Einstellungen'];
const STATUS_TXT: Record<SyncStatus, string> = { synced: 'Synchronisiert', syncing: 'Synchronisierung läuft', offline: 'Offline', failed: 'Synchronisierung fehlgeschlagen' };
const ghost = 'inline-flex items-center justify-center rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800';
const fmtMin = (m: number) => `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;

function useLive() {
  const [v, setV] = useState({ goals: [] as Goal[], books: [] as Book[], sessions: [] as Session[], events: [] as GameEvent[], status: getStatus(), conflicts: 0, ready: false, gameOk: false, gstat: getGameStatus() });
  useEffect(() => {
    const load = async () => {
      const events = await getAll<GameEvent>('game_events'); setProtectedDays(protectedFrom(events)); // Pausen/Schilde vor allen Streak-Berechnungen setzen
      setV({ ready: true, goals: await getAll<Goal>('reading_goals'), books: await getAll<Book>('books'), sessions: await getAll<Session>('reading_sessions'), events, status: getStatus(), conflicts: (await getConflicts()).length, gameOk: gameReady(), gstat: getGameStatus() });
    };
    void load(); ['rt-sync', 'rt-data'].forEach(e => window.addEventListener(e, load)); return () => ['rt-sync', 'rt-data'].forEach(e => window.removeEventListener(e, load));
  }, []);
  return v;
}

const UN = /^[A-Za-z0-9_.-]{3,20}$/, MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const authErr = (m: string) => /invalid login/i.test(m) ? 'E-Mail/Benutzername oder Passwort ist falsch.' : /not confirmed/i.test(m) ? 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in deinem Postfach).' : /already registered/i.test(m) ? 'Mit dieser E-Mail gibt es bereits ein Konto.' : m;
type AMode = 'unknown' | 'login' | 'signup' | 'nocheck';

// Anmeldung: Ein Feld für E-Mail oder Benutzername, ein Button. Die App erkennt selbst, ob das Konto schon existiert (Anmelden) oder neu ist (Konto erstellen).
function Auth() {
  const [ident, setIdent] = useState(''), [pw, setPw] = useState(''), [mail, setMail] = useState(''), [uname, setUname] = useState(''), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [mode, setMode] = useState<AMode>('unknown');
  const id = ident.trim(), isMail = id.includes('@');
  useEffect(() => {
    setMode('unknown'); if (id.length < 3) return;
    let dead = false;
    const t = setTimeout(async () => { const { data, error } = await supabase.rpc('auth_identify', { p_ident: id }); if (!dead) setMode(error ? 'nocheck' : data === 'exists' ? 'login' : 'signup'); }, 400);
    return () => { dead = true; clearTimeout(t); };
  }, [id]);
  const emailOf = async () => { if (isMail) return id; const { data } = await supabase.rpc('auth_login_email', { p_ident: id }); return (data as string | null) ?? null; };
  const submit = async (force?: 'login' | 'signup') => {
    if (!id || !pw) return setMsg('Bitte gib E-Mail bzw. Benutzernamen und Passwort ein.');
    setBusy(true); setMsg('');
    try {
      let m: AMode = force ?? mode;
      if (m === 'unknown') { const { data, error } = await supabase.rpc('auth_identify', { p_ident: id }); m = error ? 'nocheck' : data === 'exists' ? 'login' : 'signup'; setMode(m); }
      if (m === 'signup') {
        const email = isMail ? id : mail.trim(), name = isMail ? uname.trim() : id;
        if (!isMail && !MAIL.test(email)) return setMsg('Neu hier? Bitte gib noch deine E-Mail-Adresse an, um dein Konto zu erstellen.');
        if (!MAIL.test(email)) return setMsg('Bitte gib eine gültige E-Mail-Adresse an.');
        if (name && !UN.test(name)) return setMsg('Der Benutzername darf 3 bis 20 Zeichen lang sein: Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich.');
        if (pw.length < 8) return setMsg('Das Passwort muss mindestens 8 Zeichen lang sein.');
        if (name) { const f = await supabase.rpc('username_free', { p_name: name }); if (f.data === false) return setMsg('Dieser Benutzername ist leider schon vergeben.'); }
        const r = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.href, data: name ? { username: name } : {} } });
        setMsg(r.error ? authErr(r.error.message) : r.data.session ? '' : 'Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach und melde dich danach an.');
      } else {
        const email = await emailOf(); if (!email) return setMsg(authErr('Invalid login credentials'));
        const r = await supabase.auth.signInWithPassword({ email, password: pw }); setMsg(r.error ? authErr(r.error.message) : '');
      }
    } finally { setBusy(false); }
  };
  const reset = async () => {
    if (!id) return setMsg('Gib oben deine E-Mail-Adresse oder deinen Benutzernamen ein.');
    const email = await emailOf(); if (email) await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.href });
    setMsg('Falls es ein Konto dazu gibt, wurde eine E-Mail zum Zurücksetzen des Passworts gesendet.');
  };
  const label = busy ? 'Einen Moment…' : mode === 'login' ? 'Anmelden' : mode === 'signup' ? 'Konto erstellen' : mode === 'nocheck' ? 'Anmelden' : 'Weiter';
  return <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-zinc-50 to-violet-50 p-4 dark:from-zinc-950 dark:via-zinc-950 dark:to-indigo-950/40"><div className={card + ' w-full max-w-sm space-y-4 !p-6 rt-page'}>
    <div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-md shadow-indigo-600/30"><BookOpen className="h-5 w-5" /></div><div><div className="text-lg font-semibold tracking-tight">Reading Tracker</div><div className="text-xs text-zinc-500">Dein persönliches Lese-Dashboard</div></div></div>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <input className={inp + ' w-full'} placeholder="E-Mail oder Benutzername" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={ident} onChange={e => setIdent(e.target.value)} />
      {mode === 'signup' && !isMail && <input className={inp + ' w-full'} placeholder="E-Mail-Adresse für dein neues Konto" type="email" autoComplete="email" value={mail} onChange={e => setMail(e.target.value)} />}
      <input className={inp + ' w-full'} placeholder={mode === 'signup' ? 'Passwort (mind. 8 Zeichen)' : 'Passwort'} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onChange={e => setPw(e.target.value)} />
      {mode === 'signup' && isMail && <input className={inp + ' w-full'} placeholder="Benutzername (optional, zum Anmelden)" maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={uname} onChange={e => setUname(e.target.value)} />}
      {mode === 'signup' && <p className="text-xs text-zinc-500">Neu hier? Dazu gibt es noch kein Konto – mit einem Klick legen wir es für dich an.</p>}
      {mode === 'nocheck' && <p className="text-xs text-amber-700 dark:text-amber-300">Hinweis: Die automatische Erkennung ist noch nicht eingerichtet (Datei 006_username.sql im Supabase-SQL-Editor ausführen). Bis dahin: Anmelden oder Registrieren mit E-Mail.</p>}
      <button type="submit" className={btn + ' w-full'} disabled={busy}>{label}</button>
      {mode === 'nocheck' && <button type="button" className={ghost + ' w-full'} disabled={busy} onClick={() => void submit('signup')}>Registrieren</button>}</form>
    <button className="text-sm text-indigo-600 underline dark:text-indigo-300" onClick={() => void reset()}>Passwort zurücksetzen</button>
    <div className="flex justify-center gap-4 text-xs text-zinc-500"><a className="underline" href={import.meta.env.BASE_URL + 'datenschutz.html'}>Datenschutz</a></div>{msg && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{msg}</p>}</div></div>;
}

function Stat({ l, v }: { l: string; v: string | number }) { return <div className={card + ' !p-3 sm:!p-4'}><div className="text-[11px] font-medium uppercase leading-tight tracking-wide text-zinc-500 sm:text-xs">{l}</div><div className="mt-1 break-words text-xl font-semibold tabular-nums tracking-tight sm:text-2xl md:text-3xl">{v}</div></div>; }

function Dashboard({ books, sessions }: { books: Book[]; sessions: Session[] }) {
  const s = useMemo(() => computeStats(sessions, books, null, TZ), [sessions, books]);
  const yr = useMemo(() => computeStats(sessions, books, rangeFor('year', TZ), TZ), [sessions, books]);
  const last30 = useMemo(() => computeStats(sessions, books, rangeFor('30', TZ), TZ).daily, [sessions, books]);
  const tips = useMemo(() => insights(sessions, books, TZ), [sessions, books]);
  if (!sessions.length) return <p className={card}>Noch keine Lesesessions. Erfasse deine erste Session, dann erscheinen hier deine Statistiken.</p>;
  return <div className="space-y-4"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    <Stat l="Bücher dieses Jahr" v={yr.finishedBooks} /><Stat l="Seiten gesamt" v={s.pages} /><Stat l="Lesezeit gesamt" v={fmtMin(s.minutes)} />
    <Stat l="Seiten pro Stunde" v={s.pagesPerHour ? Math.round(s.pagesPerHour) : '–'} /><Stat l="Aktive Lesetage" v={s.activeDays} />
    <Stat l="Aktueller Streak" v={`${s.currentStreak} Tage`} /><Stat l="Längster Streak" v={`${s.longestStreak} Tage`} /><Stat l="Ø Min. pro Tag" v={Math.round(s.avgMinutesPerDay)} /></div>
    <div className={card}><h3 className="mb-2 font-medium">Gelesene Seiten (letzte 30 Tage, nur Tage mit Sessions)</h3>
      <div className="h-56"><ResponsiveContainer><BarChart data={last30}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" tickFormatter={d => d.slice(5)} /><YAxis /><Tooltip /><Bar dataKey="pages" name="Seiten" fill="#6366f1" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
    {tips.length > 0 && <div className={card}><h3 className="mb-2 font-medium">Erkenntnisse</h3><ul className="list-disc pl-5 text-sm">{tips.map(t => <li key={t}>{t}</li>)}</ul></div>}</div>;
}

type Timer = { start: string; acc: number; run: number | null };
function Sessions({ books, sessions, uid }: { books: Book[]; sessions: Session[]; uid: string }) {
  const K = 'rt-timer', [tm, setTm] = useState<Timer | null>(() => JSON.parse(localStorage.getItem(K) ?? 'null'));
  const [started, setStarted] = useState<string | null>(null), [, tick] = useState(0), [err, setErr] = useState('');
  const [f, setF] = useState({ book: '', start: 0, end: 0, min: 0, note: '' }), [ed, setEd] = useState<string | null>(null);
  useEffect(() => { const i = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(i); }, []);
  const persist = (v: Timer | null) => { setTm(v); if (v) localStorage.setItem(K, JSON.stringify(v)); else localStorage.removeItem(K); }; // überlebt Neuladen
  const ms = tm ? tm.acc + (tm.run ? Date.now() - tm.run : 0) : 0;
  const pick = (id: string) => setF(x => ({ ...x, book: id, start: books.find(b => b.id === id)?.current_page ?? 0 }));
  const stop = () => { if (!tm) return; setStarted(tm.start); setF(x => ({ ...x, min: Math.round(ms / 6000) / 10 })); persist(null); };
  const submit = () => {
    const b = books.find(x => x.id === f.book); if (!b) return setErr('Bitte ein Buch wählen.');
    if (f.end < f.start || f.start < 0) return setErr('Die Endseite muss ≥ Startseite sein.');
    if (b.total_pages && f.end > b.total_pages) return setErr('Endseite liegt über der Seitenzahl des Buchs.');
    if (f.min < 0) return setErr('Dauer ungültig.'); setErr('');
    const end = new Date(), start = started ? new Date(started) : new Date(end.getTime() - f.min * 60000);
    void save('reading_sessions', { id: crypto.randomUUID(), user_id: uid, book_id: b.id, session_date: dayKey(start, TZ), start_time: start.toISOString(), end_time: end.toISOString(), duration_minutes: f.min, start_page: f.start, end_page: f.end, notes: f.note || null });
    void save('books', { ...b, current_page: Math.max(b.current_page, f.end), status: b.status === 'wishlist' ? 'reading' : b.status, start_date: b.start_date ?? dayKey(start, TZ) }, b.updated_at);
    setF({ book: '', start: 0, end: 0, min: 0, note: '' }); setStarted(null);
  };
  const bt = (id: string) => books.find(b => b.id === id)?.title ?? '(gelöschtes Buch)', running = !!tm?.run, lbl = 'text-xs font-medium text-zinc-500', fdate = (k: string) => k.split('-').reverse().join('.');
  const sel = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();
  return <div className="space-y-4"><div className={card + ' space-y-3'}>
    <div className="flex items-center justify-between gap-3"><div><div className={lbl}>Lese-Timer</div><div className="font-mono text-4xl tabular-nums">{new Date(ms).toISOString().slice(11, 19)}</div></div>
      <div className="flex gap-2">{!tm && <button className={btn} onClick={() => persist({ start: new Date().toISOString(), acc: 0, run: Date.now() })}>Start</button>}
        {running && tm && <button className={btn} onClick={() => persist({ ...tm, acc: ms, run: null })}>Pause</button>}
        {tm && !running && <button className={btn} onClick={() => persist({ ...tm, run: Date.now() })}>Fortsetzen</button>}
        {tm && <button className={ghost} onClick={stop}>Stoppen</button>}</div></div>
    {started && <p className="text-sm text-indigo-700 dark:text-indigo-300">Timer gestoppt: {f.min} Min. wurden unten übernommen. Wähle noch das Buch und die Seiten und speichere die Session.</p>}</div>
    <div className={card + ' space-y-3'}><h3 className="font-medium">Session eintragen</h3>
      {books.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-300">Du hast noch kein Buch. Lege zuerst unter „Bücher“ eines an.</p>}
      <label className="block"><span className={lbl}>Buch</span><select className={inp + ' mt-1 w-full'} value={f.book} onChange={e => pick(e.target.value)}><option value="">Buch wählen</option>{books.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block"><span className={lbl}>Startseite</span><input className={inp + ' mt-1 w-full'} type="number" min={0} inputMode="numeric" value={f.start} onFocus={sel} onChange={e => setF({ ...f, start: +e.target.value })} /></label>
        <label className="block"><span className={lbl}>Endseite</span><input className={inp + ' mt-1 w-full'} type="number" min={0} inputMode="numeric" value={f.end} onFocus={sel} onChange={e => setF({ ...f, end: +e.target.value })} /></label>
        <label className="block"><span className={lbl}>Minuten</span><input className={inp + ' mt-1 w-full'} type="number" min={0} step="0.1" inputMode="decimal" value={f.min} onFocus={sel} onChange={e => setF({ ...f, min: +e.target.value })} /></label></div>
      <label className="block"><span className={lbl}>Notiz (optional)</span><input className={inp + ' mt-1 w-full'} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      {err && <p className="text-sm text-red-600">{err}</p>}<button className={btn + ' w-full sm:w-auto'} onClick={submit}>Session speichern</button></div>
    {sessions.length > 0 && <h3 className="pt-1 font-medium">Letzte Sessions</h3>}
    {[...sessions].sort((a, b) => (b.start_time ?? b.session_date).localeCompare(a.start_time ?? a.session_date)).slice(0, 100).map(s => <div key={s.id} className={card + ' !p-3 text-sm'}>{ed === s.id ? <SessionEditor s={s} books={books} sessions={sessions} onClose={() => setEd(null)} /> : <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><div className="truncate font-medium">{bt(s.book_id)}</div><div className="text-zinc-500">{fdate(s.session_date)} · S. {s.start_page}–{s.end_page} · {s.end_page - s.start_page} Seiten · {Math.round(s.duration_minutes)} Min.</div></div>
      <div className="flex shrink-0 gap-1"><button onClick={() => setEd(s.id)}>Bearbeiten</button><button className="text-red-600" onClick={() => confirm('Session löschen?') && void deleteSession(s, sessions, books)}>Löschen</button></div></div>}</div>)}</div>;
}

// Statistik-Seite: Zeitraum, Heatmap und die weiteren Auswertungen als Reiter statt als eine lange Seite.
function StatsPage({ books, sessions }: { books: Book[]; sessions: Session[] }) {
  const [t, setT] = useState(0);
  return <div className="space-y-4"><SubTabs tabs={['Zeitraum', 'Heatmap', ...MORE_TABS].map(x => ({ t: x }))} value={t} onChange={setT} />
    {t === 0 && <Statistics books={books} sessions={sessions} />}{t === 1 && <Heat books={books} sessions={sessions} />}{t >= 2 && <More books={books} sessions={sessions} tab={t - 2} />}</div>;
}

function Statistics({ books, sessions }: { books: Book[]; sessions: Session[] }) {
  const [p, setP] = useState(localStorage.getItem('rt-period') ?? '30'), [pick, setPick] = useState<string | null>(null);
  const s = useMemo(() => computeStats(sessions, books, rangeFor(p, TZ), TZ), [p, sessions, books]);
  const opts: [string, string][] = [['7', '7 Tage'], ['30', '30 Tage'], ['90', '90 Tage'], ['month', 'Aktueller Monat'], ['lastmonth', 'Letzter Monat'], ['year', 'Aktuelles Jahr'], ['lastyear', 'Letztes Jahr'], ['all', 'Gesamt']];
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return <div className="space-y-4"><select className={inp} value={p} onChange={e => setP(e.target.value)}>{opts.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat l="Seiten" v={s.pages} /><Stat l="Lesezeit" v={fmtMin(s.minutes)} /><Stat l="Sessions" v={s.sessionsCount} /><Stat l="Ø Min./Session" v={Math.round(s.avgSessionMinutes)} />
      <Stat l="Aktive Tage" v={s.activeDays} /><Stat l="Lesefreie Tage" v={s.restDays} /><Stat l="Ø Seiten/Tag" v={s.avgPagesPerDay.toFixed(1)} /><Stat l="Seiten/Stunde" v={s.pagesPerHour ? Math.round(s.pagesPerHour) : '–'} />
      <Stat l="Längste Session" v={`${Math.round(s.record.longestSession)} Min.`} /><Stat l="Max. Seiten/Tag" v={s.record.maxPagesDay ? `${s.record.maxPagesDay.pages} (${s.record.maxPagesDay.day})` : '–'} /></div>
    <div className={card}><h3 className="mb-2 font-medium">Lesezeit pro Tag (Min.)</h3><div className="h-56"><ResponsiveContainer><BarChart data={s.daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" tickFormatter={d => d.slice(5)} /><YAxis /><Tooltip /><Bar dataKey="minutes" name="Minuten" fill="#6366f1" radius={[6, 6, 0, 0]} cursor="pointer" onClick={(d: any) => setPick(d?.day ?? null)} /></BarChart></ResponsiveContainer></div></div>
    {pick && <div className={card + ' text-sm'}><b>{pick}</b>{sessions.filter(x => x.session_date === pick).map(x => <div key={x.id}>{books.find(b => b.id === x.book_id)?.title ?? '(gelöschtes Buch)'} · S. {x.start_page}–{x.end_page} · {Math.round(x.duration_minutes)} Min.</div>)}</div>}<div className={card}><h3 className="mb-2 font-medium">Lesezeit nach Wochentag (Min. gesamt)</h3><div className="h-48"><ResponsiveContainer><BarChart data={s.weekday.map((v, i) => ({ d: wd[i], minutes: Math.round(v.minutes) }))}><XAxis dataKey="d" /><YAxis /><Tooltip /><Bar dataKey="minutes" fill="#8b5cf6" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div></div>;
}

const NAVI: LucideIcon[] = [LayoutDashboard, BookOpen, Timer, BarChart3, FileText, Target, Trophy, Sparkles, Users, SettingsIcon];
const SYNC: Record<SyncStatus, { Icon: LucideIcon; cls: string }> = {
  synced: { Icon: Cloud, cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
  syncing: { Icon: RefreshCw, cls: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300' },
  offline: { Icon: CloudOff, cls: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
  failed: { Icon: AlertTriangle, cls: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' },
};

export default function App() {
  const [auth, setAuth] = useState<AuthSession | null | undefined>(undefined), [tab, setTab] = useState(0), [more, setMore] = useState(false), [tour, setTour] = useState(false), [dark, setDark] = useState(localStorage.getItem('rt-theme') ? localStorage.getItem('rt-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  const { books, sessions, goals, events, status, conflicts, ready, gameOk, gstat } = useLive();
  useReminder(sessions, goals);
  const game = useGame({ uid: auth?.user.id ?? null, books, sessions, events, ready, gameOk, gstat });
  const fr = useFriends({ uid: auth?.user.id ?? null, books, sessions, ready, xp: game.xp, level: game.lvl.level, title: game.lvl.title });
  useEffect(() => { supabase.auth.getSession().then(r => setAuth(r.data.session)); const { data } = supabase.auth.onAuthStateChange((_e, s) => { setAuth(s); if (s) void sync(); }); return () => data.subscription.unsubscribe(); }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  useEffect(() => { const h = () => setTour(true); window.addEventListener('rt-tour', h); return () => window.removeEventListener('rt-tour', h); }, []);
  // Einstiegstour: einmalig für neue Nutzer*innen (erst nach dem ersten Abgleich, damit Bestandskonten auf neuen Geräten sie nicht sehen)
  useEffect(() => { if (!auth || !ready || !(gameOk || gstat === 'missing') || books.length || sessions.length) return; if (!localStorage.getItem(`rt-tour-${auth.user.id}`)) setTour(true); }, [auth?.user.id, ready, gameOk, gstat, books.length, sessions.length]);
  useEffect(() => { if (!auth) return; void supabase.from('profiles').select('timezone,preferred_theme').eq('id', auth.user.id).maybeSingle().then(({ data }) => { if (!data) return; if (data.preferred_theme) { localStorage.setItem('rt-theme', data.preferred_theme); setDark(data.preferred_theme === 'dark'); } if (data.timezone && data.timezone !== TZ) { localStorage.setItem('rt-tz', data.timezone); location.reload(); } }); }, [auth?.user.id]);
  if (auth === undefined) return <div className="p-6"><Skeleton /></div>;
  if (!auth) return <Auth />;
  const uid = auth.user.id, go = (i: number) => { setTab(i); setMore(false); window.scrollTo({ top: 0 }); };
  const toggleTheme = () => { const n = !dark; setDark(n); localStorage.setItem('rt-theme', n ? 'dark' : 'light'); void supabase.from('profiles').update({ preferred_theme: n ? 'dark' : 'light' }).eq('id', uid); };
  const { Icon: SIcon, cls } = SYNC[status], spin = status === 'syncing' ? 'animate-spin' : '';
  const pillFull = <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`} title="Synchronisierungsstatus"><SIcon className={`h-3.5 w-3.5 ${spin}`} />{STATUS_TXT[status]}</span>;
  const pillMini = <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${cls}`} title={STATUS_TXT[status]} role="img" aria-label={STATUS_TXT[status]}><SIcon className={`h-4 w-4 ${spin}`} /></span>;
  const confBtn = conflicts > 0 && <button className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" onClick={() => go(9)}>{conflicts} Konflikt(e)</button>;
  const logo = <div className="flex items-center gap-2.5"><div className="rounded-xl bg-indigo-600 p-2 text-white shadow-md shadow-indigo-600/30"><BookOpen className="h-4 w-4" /></div><span className="font-semibold tracking-tight">Reading Tracker</span></div>;
  const side = (i: number) => { const I = NAVI[i]; return <button key={i} onClick={() => go(i)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${tab === i ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200' : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/70'}`}><I className="h-[18px] w-[18px]" />{NAV[i]}{i === 8 && fr.pending > 0 && <span className="ml-auto rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white">{fr.pending}</span>}</button>; };
  const bot = (i: number, label: string) => { const I = NAVI[i]; return <button key={i} onClick={() => go(i)} aria-current={tab === i ? 'page' : undefined} className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${tab === i ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500'}`}><span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${tab === i ? 'bg-indigo-100 dark:bg-indigo-500/20' : ''}`}><I className="h-5 w-5" /></span>{label}</button>; };
  const tile = (i: number) => { const I = NAVI[i]; return <button key={i} onClick={() => go(i)} className={`relative flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-medium ${tab === i ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200' : 'bg-zinc-50 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300'}`}><I className="h-6 w-6" />{NAV[i]}{i === 8 && fr.pending > 0 && <span className="absolute right-2 top-2 rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">{fr.pending}</span>}</button>; };
  const themeBtn = <button onClick={toggleTheme} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/70">{dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}{dark ? 'Heller Modus' : 'Dunkler Modus'}</button>;
  const outBtn = <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/70"><LogOut className="h-[18px] w-[18px]" />Abmelden</button>;
  return <GameCtx.Provider value={game}><div className="min-h-screen md:pl-64">
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col gap-1 border-r border-zinc-200 bg-white/80 p-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80 md:flex"><div className="mb-5 px-1 pt-1">{logo}</div>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(side)}<div className="mt-auto flex flex-col gap-1"><div className="flex flex-wrap items-center gap-2 px-1 pb-2">{pillFull}{confBtn}</div>{themeBtn}{outBtn}</div></aside>
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-zinc-200 bg-white/85 px-4 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85 md:hidden" style={{ paddingTop: 'max(.625rem, env(safe-area-inset-top))' }}>
      <div className="flex min-w-0 items-center gap-2.5"><div className="shrink-0 rounded-xl bg-indigo-600 p-1.5 text-white shadow-md shadow-indigo-600/30"><BookOpen className="h-4 w-4" /></div><h1 className="truncate font-semibold tracking-tight">{NAV[tab]}</h1></div>
      <div className="flex shrink-0 items-center gap-2">{confBtn}{pillMini}</div></header>
    <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-8 md:pb-12 md:pt-8"><h1 className="mb-5 hidden text-3xl font-semibold tracking-tight md:block">{NAV[tab]}</h1>
      <div key={tab} className="rt-page">{!ready ? <Skeleton /> : <>
        {tab === 0 && <Dash books={books} sessions={sessions} goals={goals} onWrapped={() => go(7)} onSession={() => go(2)} />}{tab === 1 && <Library books={books} sessions={sessions} uid={uid} />}{tab === 2 && <Sessions books={books} sessions={sessions} uid={uid} />}
        {tab === 3 && <StatsPage books={books} sessions={sessions} />}
        {tab === 4 && <Reports books={books} sessions={sessions} />}{tab === 5 && <Goals goals={goals} books={books} sessions={sessions} uid={uid} />}{tab === 6 && <Motivation books={books} sessions={sessions} goals={goals} />}{tab === 7 && <Wrapped books={books} sessions={sessions} />}
        {tab === 8 && <Friends fr={fr} books={books} sessions={sessions} uid={uid} />}
        {tab === 9 && <><Conflicts /><Settings books={books} sessions={sessions} goals={goals} events={events} uid={uid} /></>}</>}</div></main>
    {more && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMore(false)}><div className="rt-page absolute inset-x-3 rounded-3xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-900" style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
      <div className="grid grid-cols-3 gap-2">{[4, 5, 6, 7, 8, 9].map(tile)}</div><div className="mt-2 grid grid-cols-2 gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">{themeBtn}{outBtn}</div></div></div>}
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90 md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {bot(0, 'Start')}{bot(1, 'Bücher')}{bot(2, 'Sessions')}{bot(3, 'Statistik')}
      <button onClick={() => setMore(!more)} aria-expanded={more} className={`relative flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium ${tab >= 4 || more ? 'text-indigo-600 dark:text-indigo-300' : 'text-zinc-500'}`}><span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${tab >= 4 || more ? 'bg-indigo-100 dark:bg-indigo-500/20' : ''}`}><Menu className="h-5 w-5" /></span>Mehr{fr.pending > 0 && <span className="absolute right-4 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400" />}</button></nav>
    {tour && <Tour onClose={t => { localStorage.setItem(`rt-tour-${uid}`, '1'); setTour(false); if (t !== undefined) go(t); }} />}<PopupLayer /></div></GameCtx.Provider>;
}
