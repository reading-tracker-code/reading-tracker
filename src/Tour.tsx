import { useEffect, useRef, useState } from 'react';
import { BookOpen, Flame, Sparkles, Timer, Trophy, Users, X, type LucideIcon } from 'lucide-react';
import { btn } from './ui';

// Kurze Einstiegstour für neue Nutzer*innen. Wird automatisch nur einmal gezeigt (solange noch keine Bücher/Sessions existieren)
// und lässt sich jederzeit unter Einstellungen → Anzeige erneut starten.
type Step = { I: LucideIcon; bg: string; title: string; text: string; where?: string };
const STEPS: Step[] = [
  { I: Sparkles, bg: 'from-indigo-600 via-violet-600 to-fuchsia-600', title: 'Willkommen beim Reading Tracker', text: 'In sechs kurzen Schritten zeigen wir dir, wie du loslegst. Das dauert etwa eine Minute.' },
  { I: BookOpen, bg: 'from-sky-600 to-indigo-700', title: 'Lege dein erstes Buch an', text: 'Tippe bei „Bücher“ auf das Plus. Du kannst online nach Titel oder ISBN suchen oder ein Buch selbst eintragen.', where: 'Menü: Bücher' },
  { I: Timer, bg: 'from-emerald-600 to-teal-700', title: 'Erfasse deine Lesesessions', text: 'Starte den Timer, wenn du losliest, oder trage Seiten und Minuten danach ein. Dein Fortschritt im Buch wird automatisch aktualisiert.', where: 'Menü: Sessions' },
  { I: Flame, bg: 'from-rose-600 to-orange-500', title: 'Halte deinen Streak', text: 'Auf dem Start-Bildschirm siehst du Streak, Tagesring und deine Statistiken. Lies jeden Tag ein wenig, damit die Flamme weiterbrennt.', where: 'Menü: Start' },
  { I: Trophy, bg: 'from-amber-500 to-orange-600', title: 'Sammle XP und Abzeichen', text: 'Fürs Lesen gibt es XP, Level, Abzeichen und Wochen-Challenges. Schutzschilde retten deinen Streak, wenn du mal einen Tag verpasst.', where: 'Menü: Mehr → Motivation' },
  { I: Users, bg: 'from-cyan-600 to-blue-700', title: 'Lies mit Freund*innen', text: 'Optional: Verbinde dich per Freundes-Code, vergleicht euch und startet Challenges. Solange du nichts einschaltest, ist nichts sichtbar.', where: 'Menü: Mehr → Freunde' },
  { I: Sparkles, bg: 'from-indigo-700 via-fuchsia-600 to-orange-500', title: 'Los geht’s!', text: 'Diese Tour findest du jederzeit unter Einstellungen → Anzeige. Zum Ausprobieren kannst du unter Einstellungen → Konto Beispieldaten erzeugen und später wieder löschen.' },
];
const ghost = 'inline-flex items-center justify-center rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800';

export function Tour({ onClose }: { onClose: (goTo?: number) => void }) {
  const [i, setI] = useState(0), main = useRef<HTMLButtonElement>(null), last = i === STEPS.length - 1, s = STEPS[i];
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') setI(x => Math.min(STEPS.length - 1, x + 1)); else if (e.key === 'ArrowLeft') setI(x => Math.max(0, x - 1)); };
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, []);
  useEffect(() => { main.current?.focus(); }, [i]);
  return <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Einführungstour">
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => onClose()} />
    <div className="rt-pop relative flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-zinc-900 sm:rounded-3xl" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className={`relative bg-gradient-to-br ${s.bg} px-6 pb-6 pt-5 text-white`}>
        <button className="absolute right-3 top-3 rounded-full bg-white/15 p-2" aria-label="Tour beenden" onClick={() => onClose()}><X className="h-4 w-4" /></button>
        <div className="text-sm font-medium opacity-80">Schritt {i + 1} von {STEPS.length}</div>
        <div key={i} className="rt-pop mt-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20"><s.I className="h-8 w-8" /></div></div>
      <div key={i} className="rt-rise space-y-2 overflow-y-auto px-6 py-5"><h2 className="text-xl font-semibold tracking-tight">{s.title}</h2><p className="text-zinc-600 dark:text-zinc-300">{s.text}</p>
        {s.where && <p className="pt-1 text-sm text-zinc-500">Zu finden unter: <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{s.where.replace('Menü: ', '')}</span></p>}</div>
      <div className="flex items-center justify-between gap-3 px-6 pb-5">
        <div className="flex gap-1.5" aria-hidden="true">{STEPS.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-indigo-600' : 'w-1.5 bg-zinc-300 dark:bg-zinc-700'}`} />)}</div>
        <div className="flex gap-2">{i > 0 && <button className={ghost} onClick={() => setI(i - 1)}>Zurück</button>}
          {last ? <><button className={ghost} onClick={() => onClose()}>Schließen</button><button ref={main} className={btn} onClick={() => onClose(1)}>Buch anlegen</button></> : <button ref={main} className={btn} onClick={() => setI(i + 1)}>{i === 0 ? 'Los geht’s' : 'Weiter'}</button>}</div></div></div></div>;
}
