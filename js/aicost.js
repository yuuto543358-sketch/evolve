// AIの利用料金：トークン数を記録して、料金（目安）に計算する
//
// ・AIを呼ぶたびに、使ったトークン数（文字数のようなもの）を「日・月・機能・モデル」ごとに足していきます
// ・料金は「トークン数 × 単価」で、表示するときに計算します（単価を直せば、過去の分もまとめて計算し直されます）
// ・記録は meta の中に入れるので、バックアップにも入ります（APIキーは入りません）
import * as store from './store.js';
import { S } from './store.js';
import { today, addDays, fmtNum } from './util.js';

/** ドル / 100万トークン。cached は「キャッシュされた入力」の単価（なければ入力と同じ） */
export const DEFAULT_PRICES = {
  'gpt-6-astra': { in: 10, cached: 1, out: 50 },
  'gpt-6.1-sol': { in: 2, cached: 0.1, out: 10 },
  'gpt-6.1-terra': { in: 1, cached: 0.05, out: 5 },
  'gpt-6-luna': { in: 0.1, cached: 0.01, out: 0.5 },
  'gpt-5.6-sol': { in: 4, cached: null, out: 20 },
  'gpt-5.6-terra': { in: 2, cached: null, out: 12 },
  'gpt-5.6-luna': { in: 0.2, cached: null, out: 1.2 },
  'gpt-5.5': { in: 5, cached: null, out: 30 },
};

export const DEFAULT_YEN_RATE = 150;

export const TAG_LABEL = {
  coach: 'コーチに相談',
  meal: '食事の見積もり',
  review: 'ふりかえり',
  menu: 'メニュー作り',
  other: 'そのほか',
};

export function yenRate() {
  const r = Number(S.settings.yenRate);
  return Number.isFinite(r) && r > 0 ? r : DEFAULT_YEN_RATE;
}

/** そのモデルの単価。自分で直した値を優先し、なければ料金表、それもなければ null（料金不明） */
export function priceFor(model) {
  const ov = (S.settings.aiPrices || {})[model];
  if (ov && Number.isFinite(Number(ov.in)) && Number.isFinite(Number(ov.out))) {
    return { in: Number(ov.in), out: Number(ov.out), cached: ov.cached === null || ov.cached === undefined || ov.cached === '' ? null : Number(ov.cached), custom: true };
  }
  if (DEFAULT_PRICES[model]) return { ...DEFAULT_PRICES[model], custom: false };
  // 日付つきの名前（例：gpt-6.1-sol-2026-10-01）は、いちばん長く一致する名前の料金を使う
  const key = Object.keys(DEFAULT_PRICES).filter((k) => model.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0];
  return key ? { ...DEFAULT_PRICES[key], custom: false } : null;
}

const blank = () => ({ n: 0, i: 0, c: 0, o: 0, e: 0 });
function add(map, key, model, t) {
  const m = (map[key] ||= {});
  const b = (m[model] ||= blank());
  b.n += 1; b.i += t.i; b.c += t.c; b.o += t.o; b.e += t.e ? 1 : 0;
}

/** AIを1回呼ぶごとに呼ぶ。usage が取れなかったときは est（文字数からの推定）を使う */
export async function recordUsage({ model, tag = 'other', usage = null, est = null }) {
  const t = usage
    ? { i: Number(usage.prompt_tokens) || 0, c: Number((usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) || 0), o: Number(usage.completion_tokens) || 0, e: false }
    : { i: Math.max(0, Math.round((est && est.i) || 0)), c: 0, o: Math.max(0, Math.round((est && est.o) || 0)), e: true };
  if (!t.i && !t.o) return;
  // ここから setMeta までは途中で await しない（同時に呼ばれても足し算が消えないように）
  const u = JSON.parse(JSON.stringify(S.meta.aiUsage || {}));
  const day = today();
  u.since = u.since || day;
  u.days = u.days || {}; u.months = u.months || {}; u.tags = u.tags || {};
  add(u.days, day, model, t); add(u.months, day.slice(0, 7), model, t); add(u.tags, tag, model, t);
  // 日ごとの記録は、直近90日ぶんだけ残す（月ごとの合計は残る）
  const oldest = addDays(day, -90);
  for (const d of Object.keys(u.days)) if (d < oldest) delete u.days[d];
  await store.setMeta({ aiUsage: u });
}

export async function resetUsage() {
  await store.setMeta({ aiUsage: null });
}

/** トークンの束 → ドル（単価が分からなければ null） */
export function costOf(t, model) {
  const p = priceFor(model);
  if (!p) return null;
  const cached = p.cached === null || p.cached === undefined ? p.in : p.cached;
  return (Math.max(0, t.i - t.c) * p.in + t.c * cached + t.o * p.out) / 1e6;
}

/** { モデル: トークンの束 } の合計。unknown は料金が分からない分があるか */
function sumBucket(byModel) {
  const r = { usd: 0, n: 0, i: 0, c: 0, o: 0, e: 0, unknown: false };
  for (const [model, t] of Object.entries(byModel || {})) {
    r.n += t.n; r.i += t.i; r.c += t.c; r.o += t.o; r.e += t.e;
    const c = costOf(t, model);
    if (c === null) r.unknown = true; else r.usd += c;
  }
  return r;
}

/** ホームと詳細画面に出す集計 */
export function summarize() {
  const u = S.meta.aiUsage || { days: {}, months: {}, tags: {} };
  const t = today();
  const ym = t.slice(0, 7);
  const prevYm = addDays(`${ym}-01`, -1).slice(0, 7);
  const sumMonths = {};
  for (const m of Object.values(u.months || {})) for (const [model, v] of Object.entries(m)) { const b = (sumMonths[model] ||= blank()); b.n += v.n; b.i += v.i; b.c += v.c; b.o += v.o; b.e += v.e; }
  const total = sumBucket(sumMonths);
  const last7 = Array.from({ length: 7 }, (_, k) => { const d = addDays(t, k - 6); const s = sumBucket((u.days || {})[d]); return { date: d, usd: s.usd, n: s.n }; });
  const tags = Object.entries(u.tags || {}).map(([tag, byModel]) => ({ tag, ...sumBucket(byModel) })).sort((a, b) => b.usd - a.usd || b.n - a.n);
  const models = Object.entries(sumMonths).map(([model, v]) => ({ model, ...v, usd: costOf(v, model), known: costOf(v, model) !== null })).sort((a, b) => (b.usd || 0) - (a.usd || 0));
  return {
    today: sumBucket((u.days || {})[t]),
    month: sumBucket((u.months || {})[ym]),
    prevMonth: sumBucket((u.months || {})[prevYm]),
    total, last7, tags, models,
    since: u.since || null,
    any: total.n > 0,
  };
}

/* ---------- 表示用 ---------- */
export function fmtUsd(usd) {
  if (!usd) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** 円（ドル → 円）。小さい金額は小数1けたまで */
export function fmtYen(usd, rate = yenRate()) {
  const y = (usd || 0) * rate;
  if (y <= 0) return '0';
  if (y < 0.05) return '0.1未満';
  if (y < 10) return y.toFixed(1);
  return fmtNum(Math.round(y));
}

export function fmtTokens(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  return fmtNum(n);
}
