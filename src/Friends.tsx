import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Lock, Target, Trophy, UserPlus, Users, X } from 'lucide-react';
import { supabase } from './lib/supabase';
import { useG } from './Game';
import { TZ } from './lib/tz';
import { dayKey, type Book, type Session } from './lib/stats';
import { DEFAULT_SHARE, METRIC, SHARE, call, daysLeft, enableFriends, fd, isFrozen, isMissing, maskStats, myProgress, mySnapshot, phase, plusDays, saveSettings, type Challenge, type FRel, type FSettings, type FStats, type Metric } from './lib/friends';
import { Empty, Skeleton, SubTabs, btn, card, inp } from './ui';

const de = (n: number) => n.toLocaleString('de-DE');
const ghost = 'rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700';
const NOTICE = 'rounded-2xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-zinc-900 dark:text-amber-200';

// ---------- Hook: lädt Freunde/Challenges und veröffentlicht deine (gefilterte) Zusammenfassung sowie deinen Challenge-Fortschritt ----------
type FState = { state: 'loading' | 'missing' | 'off' | 'on' | 'error'; err: string; settings: FSettings | null; rels: FRel[]; challenges: Challenge[] };
export type FriendsApi = FState & { pending: number; reload: () => Promise<void> };
const INIT: FState = { state: 'loading', err: '', settings: null, rels: [], challenges: [] };

export function useFriends(p: { uid: string | null; books: Book[]; sessions: Session[]; ready: boolean; xp: number; level: number; title: string }): FriendsApi {
  const { uid, books, sessions, ready, xp, level, title } = p;
  const [v, setV] = useState<FState>(INIT);
  const last = useRef(''), prog = useRef(new Map<string, number>());
  const today = dayKey(new Date(), TZ);

  const reload = useCallback(async () => {
    if (!uid) return;
    try {
      const s = await supabase.from('friend_settings').select('*').eq('user_id', uid).maybeSingle();
      if (s.error) { const msg = s.error.message; return setV(x => ({ ...x, state: isMissing(s.error) ? 'missing' : 'error', err: msg })); }
      if (!s.data) return setV({ ...INIT, state: 'off' });
      const [r, c] = await Promise.all([supabase.rpc('friends_overview'), supabase.rpc('challenges_overview')]);
      const e = r.error ?? c.error;
      if (e) return setV(x => ({ ...x, state: isMissing(e) ? 'missing' : 'error', err: e.message }));
      setV({ state: 'on', err: '', settings: s.data as FSettings, rels: (r.data ?? []) as FRel[], challenges: (c.data ?? []) as Challenge[] });
    } catch (e) { setV(x => ({ ...x, state: 'error', err: (e as Error).message })); }
  }, [uid]);

  useEffect(() => {
    last.current = ''; prog.current.clear();
    if (!uid) { setV(INIT); return; }
    void reload();
    const vis = () => { if (!document.hidden) void reload(); }, t = setInterval(vis, 60000);
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [uid, reload]);

  // Veröffentlichen: erst nach kurzer Pause (2,5 s) und nur bei Änderungen.
  useEffect(() => {
    if (!uid || !ready || v.state !== 'on') return;
    let dead = false;
    const tm = setTimeout(async () => {
      try {
        const snap = mySnapshot(books, sessions, xp, level, title, TZ), sig = JSON.stringify(snap) + today;
        if (sig !== last.current) {
          const now = new Date().toISOString(), { error } = await supabase.from('friend_stats').upsert({ user_id: uid, data: { ...snap, updated_at: now }, updated_at: now });
          if (error) throw error;
          last.current = sig;
        }
        let changed = false;
        for (const c of v.challenges) {
          if (c.my_status !== 'joined' || isFrozen(c, today)) continue;
          const val = myProgress(c, sessions, books, TZ), known = prog.current.get(c.id) ?? c.members.find(m => m.user_id === uid)?.progress ?? 0;
          if (val !== known) { await call('challenge_progress', { p_id: c.id, p_value: val }); prog.current.set(c.id, val); changed = true; }
        }
        if (changed && !dead) await reload();
      } catch (e) { console.error(e); }
    }, 2500);
    return () => { dead = true; clearTimeout(tm); };
  }, [uid, ready, v.state, v.challenges, books, sessions, xp, level, title, today, reload]);

  const pending = v.rels.filter(r => r.state === 'incoming').length + v.challenges.filter(c => c.my_status === 'invited').length;
  return { ...v, pending, reload };
}

// ---------- kleine Bausteine ----------
type Act = (fn: () => Promise<string | void>) => Promise<void>;
const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium dark:bg-zinc-800">{children}</span>;
const Bar = ({ pct, me, ok }: { pct: number; me?: boolean; ok?: boolean }) => <div className="mt-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800"><div className={`h-2 rounded-full transition-all ${ok ? 'bg-emerald-500' : me ? 'bg-indigo-500' : 'bg-violet-400'}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
const Toggle = ({ on, onChange, t, d }: { on: boolean; onChange: (v: boolean) => void; t: string; d: string }) => <label className="flex cursor-pointer items-start gap-3 py-2"><input type="checkbox" className="mt-1 h-4 w-4 accent-indigo-600" checked={on} onChange={e => onChange(e.target.checked)} /><span className="text-sm"><span className="block font-medium">{t}</span><span className="text-zinc-500">{d}</span></span></label>;
const Sec = ({ title, children }: { title: string; children: ReactNode }) => <section className="space-y-3"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{children}</section>;

function Stats({ s }: { s: FStats | null }) {
  if (!s) return <p className="text-xs text-zinc-500">Noch keine Daten – die Person muss die App einmal geöffnet haben.</p>;
  const chips = [
    s.level !== undefined && `Level ${s.level}${s.title ? ` · ${s.title}` : ''}${s.xp !== undefined ? ` · ${de(s.xp)} XP` : ''}`,
    s.streak !== undefined && `Streak: ${s.streak} Tag${s.streak === 1 ? '' : 'e'}`,
    s.week_pages !== undefined && `Diese Woche: ${de(s.week_pages)} Seiten · ${de(s.week_minutes ?? 0)} Min. · ${s.week_days ?? 0} Lesetage`,
    s.year_books !== undefined && `${s.year_books} ${s.year_books === 1 ? 'Buch' : 'Bücher'} in diesem Jahr`,
    s.total_pages !== undefined && `${de(s.total_pages)} Seiten gesamt`,
    s.current_book && `Liest gerade: ${s.current_book}`,
  ].filter((x): x is string => !!x);
  return chips.length ? <div className="flex flex-wrap gap-1.5">{chips.map(c => <Chip key={c}>{c}</Chip>)}</div> : <p className="text-xs text-zinc-500">Diese Person teilt aktuell keine Werte.</p>;
}

function ShareToggles({ v, set }: { v: Record<string, boolean>; set: (k: string, on: boolean) => void }) {
  return <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{SHARE.map(x => <Toggle key={x.k} on={!!v[x.k]} onChange={on => set(x.k, on)} t={x.t} d={x.d} />)}</div>;
}

const PRIVATE_NOTE = 'Nie geteilt: deine E-Mail-Adresse, Buchtitel (außer optional das aktuelle Buch), einzelne Sessions, Notizen, Bewertungen und Leseziele.';

// ---------- Einschalten ----------
function Activate({ uid, onDone }: { uid: string; onDone: () => Promise<void> }) {
  const [nick, setNick] = useState(''), [sh, setSh] = useState<Record<string, boolean>>({ ...DEFAULT_SHARE }), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const go = async () => {
    if (nick.trim().length < 2) return setMsg('Bitte wähle einen Namen mit mindestens 2 Zeichen.');
    setBusy(true); setMsg('');
    try { await enableFriends(uid, nick.trim(), sh as typeof DEFAULT_SHARE); await onDone(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return <div className={card + ' space-y-4'}><div className="flex items-center gap-3"><div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300"><Users className="h-6 w-6" /></div><div><div className="font-semibold">Mit Freund*innen lesen</div><p className="text-sm text-zinc-500">Verbinde dich per Freundes-Code, vergleicht euch in der Wochen-Rangliste und startet Challenges oder gemeinsame Ziele.</p></div></div>
    <label className="block text-sm font-medium">Dein Name für Freund*innen<input className={inp + ' mt-1 w-full'} maxLength={30} placeholder="z. B. Lena" value={nick} onChange={e => setNick(e.target.value)} /><span className="mt-1 block text-xs font-normal text-zinc-500">Dieser Name wird deinen Freund*innen angezeigt – nicht deine E-Mail-Adresse.</span></label>
    <div><div className="text-sm font-medium">Das dürfen deine Freund*innen sehen</div><ShareToggles v={sh} set={(k, on) => setSh(x => ({ ...x, [k]: on }))} /><p className="flex items-start gap-2 text-xs text-zinc-500"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />{PRIVATE_NOTE} Du kannst alles jederzeit unter „Datenschutz“ ändern oder die Funktion komplett ausschalten.</p></div>
    {msg && <p className="text-sm text-red-600">{msg}</p>}<button className={btn} disabled={busy} onClick={() => void go()}>{busy ? 'Einen Moment…' : 'Freundes-Funktion einschalten'}</button></div>;
}

// ---------- Tab 1: Freunde ----------
const REQ: Record<string, string> = { sent: 'Anfrage gesendet. Sobald die Person annimmt, erscheint sie in deiner Freundesliste.', accepted: 'Ihr seid jetzt befreundet – die Person hatte dir bereits eine Anfrage geschickt.', already_friends: 'Ihr seid schon befreundet.', already_sent: 'Du hast dieser Person bereits eine Anfrage gesendet.', not_found: 'Zu diesem Code wurde niemand gefunden. Bitte prüfe die Schreibweise.', self: 'Das ist dein eigener Code.', not_enabled: 'Schalte zuerst die Freundes-Funktion ein.', too_many: 'Du hast schon sehr viele offene Anfragen. Warte, bis einige beantwortet sind.', auth: 'Bitte melde dich erneut an.' };

function FriendsTab({ fr, me, act, challenge }: { fr: FriendsApi; me: FStats; act: Act; challenge: (id: string) => void }) {
  const s = fr.settings as FSettings, [code, setCode] = useState(''), [copied, setCopied] = useState(false);
  const mine = s.friend_code.slice(0, 4) + '-' + s.friend_code.slice(4);
  const inc = fr.rels.filter(r => r.state === 'incoming'), out = fr.rels.filter(r => r.state === 'outgoing'), fl = fr.rels.filter(r => r.state === 'friend');
  const copy = () => { const p = navigator.clipboard?.writeText(s.friend_code); if (p) void p.then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  const rows = [{ n: 'Du', p: me.week_pages ?? 0, m: me.week_minutes ?? 0, me: true }, ...fl.filter(r => r.stats?.week_pages !== undefined).map(r => ({ n: r.nickname, p: r.stats?.week_pages ?? 0, m: r.stats?.week_minutes ?? 0, me: false }))].sort((a, b) => b.p - a.p);
  const max = Math.max(1, ...rows.map(r => r.p));
  return <div className="space-y-6">
    <div className="grid gap-3 md:grid-cols-2">
      <div className={card + ' space-y-3'}><h3 className="font-medium">Dein Freundes-Code</h3>
        <div className="flex flex-wrap items-center gap-3"><div className="rounded-xl bg-zinc-100 px-4 py-2 font-mono text-2xl font-semibold tracking-widest dark:bg-zinc-800">{mine}</div>
          <button className={ghost + ' inline-flex items-center gap-2'} onClick={copy}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Kopiert' : 'Kopieren'}</button></div>
        <p className="text-xs text-zinc-500">Schicke diesen Code an Menschen, mit denen du befreundet sein möchtest. Wer den Code kennt, kann dir eine Anfrage senden – du entscheidest, ob du sie annimmst.</p>
        <button className="text-sm text-indigo-600 underline dark:text-indigo-300" onClick={() => void act(async () => { if (!confirm('Neuen Code erzeugen? Der alte Code funktioniert danach nicht mehr. Bestehende Freundschaften bleiben erhalten.')) return; await call('friend_new_code'); return 'Neuer Code erzeugt.'; })}>Neuen Code erzeugen</button></div>
      <div className={card + ' space-y-3'}><h3 className="flex items-center gap-2 font-medium"><UserPlus className="h-4 w-4 text-indigo-500" />Freund*in hinzufügen</h3>
        <div className="flex gap-2"><input className={inp + ' min-w-0 flex-1 font-mono uppercase tracking-widest'} placeholder="CODE" maxLength={9} value={code} onChange={e => setCode(e.target.value)} />
          <button className={btn} disabled={code.replace(/[\s-]/g, '').length < 8} onClick={() => void act(async () => { const r = await call<string>('send_friend_request', { p_code: code.replace(/[\s-]/g, '') }); if (r === 'sent' || r === 'accepted') setCode(''); return REQ[r] ?? 'Unbekannte Antwort.'; })}>Anfrage senden</button></div>
        <p className="text-xs text-zinc-500">Gib den Code der anderen Person ein.</p></div></div>

    {inc.length > 0 && <Sec title={`Anfragen an dich (${inc.length})`}>{inc.map(r => <div key={r.friendship_id} className={card + ' flex flex-wrap items-center justify-between gap-2'}><div><div className="font-medium">{r.nickname}</div><div className="text-xs text-zinc-500">möchte mit dir befreundet sein · {fd(r.since.slice(0, 10))}</div></div>
      <div className="flex gap-2"><button className={btn} onClick={() => void act(async () => { await call('friend_respond', { p_id: r.friendship_id, p_accept: true }); return `${r.nickname} ist jetzt in deiner Freundesliste.`; })}><Check className="h-4 w-4" />Annehmen</button>
        <button className={ghost} onClick={() => void act(() => call('friend_respond', { p_id: r.friendship_id, p_accept: false }))}>Ablehnen</button></div></div>)}</Sec>}
    {out.length > 0 && <Sec title="Gesendete Anfragen">{out.map(r => <div key={r.friendship_id} className={card + ' flex items-center justify-between gap-2 text-sm'}><span>Warte auf Antwort von <b>{r.nickname}</b></span><button onClick={() => void act(() => call('friend_remove', { p_id: r.friendship_id }))}>Zurückziehen</button></div>)}</Sec>}

    <Sec title={`Deine Freund*innen (${fl.length})`}>
      {fl.length === 0 ? <Empty icon={Users} title="Noch keine Freund*innen" text="Tausche deinen Code mit jemandem aus oder gib oben einen Code ein." /> : fl.map(r => <div key={r.friendship_id} className={card + ' space-y-2'}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{r.nickname}</div>
          <div className="flex gap-2"><button className="text-indigo-600 dark:text-indigo-300" onClick={() => challenge(r.other_id)}>Challenge starten</button><button className="text-red-600" onClick={() => void act(async () => { if (!confirm(`${r.nickname} aus deiner Freundesliste entfernen?`)) return; await call('friend_remove', { p_id: r.friendship_id }); return `${r.nickname} wurde entfernt.`; })}>Entfernen</button></div></div>
        <Stats s={r.stats} />{r.stats?.updated_at && <div className="text-[11px] text-zinc-400">Stand: {fd(r.stats.updated_at.slice(0, 10))}</div>}</div>)}</Sec>

    {rows.length > 1 && <Sec title="Wochen-Rangliste (Seiten)"><div className={card + ' space-y-3'}>{rows.map((r, i) => <div key={r.n + i} className="text-sm"><div className="flex justify-between gap-2"><span className={r.me ? 'font-semibold' : ''}>{i + 1}. {r.n}</span><span className="tabular-nums text-zinc-500">{de(r.p)} Seiten · {de(r.m)} Min.</span></div><Bar pct={r.p / max * 100} me={r.me} /></div>)}
      <p className="text-xs text-zinc-500">Es erscheinen nur Freund*innen, die ihre Wochenwerte teilen. Die Woche läuft von Montag bis Sonntag.</p></div></Sec>}</div>;
}

// ---------- Tab 2: Challenges ----------
function ChallengeCard({ c, uid, books, sessions, act, today }: { c: Challenge; uid: string; books: Book[]; sessions: Session[]; act: Act; today: string }) {
  const mine = useMemo(() => myProgress(c, sessions, books, TZ), [c, sessions, books]);
  const m = METRIC[c.metric], ph = phase(c, today), own = c.creator_id === uid;
  const rows = c.members.filter(x => x.status === 'joined').map(x => ({ ...x, v: x.user_id === uid ? mine : x.progress ?? 0, me: x.user_id === uid })).sort((a, b) => b.v - a.v);
  const invited = c.members.filter(x => x.status === 'invited'), total = rows.reduce((a, r) => a + r.v, 0), max = Math.max(1, ...rows.map(r => r.v)), tgt = c.target ?? 0, reached = c.kind === 'shared' && tgt > 0 && total >= tgt;
  const state = ph === 'soon' ? `Startet am ${fd(c.start_date)}` : ph === 'live' ? `Noch ${daysLeft(c, today)} Tag${daysLeft(c, today) === 1 ? '' : 'e'}` : 'Beendet';
  return <div className={card + ' space-y-3'}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-medium">{c.title}</div><div className="text-xs text-zinc-500">{c.kind === 'shared' ? `Gemeinsames Ziel: ${de(tgt)} ${m.unit}` : `Wettbewerb: wer schafft die meisten ${m.label === 'Bücher abschließen' ? 'Bücher' : m.label}?`} · {fd(c.start_date)} – {fd(c.end_date)}</div></div>
      <div className="flex items-center gap-2"><Chip>{state}</Chip><button className="text-red-600" onClick={() => void act(async () => { if (!confirm(own ? 'Challenge für alle Beteiligten löschen?' : 'Diese Challenge verlassen?')) return; await call('challenge_leave', { p_id: c.id }); })}>{own ? 'Löschen' : 'Verlassen'}</button></div></div>
    {c.kind === 'shared' && <div><div className="flex justify-between text-sm"><span>Gemeinsam: {de(total)} / {de(tgt)} {m.unit}</span><span className={reached ? 'font-medium text-emerald-600' : 'text-zinc-500'}>{reached ? 'Geschafft!' : ph === 'done' ? 'Knapp verpasst' : `${Math.round(total / Math.max(1, tgt) * 100)} %`}</span></div><Bar pct={total / Math.max(1, tgt) * 100} ok={reached} me /></div>}
    <div className="space-y-2">{rows.map((r, i) => <div key={r.user_id} className="text-sm"><div className="flex justify-between gap-2"><span className={r.me ? 'font-semibold' : ''}>{c.kind === 'versus' ? `${i + 1}. ` : ''}{r.me ? 'Du' : r.nickname}{c.kind === 'versus' && ph === 'done' && i === 0 && r.v > 0 && rows[1]?.v !== r.v ? ' 🏆' : ''}</span><span className="tabular-nums text-zinc-500">{de(r.v)} {m.unit}</span></div><Bar pct={r.v / max * 100} me={r.me} /></div>)}</div>
    {invited.length > 0 && <div className="text-xs text-zinc-500">Eingeladen, noch offen: {invited.map(x => x.nickname).join(', ')}</div>}
    <div className="text-[11px] text-zinc-400">Gezählt wird ab dem Startdatum. Fortschritte werden alle paar Minuten abgeglichen, wenn die App geöffnet ist.</div></div>;
}

function ChallengesTab({ fr, books, sessions, uid, act, pre }: { fr: FriendsApi; books: Book[]; sessions: Session[]; uid: string; act: Act; pre: string[] }) {
  const today = dayKey(new Date(), TZ), friends = fr.rels.filter(r => r.state === 'friend');
  const [open, setOpen] = useState(pre.length > 0), [inv, setInv] = useState<string[]>(pre);
  const [f, setF] = useState<{ title: string; kind: 'versus' | 'shared'; metric: Metric; target: number; from: string; to: string }>({ title: '', kind: 'versus', metric: 'pages', target: 0, from: today, to: plusDays(today, 6) });
  const invites = fr.challenges.filter(c => c.my_status === 'invited'), joined = fr.challenges.filter(c => c.my_status === 'joined');
  const live = joined.filter(c => phase(c, today) !== 'done').sort((a, b) => a.end_date.localeCompare(b.end_date)), done = joined.filter(c => phase(c, today) === 'done');
  const who = (c: Challenge) => c.members.find(x => x.user_id === c.creator_id)?.nickname ?? 'Jemand';
  const create = () => act(async () => {
    if (!inv.length) throw new Error('Wähle mindestens eine Person aus, die du einladen möchtest.');
    if (f.to < f.from) throw new Error('Das Enddatum liegt vor dem Startdatum.');
    if (f.kind === 'shared' && !(f.target > 0)) throw new Error('Für ein gemeinsames Ziel brauchst du einen Zielwert.');
    await call('create_challenge', { p_title: f.title.trim() || `${f.kind === 'shared' ? 'Gemeinsam' : 'Duell'}: ${METRIC[f.metric].label}`, p_kind: f.kind, p_metric: f.metric, p_target: f.kind === 'shared' ? f.target : null, p_start: f.from, p_end: f.to, p_invitees: inv });
    setOpen(false); setInv([]); setF({ ...f, title: '', target: 0 });
    return 'Challenge erstellt – die eingeladenen Personen sehen sie jetzt in ihrer App.';
  });
  const list = (a: Challenge[]) => a.map(c => <ChallengeCard key={c.id} c={c} uid={uid} books={books} sessions={sessions} act={act} today={today} />);
  return <div className="space-y-6">
    {invites.length > 0 && <Sec title={`Einladungen (${invites.length})`}>{invites.map(c => <div key={c.id} className={card + ' flex flex-wrap items-center justify-between gap-2'}><div><div className="font-medium">{c.title}</div><div className="text-xs text-zinc-500">{who(c)} lädt dich ein · {c.kind === 'shared' ? `Gemeinsames Ziel: ${de(c.target ?? 0)} ${METRIC[c.metric].unit}` : `Wettbewerb: ${METRIC[c.metric].label}`} · {fd(c.start_date)} – {fd(c.end_date)}</div></div>
      <div className="flex gap-2"><button className={btn} onClick={() => void act(async () => { await call('challenge_respond', { p_id: c.id, p_accept: true }); return 'Du bist dabei!'; })}><Check className="h-4 w-4" />Mitmachen</button><button className={ghost} onClick={() => void act(() => call('challenge_respond', { p_id: c.id, p_accept: false }))}>Ablehnen</button></div></div>)}</Sec>}

    <div className={card + ' space-y-3'}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-medium"><Target className="h-4 w-4 text-indigo-500" />Neue Challenge</h3>{!open && <button className={btn} disabled={friends.length === 0} onClick={() => setOpen(true)}>Challenge erstellen</button>}</div>
      {friends.length === 0 && <p className="text-sm text-zinc-500">Für Challenges brauchst du mindestens eine*n Freund*in. Füge zuerst jemanden im Tab „Freunde“ hinzu.</p>}
      {open && <div className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-xs text-zinc-500 md:col-span-2">Titel (optional)<input className={inp + ' mt-1 w-full'} maxLength={60} placeholder="z. B. Winter-Leseduell" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
          <label className="text-xs text-zinc-500">Art<select className={inp + ' mt-1 w-full'} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as 'versus' | 'shared' })}><option value="versus">Wettbewerb – wer schafft am meisten?</option><option value="shared">Gemeinsames Ziel – zusammen schaffen wir X</option></select></label>
          <label className="text-xs text-zinc-500">Was zählt?<select className={inp + ' mt-1 w-full'} value={f.metric} onChange={e => setF({ ...f, metric: e.target.value as Metric })}>{Object.entries(METRIC).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          {f.kind === 'shared' && <label className="text-xs text-zinc-500">Gemeinsames Ziel ({METRIC[f.metric].unit})<input className={inp + ' mt-1 w-full'} type="number" min={1} value={f.target || ''} onChange={e => setF({ ...f, target: +e.target.value })} /></label>}
          <label className="text-xs text-zinc-500">Start<input className={inp + ' mt-1 w-full'} type="date" min={today} value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></label>
          <label className="text-xs text-zinc-500">Ende<input className={inp + ' mt-1 w-full'} type="date" min={f.from} value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></label></div>
        <div><div className="text-xs text-zinc-500">Wen möchtest du einladen?</div><div className="mt-1 flex flex-wrap gap-2">{friends.map(r => <label key={r.other_id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${inv.includes(r.other_id) ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-zinc-300 dark:border-zinc-700'}`}><input type="checkbox" className="accent-indigo-600" checked={inv.includes(r.other_id)} onChange={e => setInv(x => (e.target.checked ? [...x, r.other_id] : x.filter(i => i !== r.other_id)))} />{r.nickname}</label>)}</div></div>
        <p className="text-xs text-zinc-500">Wer mitmacht, teilt seinen Fortschritt in dieser Challenge mit allen Beteiligten – sonst nichts.</p>
        <div className="flex gap-2"><button className={btn} onClick={() => void create()}>Challenge starten</button><button className={ghost} onClick={() => setOpen(false)}>Abbrechen</button></div></div>}</div>

    {live.length > 0 && <Sec title="Aktuell & demnächst">{list(live)}</Sec>}
    {done.length > 0 && <Sec title="Beendet">{list(done)}</Sec>}
    {joined.length === 0 && invites.length === 0 && <Empty icon={Trophy} title="Noch keine Challenges" text="Starte einen Wettbewerb oder ein gemeinsames Ziel mit deinen Freund*innen." />}</div>;
}

// ---------- Tab 3: Datenschutz ----------
function PrivacyTab({ fr, me, act }: { fr: FriendsApi; me: FStats; act: Act }) {
  const s = fr.settings as FSettings, [nick, setNick] = useState(s.nickname);
  const set = (k: string, v: boolean) => void act(async () => { await saveSettings(s.user_id, { [k]: v }); });
  return <div className="space-y-4">
    <div className={card + ' space-y-2'}><h3 className="font-medium">Dein Name</h3><div className="flex flex-wrap gap-2"><input className={inp} maxLength={30} value={nick} onChange={e => setNick(e.target.value)} />
      <button className={btn} disabled={nick.trim() === s.nickname || nick.trim().length < 2} onClick={() => void act(async () => { await saveSettings(s.user_id, { nickname: nick.trim() }); return 'Name gespeichert.'; })}>Speichern</button></div>
      <p className="text-xs text-zinc-500">So heißt du bei deinen Freund*innen und in Challenges.</p></div>
    <div className={card}><h3 className="font-medium">Kontakt & Einladungen</h3><div className="divide-y divide-zinc-100 dark:divide-zinc-800">
      <Toggle on={s.allow_requests} onChange={v => set('allow_requests', v)} t="Freundes-Anfragen erlauben" d="Wenn aus, funktioniert dein Code nicht: niemand kann dir neue Anfragen schicken. Bestehende Freund*innen bleiben." />
      <Toggle on={s.allow_challenges} onChange={v => set('allow_challenges', v)} t="Challenge-Einladungen erlauben" d="Wenn aus, können Freund*innen dich nicht zu neuen Challenges einladen." /></div></div>
    <div className={card}><h3 className="font-medium">Das sehen deine Freund*innen</h3><ShareToggles v={s as unknown as Record<string, boolean>} set={set} />
      <p className="mt-2 flex items-start gap-2 text-xs text-zinc-500"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />{PRIVATE_NOTE} Änderungen gelten sofort – die Filterung passiert auf dem Server.</p></div>
    <div className={card + ' space-y-2'}><h3 className="font-medium">Vorschau: So sehen dich deine Freund*innen</h3><div className="text-sm font-medium">{s.nickname}</div><Stats s={maskStats(me, s)} /></div>
    <div className={card + ' space-y-2'}><h3 className="font-medium">Freundes-Funktion ausschalten</h3><p className="text-sm text-zinc-600 dark:text-zinc-300">Löscht deinen Code, alle Freundschaften, deine geteilte Zusammenfassung, deine Challenge-Teilnahmen und die Challenges, die du erstellt hast. Deine Bücher, Sessions und Ziele bleiben unberührt.</p>
      <button className="rounded-xl border border-red-600 px-4 py-2 text-sm font-medium text-red-600" onClick={() => void act(async () => { if (!confirm('Freundes-Funktion ausschalten und alle Freundesdaten endgültig löschen?')) return; await call('friend_disable'); return 'Die Freundes-Funktion ist ausgeschaltet.'; })}>Ausschalten und Daten löschen</button></div></div>;
}

// ---------- Seite ----------
export function Friends({ fr, books, sessions, uid }: { fr: FriendsApi; books: Book[]; sessions: Session[]; uid: string }) {
  const g = useG(), [tab, setTab] = useState(0), [pre, setPre] = useState<string[]>([]), [msg, setMsg] = useState('');
  const me = useMemo(() => mySnapshot(books, sessions, g?.xp ?? 0, g?.lvl.level ?? 1, g?.lvl.title ?? '', TZ), [books, sessions, g?.xp, g?.lvl.level, g?.lvl.title]);
  if (fr.state === 'loading') return <Skeleton />;
  if (fr.state === 'missing') return <div className={NOTICE}>Für die Freundes-Funktion fehlen noch neue Datenbank-Tabellen. Führe die Datei <b>005_friends.sql</b> im Supabase-SQL-Editor aus (siehe README, Abschnitt „Freunde“) und lade die Seite danach neu.</div>;
  if (fr.state === 'error') return <div className={card + ' space-y-2'}><p className="text-sm text-red-600">Die Freundes-Daten konnten nicht geladen werden: {fr.err}</p><button className={btn} onClick={() => void fr.reload()}>Erneut versuchen</button></div>;
  if (fr.state === 'off' || !fr.settings) return <Activate uid={uid} onDone={fr.reload} />;
  const act: Act = async fn => { setMsg(''); try { const m = await fn(); if (m) setMsg(m); } catch (e) { setMsg((e as Error).message); } await fr.reload(); };
  const inc = fr.rels.filter(r => r.state === 'incoming').length, inv = fr.challenges.filter(c => c.my_status === 'invited').length;
  const tabs: [string, number][] = [['Freunde', inc], ['Challenges', inv], ['Datenschutz', 0]];
  return <div className="space-y-4">
    <SubTabs tabs={tabs.map(([t, n]) => ({ t, n }))} value={tab} onChange={i => { setTab(i); setPre([]); setMsg(''); }} />
    {msg && <p className="text-sm text-indigo-700 dark:text-indigo-300">{msg}</p>}
    {tab === 0 && <FriendsTab fr={fr} me={me} act={act} challenge={id => { setPre([id]); setTab(1); setMsg(''); }} />}
    {tab === 1 && <ChallengesTab fr={fr} books={books} sessions={sessions} uid={uid} act={act} pre={pre} />}
    {tab === 2 && <PrivacyTab fr={fr} me={me} act={act} />}</div>;
}
