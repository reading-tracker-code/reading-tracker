// Freunde: Typen, Zugriff auf die Supabase-Funktionen und Berechnungen (reine Online-Funktion, nichts davon liegt in IndexedDB).
// Datenschutz: Freunde sehen nur die Zusammenfassung "friend_stats", die der Server nach deinen Einstellungen filtert.
import { supabase } from './supabase';
import { computeStats, dayKey, rangeFor, type Book, type Session } from './stats';

export type ShareKey = 'share_level' | 'share_streak' | 'share_week' | 'share_year_books' | 'share_totals' | 'share_current_book';
export type FSettings = { user_id: string; nickname: string; friend_code: string; allow_requests: boolean; allow_challenges: boolean } & Record<ShareKey, boolean>;
export type FStats = { updated_at?: string; level?: number; title?: string; xp?: number; streak?: number; week_pages?: number; week_minutes?: number; week_days?: number; year_books?: number; total_pages?: number; current_book?: string };
export type FRel = { friendship_id: string; other_id: string; nickname: string; state: 'friend' | 'incoming' | 'outgoing'; since: string; stats: FStats | null };
export type Metric = 'pages' | 'minutes' | 'days' | 'books';
export type Member = { user_id: string; nickname: string; status: 'invited' | 'joined'; progress: number | null; progress_at: string | null };
export type Challenge = { id: string; title: string; kind: 'versus' | 'shared'; metric: Metric; target: number | null; start_date: string; end_date: string; creator_id: string; my_status: 'invited' | 'joined'; members: Member[] };

export const SHARE: { k: ShareKey; t: string; d: string }[] = [
  { k: 'share_level', t: 'Level & XP', d: 'Dein Level, dein Titel und deine XP-Gesamtzahl.' },
  { k: 'share_streak', t: 'Lese-Streak', d: 'Wie viele Tage in Folge du liest.' },
  { k: 'share_week', t: 'Wochenwerte', d: 'Seiten, Lesezeit und Lesetage der laufenden Woche (für die Wochen-Rangliste).' },
  { k: 'share_year_books', t: 'Bücher dieses Jahr', d: 'Wie viele Bücher du in diesem Jahr abgeschlossen hast.' },
  { k: 'share_totals', t: 'Seiten gesamt', d: 'Wie viele Seiten du insgesamt gelesen hast.' },
  { k: 'share_current_book', t: 'Aktuelles Buch', d: 'Der Titel des Buchs, das du gerade liest.' },
];
export const DEFAULT_SHARE: Record<ShareKey, boolean> = { share_level: true, share_streak: true, share_week: true, share_year_books: true, share_totals: false, share_current_book: false };

export const METRIC: Record<Metric, { label: string; unit: string }> = { pages: { label: 'Seiten', unit: 'Seiten' }, minutes: { label: 'Lesezeit', unit: 'Min.' }, days: { label: 'Lesetage', unit: 'Tage' }, books: { label: 'Bücher abschließen', unit: 'Bücher' } };

// ---------- Zugriff ----------
export const isMissing = (e: { code?: string } | null | undefined) => !!e && ['PGRST202', 'PGRST205', '42P01', '42883'].includes(e.code ?? '');
export async function call<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function saveSettings(uid: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('friend_settings').update(patch).eq('user_id', uid);
  if (error) throw new Error(error.message);
}
export async function enableFriends(uid: string, nickname: string, share: Record<ShareKey, boolean>) {
  await call('friend_enable', { p_nickname: nickname });
  await saveSettings(uid, share);
}

// ---------- Berechnungen ----------
const dn = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 864e5;
const iso = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
export const plusDays = (k: string, n: number) => iso(dn(k) + n);
export const fd = (k: string) => `${k.slice(8)}.${k.slice(5, 7)}.${k.slice(0, 4)}`;

// Deine Zusammenfassung (alles, was überhaupt geteilt werden KÖNNTE). Gefiltert wird auf dem Server nach deinen Einstellungen.
export function mySnapshot(books: Book[], sessions: Session[], xp: number, level: number, title: string, tz: string): FStats {
  const today = dayKey(new Date(), tz), t = dn(today), mon = iso(t - ((new Date(t * 864e5).getUTCDay() + 6) % 7));
  const all = computeStats(sessions, books, null, tz), wk = computeStats(sessions, books, { from: mon, to: today }, tz), yr = computeStats(sessions, books, rangeFor('year', tz), tz);
  const cur = books.find(b => b.status === 'reading');
  return { level, title, xp, streak: all.currentStreak, week_pages: wk.pages, week_minutes: Math.round(wk.minutes), week_days: wk.activeDays, year_books: yr.finishedBooks, total_pages: all.pages, current_book: cur ? cur.title.slice(0, 80) : undefined };
}
// Dieselbe Filterung wie auf dem Server – nur für die Vorschau "So sehen dich deine Freund*innen".
export const maskStats = (d: FStats, s: FSettings): FStats => ({
  ...(s.share_level ? { level: d.level, title: d.title, xp: d.xp } : {}), ...(s.share_streak ? { streak: d.streak } : {}),
  ...(s.share_week ? { week_pages: d.week_pages, week_minutes: d.week_minutes, week_days: d.week_days } : {}),
  ...(s.share_year_books ? { year_books: d.year_books } : {}), ...(s.share_totals ? { total_pages: d.total_pages } : {}), ...(s.share_current_book && d.current_book ? { current_book: d.current_book } : {}),
});

// Mein Fortschritt in einer Challenge: zählt ab dem Startdatum der Challenge bis zu ihrem Ende.
export function myProgress(c: { metric: Metric; start_date: string; end_date: string }, sessions: Session[], books: Book[], tz: string) {
  const s = computeStats(sessions, books, { from: c.start_date, to: c.end_date }, tz);
  return c.metric === 'pages' ? s.pages : c.metric === 'minutes' ? Math.round(s.minutes) : c.metric === 'days' ? s.activeDays : s.finishedBooks;
}
export const phase = (c: { start_date: string; end_date: string }, today: string): 'soon' | 'live' | 'done' => (today < c.start_date ? 'soon' : today > c.end_date ? 'done' : 'live');
export const daysLeft = (c: { end_date: string }, today: string) => Math.max(0, dn(c.end_date) - dn(today) + 1);
export const isFrozen = (c: { end_date: string }, today: string) => dn(today) > dn(c.end_date) + 1; // Server nimmt bis 2 Tage nach Ende noch Werte an
