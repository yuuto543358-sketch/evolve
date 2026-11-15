// AI（Claude）との通信と、AIに渡す「あなたの記録のまとめ」
//
// EVOLVEにはサーバーがないので、あなたのAPIキーを使って、この端末から直接AnthropicのAPIを呼び出します。
// ・APIキーはこの端末の中（IndexedDB）にだけ保存し、バックアップファイルには含めません
// ・ビルド不要・外部ライブラリなしのアプリなので、公式SDKではなく fetch で直接呼んでいます
import * as db from './db.js';
import * as store from './store.js';
import { S } from './store.js';
import { computeGame, proteinOf, STAT_DEFS } from './game.js';
import { dayEnergy, cardioKind, workoutKcal, cardioRecordKcal } from './calc.js';
import { todayPlan } from './plan.js';
import { today, addDays, parseYmd, byDateDesc } from './util.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', desc: 'かしこさ重視（おすすめ）。相談1回 数円くらい' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', desc: 'バランス型。相談1回 1〜2円くらい' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', desc: 'とにかく安い。相談1回 1円未満' },
];
export const DEFAULT_MODEL = 'claude-opus-5-5';

let cachedKey;

export async function getKey() {
  if (cachedKey === undefined) cachedKey = (await db.kvGet('aiKey')) || '';
  return cachedKey;
}
export async function setKey(k) {
  cachedKey = (k || '').trim();
  await db.kvSet('aiKey', cachedKey);
}
export function hasKeySync() { return !!cachedKey; }
export function modelId() { return S.settings.aiModel || DEFAULT_MODEL; }

/** わかりやすいエラー */
export class AIError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

function errorFor(status, type, msg) {
  if (status === 401) return new AIError('APIキーが正しくないようです。PROFILE →「AIの設定」でキーを確認してください。', 'auth');
  if (status === 402 || type === 'billing_error' || /credit balance/i.test(msg || '')) return new AIError('APIの残高（クレジット）が足りないようです。Anthropicのコンソールで残高を確認してください。', 'billing');
  if (status === 403) return new AIError('このAPIキーでは使えない設定のようです。Anthropicのコンソールでキーの権限を確認してください。', 'permission');
  if (status === 429) return new AIError('短い時間に使いすぎたようです。1分ほど待ってから、もう一度お試しください。', 'rate');
  if (status === 529 || status >= 500) return new AIError('AIが混み合っています。少し待ってから、もう一度お試しください。', 'overloaded');
  if (status === 413) return new AIError('送る内容が大きすぎました。写真を小さくするか、文章を短くしてお試しください。', 'too_large');
  return new AIError(`AIに接続できませんでした（${status}）。${msg ? msg.slice(0, 120) : ''}`, 'other');
}

function buildBody({ system, messages, maxTokens, effort, schema, stream }) {
  const model = modelId();
  const body = {
    model,
    max_tokens: maxTokens,
    messages,
    output_config: { effort },
  };
  if (system) body.system = system;
  if (schema) body.output_config.format = { type: 'json_schema', schema };
  if (stream) body.stream = true;
  // 安全フィルターで止まったとき、別のモデルで自動的にやり直してもらう（HaikuはAPI側が未対応）
  if (model !== 'claude-haiku-5-5') body.fallbacks = 'default';
  return body;
}

async function post(body, signal) {
  const key = await getKey();
  if (!key) throw new AIError('APIキーがまだ設定されていません。', 'nokey');
  if (!navigator.onLine) throw new AIError('インターネットにつながっていません。つながってから、もう一度お試しください。', 'offline');
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': API_VERSION,
    // ブラウザから直接APIを呼ぶための指定（キーはこの端末の中だけにあります）
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (body.fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  let res;
  try {
    res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new AIError('中止しました。', 'aborted');
    throw new AIError('AIに接続できませんでした。通信の状態を確認して、もう一度お試しください。', 'network');
  }
  if (!res.ok) {
    let type = ''; let msg = '';
    try { const j = await res.json(); type = j.error && j.error.type; msg = j.error && j.error.message; } catch { /* ignore */ }
    throw errorFor(res.status, type, msg);
  }
  return res;
}

function checkStop(stopReason) {
  if (stopReason === 'refusal') throw new AIError('この内容にはAIが答えられませんでした。聞き方を変えて、もう一度お試しください。', 'refusal');
}

/** 1回で答えをもらう（食事の見積もり・メニュー作成など） */
export async function ask({ system, messages, maxTokens = 8000, effort = 'low', schema = null, signal = null }) {
  const res = await post(buildBody({ system, messages, maxTokens, effort, schema }), signal);
  const data = await res.json();
  checkStop(data.stop_reason);
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (data.stop_reason === 'max_tokens' && schema) throw new AIError('AIの答えが途中で切れました。もう一度お試しください。', 'truncated');
  return { text, usage: data.usage, model: data.model };
}

/** JSONで答えをもらう */
export async function askJSON(opts) {
  const { text } = await ask(opts);
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fallthrough */ } }
    throw new AIError('AIの答えをうまく読み取れませんでした。もう一度お試しください。', 'parse');
  }
}

/** 文字が少しずつ届く形で答えをもらう（相談・ふりかえり） */
export async function streamText({ system, messages, maxTokens = 16000, effort = 'medium', onText, signal = null }) {
  const res = await post(buildBody({ system, messages, maxTokens, effort, stream: true }), signal);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = ''; let full = ''; let stop = null;
  const handle = (dataLine) => {
    let ev;
    try { ev = JSON.parse(dataLine); } catch { return; }
    if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'fallback') {
      // 別のモデルに切り替わった：ここまでの文章は捨てて、続きから表示し直す
      full = ''; if (onText) onText('', full);
    } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
      full += ev.delta.text;
      if (onText) onText(ev.delta.text, full);
    } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
      stop = ev.delta.stop_reason;
    } else if (ev.type === 'error') {
      const t = ev.error && ev.error.type;
      throw errorFor(t === 'overloaded_error' ? 529 : 500, t, ev.error && ev.error.message);
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.startsWith('data:')) handle(line.slice(5).trim());
      }
    }
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e && e.name === 'AbortError') throw new AIError('中止しました。', 'aborted');
    throw new AIError('通信が途中で切れました。もう一度お試しください。', 'network');
  }
  checkStop(stop);
  return { text: full, stop };
}

/** キーが使えるか、いちばん小さなお願いで確かめる */
export async function testKey() {
  const { text } = await ask({ messages: [{ role: 'user', content: '「OK」とだけ答えてください。' }], maxTokens: 2000, effort: 'low' });
  return text.trim().length > 0;
}

/* =========================================================
   AIに渡す、あなたの記録のまとめ
   ========================================================= */
const WD = ['日', '月', '火', '水', '木', '金', '土'];

function dayLine(d) {
  const ws = S.workouts.filter((w) => w.date === d);
  const cs = S.cardio.filter((c) => c.date === d);
  const ms = S.meals.filter((m) => m.date === d);
  const b = S.body.filter((x) => x.date === d).sort(byDateDesc)[0];
  const dl = (S.daily || []).find((x) => x.date === d);
  const plan = S.meta.plans && S.meta.plans[d];
  const parts = [];
  if (plan) parts.push(`予定:${plan}`);
  if (ws.length) parts.push('筋トレ:' + ws.map((w) => `${w.exerciseName}${w.reps}${w.unit === 'sec' ? '秒' : '回'}x${w.sets}${w.weight ? `(${w.weight}kg)` : ''}`).join(','));
  if (cs.length) parts.push('有酸素:' + cs.map((c) => `${c.label || cardioKind(c.kind).name}${c.minutes ? c.minutes + '分' : ''}${c.distanceKm ? c.distanceKm + 'km' : ''}`).join(','));
  if (dl && (dl.steps || dl.activeKcal)) parts.push(`歩数:${dl.steps || '-'} 活動kcal:${dl.activeKcal || '-'}`);
  if (ms.length) {
    const p = proteinOf(ms);
    parts.push(`食事:P${Math.round(p.total)}g F${Math.round(p.fat)}g ${p.kcal ? Math.round(p.kcal) + 'kcal' : 'kcal未記録'}（${ms.filter((m) => m.slot !== 'protein' && m.content).map((m) => m.content).join('、') || '内容なし'}${ms.some((m) => m.slot === 'protein') ? '、プロテイン' : ''}）`);
  }
  if (b) parts.push(`体重:${b.weight ? b.weight + 'kg' : '-'}${b.bodyFat ? ` 体脂肪:${b.bodyFat}%` : ''}${b.waist ? ` ウエスト:${b.waist}cm` : ''}`);
  const dt = parseYmd(d);
  return `${d}(${WD[dt.getDay()]}) ${parts.length ? parts.join(' / ') : '記録なし'}`;
}

/** プロフィール・目標・直近の記録を、AIが読める短い文章にまとめる */
export function buildContext({ days = 14 } = {}) {
  const p = S.profile || {};
  const g = computeGame();
  const t = today();
  const goalName = (store.GOALS.find((x) => x.id === p.goal) || store.GOALS[0]).name;
  const weights = S.body.filter((b) => b.weight).sort((a, b) => (a.date < b.date ? -1 : 1));
  const first = weights[0]; const last = weights[weights.length - 1];
  const e = dayEnergy(t);
  const plan = todayPlan();
  const lines = [];
  lines.push('# ユーザーの基本情報');
  lines.push(`年齢:${p.age ?? '不明'} 身長:${p.height ?? '不明'}cm 性別:${p.sex === 'male' ? '男性' : p.sex === 'female' ? '女性' : '未設定'}`);
  lines.push(`目指す身体:${goalName}${p.goalNote ? `（本人のひとこと:${p.goalNote}）` : ''}`);
  lines.push(`1日の目標: タンパク質${p.proteinGoal || 100}g / 脂質の上限${p.fatLimit || 60}g / 歩数${S.settings.stepGoal || 8000}歩`);
  if (last) lines.push(`体重: 最新${last.weight}kg(${last.date})${first && first !== last ? ` / はじめ${first.weight}kg(${first.date})` : ''}${last.bodyFat ? ` / 体脂肪率${last.bodyFat}%` : ''}`);
  lines.push(`EVOLVE開始日:${p.startDate || '不明'} / レベル${g.level}（${g.title}） / 連続記録${g.currentStreak}日 / 記録した日 合計${g.activeDays}日`);
  lines.push(`ゲーム内ステータス: ${STAT_DEFS.map((s) => `${s.name}${g.stats[s.id]}`).join(' ')}`);
  lines.push('');
  lines.push(`# 今日（${t} ${WD[parseYmd(t).getDay()]}曜）`);
  lines.push(`今日の予定:${plan ? plan.label : '未選択'}`);
  lines.push(`今日のカロリー: 摂取${e.hasIntake ? e.intake : '未記録'} / 消費の目安${e.burned ?? '不明'} / 収支${e.balance ?? '不明'}`);
  lines.push('');
  lines.push('# 登録している筋トレ種目（この中から提案すること）');
  lines.push(S.exercises.map((x) => {
    const lastW = S.workouts.filter((w) => w.exerciseId === x.id).sort(byDateDesc)[0];
    return `${x.name}（${x.unit === 'sec' ? '秒数' : '回数'}で記録${x.useWeight ? '・重量あり' : ''}${lastW ? `・前回${lastW.date} ${lastW.reps}x${lastW.sets}` : '・未実施'}）`;
  }).join(' / '));
  lines.push('');
  lines.push(`# 直近${days}日の記録（新しい順）`);
  for (let i = 0; i < days; i++) lines.push(dayLine(addDays(t, -i)));
  return lines.join('\n');
}

/** 直近7日の合計（ふりかえり用） */
export function weekSummary() {
  const t = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, -i));
  let exDays = 0; let kcal = 0; let proteinDays = 0; let mealDays = 0; let steps = 0; let stepDays = 0;
  const goal = (S.profile && S.profile.proteinGoal) || 100;
  for (const d of days) {
    const ws = S.workouts.filter((w) => w.date === d); const cs = S.cardio.filter((c) => c.date === d);
    if (ws.length || cs.length) exDays++;
    kcal += ws.reduce((a, w) => a + workoutKcal(w), 0) + cs.reduce((a, c) => a + cardioRecordKcal(c), 0);
    const ms = S.meals.filter((m) => m.date === d);
    if (ms.length) { mealDays++; if (proteinOf(ms).total >= goal) proteinDays++; }
    const dl = (S.daily || []).find((x) => x.date === d);
    if (dl && dl.steps) { steps += dl.steps; stepDays++; }
  }
  return `この7日間の集計: 運動した日${exDays}日 / 運動の消費${Math.round(kcal)}kcal / 食事を記録した日${mealDays}日（うちタンパク質目標達成${proteinDays}日） / 平均歩数${stepDays ? Math.round(steps / stepDays) : '記録なし'}`;
}

/** コーチとしての基本の指示 */
export const COACH_SYSTEM = `あなたは身体づくりアプリ「EVOLVE」のAIコーチです。ユーザーは「細マッチョ」など自分の決めた身体を、無理なく続けながら目指しています。

話し方と姿勢:
- 日本語で、やさしく、短く答える。専門用語は使わず、中学生でもわかる言葉で。
- まず結論を1〜2文で。必要なら理由と、今日できる具体的な一歩を添える。長い前置きやまとめは書かない。
- ユーザーを責めない。記録しなかった日、体重が増えた日、たくさん食べた日があっても、失敗あつかいしない。食事を楽しむことを否定しない。
- 完璧を求めない。小さな前進を見つけて言葉にする。
- 下の「ユーザーの記録」に書かれている事実をもとに話す。記録にないことは推測で決めつけず、必要なら聞き返す。
- 数字（カロリーなど）は目安であることを忘れない。
- 病気やけが、強い痛み、極端な減量などの相談には、無理をせず医師などの専門家に相談するようすすめる。あなたは医師ではない。
- 見出しや表は使わない。箇条書きは必要なときだけ「・」で。強調は使わない。`;
