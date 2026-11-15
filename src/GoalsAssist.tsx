import { useMemo, useState } from 'react';
import { Lightbulb, TrendingDown, TrendingUp } from 'lucide-react';
import { save } from './lib/data';
import { GINFO, GT, LEVELS, baseline, fmtN, plan, recommend, snap, type GoalRow, type Sugg } from './lib/goals';
import { dayKey, type Book, type Session } from './lib/stats';
import { TZ } from './lib/tz';
import { btn, card, inp } from './ui';

// Hinweis unter einem Ziel: Vorschlag, das Ziel zu erhöhen oder zu senken (ein Klick übernimmt ihn).
export function GoalHint({ s, unit, onApply }: { s: Sugg; unit: string; onApply: () => void }) {
  const up = s.dir === 'up', I = up ? TrendingUp : TrendingDown;
  return <div className={`mt-3 flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm ${up ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200'}`}>
    <I className="h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><div className="font-medium">{up ? 'Vorschlag: Ziel erhöhen' : 'Vorschlag: Ziel senken'} auf {fmtN(s.target)} {unit}</div><div className="text-xs opacity-80">{s.why}</div></div>
    <button className={btn} onClick={onApply}>Übernehmen</button></div>;
}

export function GoalAssistant({ goals, books, sessions, uid }: { goals: GoalRow[]; books: Book[]; sessions: Session[]; uid: string }) {
  const today = dayKey(new Date(), TZ), [lv, setLv] = useState('balanced'), [wish, setWish] = useState<number>(() => goals.find(g => g.goal_type === 'books_year')?.target_value ?? 12), [msg, setMsg] = useState('');
  const bases = useMemo(() => Object.keys(GINFO).map(t => [t, baseline(t, today, sessions, books, TZ)] as const), [today, sessions, books]);
  const level = LEVELS.find(l => l.id === lv) ?? LEVELS[1];
  const recs = bases.map(([t, b]) => ({ t, ...recommend(t, level.f, b), cur: goals.find(g => g.goal_type === t)?.target_value }));
  const n = Math.min(365, Math.max(1, Math.round(wish) || 1)), pl = useMemo(() => plan(n, today, books, sessions, TZ), [n, today, books, sessions]);
  const put = async (type: string, v: number) => { const ex = goals.find(g => g.goal_type === type); await save('reading_goals', ex ? { ...ex, target_value: v } : { id: crypto.randomUUID(), user_id: uid, goal_type: type, target_value: v }); };
  const one = async (t: string, v: number) => { await put(t, v); setMsg(`${GT[t]}: ${fmtN(v)} ${GINFO[t].unit} gespeichert.`); };
  const all = async () => { for (const r of recs) await put(r.t, r.v); setMsg('Alle empfohlenen Ziele wurden gespeichert.'); };
  const makePlan = async () => { await put('books_year', n); await put('pages_year', snap('pages_year', pl.pagesYear)); if (pl.open > 0) await put('minutes_day', snap('minutes_day', pl.minPerDay)); setMsg('Die Ziele zu deinem Wunsch wurden gespeichert.'); };
  return <details className={card + ' space-y-4'} open={goals.length === 0 ? true : undefined}>
    <summary className="flex cursor-pointer items-center gap-2 font-medium"><Lightbulb className="h-4 w-4 text-indigo-500" />Zielsetzungs-Assistent</summary>
    <div className="mt-3 space-y-3"><p className="text-sm text-zinc-600 dark:text-zinc-300">Der Assistent schlägt Ziele vor, die zu deinem bisherigen Lesen passen. Wähle, wie ehrgeizig sie sein sollen.</p>
      <div className="flex flex-wrap gap-2">{LEVELS.map(l => <button key={l.id} onClick={() => setLv(l.id)} className={`rounded-xl px-4 py-2 text-sm font-medium ${lv === l.id ? 'bg-indigo-600 text-white' : 'border border-zinc-300 dark:border-zinc-700'}`}>{l.t}</button>)}</div>
      <p className="text-xs text-zinc-500">{level.d}</p>
      <div className="space-y-2">{recs.map(r => <div key={r.t} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-800/60">
        <div className="min-w-0"><div className="font-medium">{GT[r.t]}: {fmtN(r.v)} {GINFO[r.t].unit}</div><div className="text-xs text-zinc-500">{r.src}{r.cur !== undefined ? ` · aktuelles Ziel: ${fmtN(r.cur)}` : ''}</div></div>
        <button className="rounded-xl border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700" disabled={r.cur === r.v} onClick={() => void one(r.t, r.v)}>{r.cur === undefined ? 'Anlegen' : r.cur === r.v ? 'Aktuell' : 'Ersetzen'}</button></div>)}</div>
      <button className={btn} onClick={() => void all()}>Alle empfohlenen Ziele übernehmen</button></div>
    <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"><h3 className="font-medium">Wunschziel: Wie viele Bücher in diesem Jahr?</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm"><input className={inp + ' w-28'} type="number" min={1} max={365} value={wish || ''} onChange={e => setWish(+e.target.value)} aria-label="Anzahl Bücher" /><span>Bücher bis 31.12.</span></div>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{pl.open === 0 ? `Dieses Ziel hast du schon erreicht (${pl.done} ${pl.done === 1 ? 'Buch' : 'Bücher'} in diesem Jahr).`
        : `Noch ${pl.open} ${pl.open === 1 ? 'Buch' : 'Bücher'} in ${pl.left} Tagen: etwa ${fmtN(pl.perDay)} Seiten pro Tag, bei ${Math.round(pl.pph)} Seiten pro Stunde${pl.ownPace ? ' (dein Tempo)' : ' (Annahme, bis genug Lesezeit erfasst ist)'} ca. ${Math.ceil(pl.minPerDay)} Minuten täglich.`}</p>
      <p className="text-xs text-zinc-500">Rechnung mit {pl.avg} Seiten pro Buch{pl.ownAvg ? ' (Durchschnitt deiner abgeschlossenen Bücher)' : ' (Annahme, bis du Bücher mit Seitenzahl abgeschlossen hast)'}.</p>
      <button className={btn} onClick={() => void makePlan()}>Passende Ziele anlegen</button></div>
    {msg && <p className="text-sm text-indigo-700 dark:text-indigo-300">{msg}</p>}</details>;
}
