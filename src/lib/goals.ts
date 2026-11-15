// Leseziele: Verlauf abgeschlossener Zeiträume, Anpassungsvorschläge und Empfehlungen für den Zielsetzungs-Assistenten.
// Reine Funktionen, nur aus Sessions/Büchern berechnet (Kalenderwochen Mo–So, Kalendermonate, Kalenderjahre).
import { computeStats, type Book, type Session } from './stats';

export type GoalRow = { id: string; user_id: string; goal_type: string; target_value: number };
export type Per = { from: string; to: string; value: number; frac: number };
export type Hist = { cur: Per | null; past: Per[] };
export type Sugg = { dir: 'up' | 'down'; target: number; why: string };
type Info = { step: number; min: number; max?: number; unit: string; per: 'year' | 'month' | 'week' | 'day'; plural: string; def: number };

export const GT: Record<string, string> = { books_year: 'Bücher pro Jahr', pages_year: 'Seiten pro Jahr', pages_month: 'Seiten pro Monat', minutes_week: 'Lesezeit pro Woche (Min.)', minutes_day: 'Lesezeit pro Tag (Min.)', days_month: 'Lesetage pro Monat' };
export const GINFO: Record<string, Info> = {
  books_year: { step: 1, min: 1, unit: 'Bücher', per: 'year', plural: 'Jahre', def: 12 },
  pages_year: { step: 100, min: 100, unit: 'Seiten', per: 'year', plural: 'Jahre', def: 4000 },
  pages_month: { step: 50, min: 50, unit: 'Seiten', per: 'month', plural: 'Monate', def: 300 },
  minutes_week: { step: 15, min: 15, unit: 'Min.', per: 'week', plural: 'Wochen', def: 120 },
  minutes_day: { step: 5, min: 5, max: 600, unit: 'Min.', per: 'day', plural: 'Lesetage', def: 20 },
  days_month: { step: 1, min: 1, max: 31, unit: 'Tage', per: 'month', plural: 'Monate', def: 15 },
};
export const LEVELS = [
  { id: 'relaxed', t: 'Entspannt', f: 0.9, d: 'Etwas unter deinem bisherigen Lesen – sicher zu schaffen.' },
  { id: 'balanced', t: 'Ausgewogen', f: 1.1, d: 'Leicht über deinem bisherigen Lesen – fordert dich ein wenig.' },
  { id: 'ambitious', t: 'Ambitioniert', f: 1.3, d: 'Deutlich mehr als bisher – für alle, die richtig Gas geben wollen.' },
];

const dn = (k: string) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)) / 864e5;
const iso = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const fmtN = (x: number) => (Math.round(x * 10) / 10).toLocaleString('de-DE');
export const snap = (type: string, x: number) => { const i = GINFO[type]; let v = Math.max(i.min, Math.round(x / i.step) * i.step); if (i.max) v = Math.min(i.max, v); return v; };
const COUNT: Record<string, number> = { year: 3, month: 4, week: 4, day: 14 };

// k = 0: laufender Zeitraum, k >= 1: k-ter abgeschlossener Zeitraum davor
function bounds(per: string, today: string, k: number): { from: string; to: string } {
  const t = dn(today), y = +today.slice(0, 4), m = +today.slice(5, 7);
  if (per === 'year') return { from: `${y - k}-01-01`, to: `${y - k}-12-31` };
  if (per === 'month') return { from: iso(Date.UTC(y, m - 1 - k, 1) / 864e5), to: iso(Date.UTC(y, m - k, 0) / 864e5) };
  if (per === 'week') { const mon = t - ((new Date(t * 864e5).getUTCDay() + 6) % 7); return { from: iso(mon - 7 * k), to: iso(mon - 7 * k + 6) }; }
  return { from: iso(t - k), to: iso(t - k) };
}
function valueOf(type: string, from: string, to: string, sessions: Session[], books: Book[], tz: string) {
  const s = computeStats(sessions, books, { from, to }, tz);
  return type.startsWith('books') ? s.finishedBooks : type.startsWith('pages') ? s.pages : type.startsWith('minutes') ? Math.round(s.minutes) : s.activeDays;
}

export function history(type: string, today: string, sessions: Session[], books: Book[], tz: string): Hist {
  const i = GINFO[type], first = sessions.reduce((m, s) => (m === '' || s.session_date < m ? s.session_date : m), '');
  if (!i || !first) return { cur: null, past: [] };
  const past: Per[] = [];
  for (let k = 1; past.length < COUNT[i.per] && k <= 60; k++) {
    const b = bounds(i.per, today, k); if (b.to < first) break;
    const len = dn(b.to) - dn(b.from) + 1;
    if (b.from < first && (dn(b.to) - dn(first) + 1) / len < 0.75) break; // Zeitraum, in dem du gerade erst angefangen hast: zählt nicht
    past.push({ ...b, value: valueOf(type, b.from, b.to, sessions, books, tz), frac: 1 });
  }
  let cur: Per | null = null;
  if (i.per !== 'day') {
    const b = bounds(i.per, today, 0), len = dn(b.to) - dn(b.from) + 1;
    cur = { ...b, value: valueOf(type, b.from, today, sessions, books, tz), frac: Math.min(1, (dn(today) - dn(b.from) + 1) / len) };
  }
  return { cur, past };
}

// Vorschlag, wenn ein Ziel dauerhaft über- oder untererfüllt wird (oder im laufenden Zeitraum klar darüber/darunter liegt).
export function suggestion(type: string, target: number, h: Hist): Sugg | null {
  const i = GINFO[type]; if (!i || !(target > 0)) return null;
  const past = i.per === 'day' ? h.past.filter(p => p.value > 0) : h.past, n = past.length, minN = i.per === 'year' ? 1 : i.per === 'day' ? 7 : 3;
  if (n >= minN) {
    const vals = past.map(p => p.value), hits = vals.filter(v => v >= target).length, med = median(vals);
    const base = `Abgeschlossene ${i.plural}: ${n}, Ziel erreicht in ${hits}. Typischer Wert: ${fmtN(med)} ${i.unit}.`;
    if (hits / n >= 0.8 && med >= target * 1.15) { const t = snap(type, med * 1.1); if (t > target) return { dir: 'up', target: t, why: `${base} Das Ziel scheint zu niedrig.` }; }
    if (hits / n <= 1 / 3) { const t = snap(type, Math.max(med * 1.1, target * 0.5)); if (t < target) return { dir: 'down', target: t, why: `${base} Das Ziel scheint zu hoch.` }; }
  }
  const c = h.cur;
  if (c) {
    if (c.value >= target) { const t = Math.max(snap(type, Math.max(target * 1.25, c.value * 1.1)), snap(type, target + i.step)); if (t > target) return { dir: 'up', target: t, why: 'Du hast das Ziel im laufenden Zeitraum bereits erreicht.' }; }
    else if (c.frac >= 0.4) {
      const proj = c.value / c.frac;
      if (proj >= target * 1.3) { const t = snap(type, proj); if (t > target) return { dir: 'up', target: t, why: `Hochrechnung für den laufenden Zeitraum: ca. ${fmtN(proj)} ${i.unit} – deutlich über dem Ziel.` }; }
      else if (c.frac >= 0.5 && proj <= target * 0.6) { const t = snap(type, Math.max(proj * 1.1, target * 0.5)); if (t < target) return { dir: 'down', target: t, why: `Hochrechnung für den laufenden Zeitraum: ca. ${fmtN(proj)} ${i.unit} – deutlich unter dem Ziel.` }; }
    }
  }
  return null;
}

const avgPages = (books: Book[]) => { const w = books.filter(b => b.status === 'finished' && b.total_pages > 0); return w.length ? w.reduce((a, b) => a + b.total_pages, 0) / w.length : 0; };

// Ausgangswert für Empfehlungen: dein bisheriges Lesen (abgeschlossene Zeiträume, sonst Hochrechnung der letzten bis zu 90 Tage).
export function baseline(type: string, today: string, sessions: Session[], books: Book[], tz: string): { v: number; src: string } | null {
  const i = GINFO[type], t = dn(today); if (!i || !sessions.length) return null;
  if (i.per === 'day') {
    const s = computeStats(sessions, books, { from: iso(t - 30), to: today }, tz);
    if (s.daily.length >= 5) return { v: median(s.daily.map(d => d.minutes)), src: 'Median deiner Lesetage der letzten 30 Tage' };
  } else {
    const h = history(type, today, sessions, books, tz);
    if (h.past.length) return { v: h.past.reduce((a, p) => a + p.value, 0) / h.past.length, src: `Durchschnitt der letzten ${h.past.length} abgeschlossenen ${i.plural}` };
  }
  const first = sessions.reduce((m, s) => (m === '' || s.session_date < m ? s.session_date : m), ''), span = Math.min(90, t - dn(first) + 1);
  if (span < 14) return null;
  const s = computeStats(sessions, books, { from: iso(t - span + 1), to: today }, tz); if (s.activeDays < 5) return null;
  const d = (x: number) => x / span;
  const v = type === 'pages_month' ? d(s.pages) * 30.4 : type === 'pages_year' ? d(s.pages) * 365 : type === 'minutes_week' ? d(s.minutes) * 7 : type === 'days_month' ? d(s.activeDays) * 30.4
    : type === 'minutes_day' ? s.minutes / s.activeDays : (d(s.pages) * 365) / (avgPages(books) || 300);
  return { v, src: `Hochrechnung aus deinen letzten ${span} Tagen` };
}
export function recommend(type: string, factor: number, base: { v: number; src: string } | null) {
  const ok = !!base && base.v > 0;
  return { v: snap(type, (ok ? base!.v : GINFO[type].def) * factor), src: ok ? base!.src : 'Startwert (noch zu wenig Daten)' };
}

// Wunschziel "X Bücher in diesem Jahr": Wie viele Seiten und Minuten pro Tag sind dafür nötig?
export function plan(n: number, today: string, books: Book[], sessions: Session[], tz: string) {
  const y = today.slice(0, 4), own = avgPages(books), avg = Math.round(own || 300);
  const done = books.filter(b => b.status === 'finished' && b.finish_date?.startsWith(y)).length;
  const all = computeStats(sessions, books, null, tz), ownPace = !!all.pagesPerHour && all.minutes >= 120, pph = ownPace ? all.pagesPerHour! : 40;
  const left = dn(`${y}-12-31`) - dn(today) + 1, open = Math.max(0, n - done), pages = open * avg, perDay = pages / left;
  return { avg, ownAvg: own > 0, pph, ownPace, done, open, left, pages, perDay, minPerDay: (perDay / pph) * 60, pagesYear: n * avg };
}
