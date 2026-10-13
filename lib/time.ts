// Lagos time helpers. Africa/Lagos is UTC+1 all year with no daylight saving,
// so a fixed offset is exact and keeps every date calculation deterministic.
const LAGOS_MS = 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');

export type Calendar = { working_days: number[]; holidays: string[] };

export const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function lagosParts(date: Date) {
  const l = new Date(date.getTime() + LAGOS_MS);
  const y = l.getUTCFullYear();
  const m = l.getUTCMonth() + 1;
  const d = l.getUTCDate();
  return { y, m, d, hh: l.getUTCHours(), mm: l.getUTCMinutes(), dow: l.getUTCDay(), ymd: ymdOf(y, m, d) };
}

export function parseYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

/** The instant (UTC) at which a Lagos wall-clock date and time occurs. */
export function lagosDate(ymd: string, hhmm: string): Date {
  const { y, m, d } = parseYmd(ymd);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi) - LAGOS_MS);
}

export function addDays(ymd: string, n: number): string {
  const { y, m, d } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymdOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function dowOf(ymd: string): number {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const isWorkingDay = (ymd: string, cal: Calendar) =>
  cal.working_days.includes(dowOf(ymd)) && !cal.holidays.includes(ymd);

export function nextWorkingDay(ymd: string, cal: Calendar): string {
  let x = addDays(ymd, 1);
  for (let i = 0; i < 60; i++) {
    if (isWorkingDay(x, cal)) return x;
    x = addDays(x, 1);
  }
  return x;
}

export function addWorkingDays(ymd: string, n: number, cal: Calendar): string {
  let x = ymd;
  for (let i = 0; i < n; i++) x = nextWorkingDay(x, cal);
  return x;
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** The day work on a new order begins: today if it is a working day before cut-off, else the next working day. */
export function productionDay(now: Date, s: Calendar & { cutoff_time: string }): string {
  const p = lagosParts(now);
  if (isWorkingDay(p.ymd, s) && p.hh * 60 + p.mm < toMinutes(s.cutoff_time)) return p.ymd;
  return nextWorkingDay(p.ymd, s);
}

// ---------- Plain-language display ----------
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function clock12(hh: number, mm: number): string {
  if (hh === 12 && mm === 0) return '12 noon';
  const h = hh % 12 === 0 ? 12 : hh % 12;
  const suffix = hh < 12 ? 'am' : 'pm';
  return mm === 0 ? `${h}${suffix}` : `${h}:${pad(mm)}${suffix}`;
}

/** "today by 5pm", "tomorrow by 5pm", "Tuesday 13 Oct by 5pm" */
export function describeArrival(arriveBy: Date, now: Date = new Date()): string {
  const a = lagosParts(arriveBy);
  const n = lagosParts(now);
  const t = clock12(a.hh, a.mm);
  if (a.ymd === n.ymd) return `today by ${t}`;
  if (a.ymd === addDays(n.ymd, 1)) return `tomorrow by ${t}`;
  return `${DAYS[a.dow]} ${a.d} ${MONTHS[a.m - 1]} by ${t}`;
}

export function describeDay(ymd: string, now: Date = new Date()): string {
  const n = lagosParts(now);
  if (ymd === n.ymd) return 'today';
  if (ymd === addDays(n.ymd, 1)) return 'tomorrow';
  const { d, m } = parseYmd(ymd);
  return `${DAYS[dowOf(ymd)]} ${d} ${MONTHS[m - 1]}`;
}

export function describeWhen(date: Date): string {
  const p = lagosParts(date);
  return `${DAYS[p.dow].slice(0, 3)} ${p.d} ${MONTHS[p.m - 1]}, ${clock12(p.hh, p.mm)}`;
}

/** "2h 14m", "35m", "1d 3h" */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
