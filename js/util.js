// 日付・数値・文字列の共通ヘルパー

export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function pad(n) { return String(n).padStart(2, '0'); }

/** ローカル日付を YYYY-MM-DD で返す */
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today() { return ymd(new Date()); }

/** YYYY-MM-DD → Date（ローカル0時） */
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function diffDays(a, b) {
  return Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
}

/** 週の始まり（月曜）を返す */
export function weekStart(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7; // 月=0
  d.setDate(d.getDate() - dow);
  return ymd(d);
}

export function monthKey(s) { return s.slice(0, 7); }

const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtDate(s, opts = {}) {
  const d = parseYmd(s);
  const base = `${d.getMonth() + 1}/${d.getDate()}`;
  return opts.weekday === false ? base : `${base}（${WD[d.getDay()]}）`;
}

export function fmtDateLong(s) {
  const d = parseYmd(s);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
}

export function relDay(s) {
  const n = diffDays(today(), s);
  if (n === 0) return '今日';
  if (n === 1) return '昨日';
  if (n === 2) return 'おととい';
  if (n > 0 && n < 7) return `${n}日前`;
  return fmtDate(s);
}

export function round1(n) { return Math.round(n * 10) / 10; }

export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function sum(arr, fn = (x) => x) {
  let t = 0;
  for (const x of arr) t += fn(x) || 0;
  return t;
}

export function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function byDateDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'おつかれさまです';
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'こんばんは';
}
