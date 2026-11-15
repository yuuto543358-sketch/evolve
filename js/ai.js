// AI（OpenAI）との通信と、AIに渡す「あなたの記録のまとめ」
//
// EVOLVEにはサーバーがないので、あなたのOpenAIのAPIキーを使って、この端末から直接OpenAIのAPIを呼び出します。
// ・APIキーはこの端末の中（IndexedDB）にだけ保存し、バックアップファイルには含めません
// ・ビルド不要・外部ライブラリなしのアプリなので、SDKではなく fetch で直接呼んでいます（Chat Completions API）
import * as db from './db.js';
import * as store from './store.js';
import { S } from './store.js';
import { computeGame, proteinOf, STAT_DEFS } from './game.js';
import { dayEnergy, cardioKind, workoutKcal, cardioRecordKcal } from './calc.js';
import { todayPlan } from './plan.js';
import { recordUsage } from './aicost.js';
import { TOOLS } from './aitools.js';
import { today, addDays, parseYmd, byDateDesc } from './util.js';

const API_BASE = 'https://api.openai.com/v1';

/** よく使うモデル（「AIの設定」で、あなたのキーで使えるモデルの一覧からも選べます） */
export const AI_MODELS = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', desc: 'かしこさ重視（おすすめ）。相談1回 1〜2円くらい' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', desc: 'バランス型。相談1回 1円くらい' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', desc: 'とにかく安い。相談1回 1円未満' },
];
export const DEFAULT_MODEL = 'gpt-6.1-sol';

let cachedKey;

/**
 * 貼り付けたキーを整える：全角の英数字は半角に、空白・改行・見えない文字は取りのぞく。
 * （見えない文字がまじっていると、通信そのものが失敗して「接続できません」と出てしまうため）
 */
export function cleanKey(k) {
  return String(k || '').normalize('NFKC').replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '');
}
/** キーとして使える文字（半角の英数字・記号だけ）か */
export function keyLooksValid(k) { return /^[\x21-\x7e]+$/.test(k); }

export async function getKey() {
  if (cachedKey === undefined) {
    const saved = (await db.kvGet('aiKey')) || '';
    cachedKey = cleanKey(saved);
    // 以前の版で入れたAnthropicのキーは使えないので、未設定あつかいにする
    if (/^sk-ant-/.test(cachedKey)) cachedKey = '';
    if (cachedKey !== saved) await db.kvSet('aiKey', cachedKey);
  }
  return cachedKey;
}
export async function setKey(k) {
  cachedKey = cleanKey(k);
  await db.kvSet('aiKey', cachedKey);
}
export function hasKeySync() { return !!cachedKey; }
export function modelId() {
  const m = S.settings.aiModel;
  return m && !/^claude-/.test(m) ? m : DEFAULT_MODEL;
}
export function modelLabel(id = modelId()) {
  const m = AI_MODELS.find((x) => x.id === id);
  return m ? m.label : id;
}

/** 画面に出す文章から、キーらしい文字を隠す */
export function scrub(t) { return String(t || '').replace(/sk-[A-Za-z0-9_\-*.]{4,}/g, 'sk-…'); }

/**
 * わかりやすいエラー
 * status＝HTTPの番号、detail＝OpenAIが返した英語の説明（画面の「くわしく」と接続のテストで見せる）
 */
export class AIError extends Error {
  constructor(message, kind, info = {}) {
    super(message);
    this.kind = kind;
    this.status = info.status || null;
    this.detail = scrub(info.detail || '').slice(0, 220);
  }
}

/** いちばん最近の通信エラー（接続のテストなどで使う） */
let lastError = null;
export function getLastError() { return lastError; }
function remember(e, model) { lastError = { when: Date.now(), kind: e.kind, status: e.status, detail: e.detail, model }; return e; }

function networkError() {
  return new AIError('AIに接続できませんでした。電波やWi-Fi、VPN・広告ブロックなどを確かめて、もう一度お試しください。', 'network');
}

function errorFor(status, err) {
  const code = (err && (err.code || err.type)) || '';
  const msg = (err && err.message) || '';
  const info = { status, detail: msg };
  if (status === 401) return new AIError('APIキーが正しくないようです。PROFILE →「AIの設定」でキーを確認してください。', 'auth', info);
  if (code === 'insufficient_quota' || /quota|billing/i.test(msg)) return new AIError('APIの残高（クレジット）が足りないようです。OpenAIのサイトの「Billing」で残高を確認してください。', 'billing', info);
  if (status === 404 || code === 'model_not_found') return new AIError('選んだAIの種類（モデル）が、このキーでは使えないようです。PROFILE →「AIの設定」で別の種類を選んでください。', 'model', info);
  if (status === 403) return new AIError('このAPIキーでは使えない設定のようです。OpenAIのサイトでキーの権限を確認してください。', 'permission', info);
  if (status === 429) return new AIError('短い時間に使いすぎたようです。1分ほど待ってから、もう一度お試しください。', 'rate', info);
  if (status >= 500) return new AIError('AIが混み合っています。少し待ってから、もう一度お試しください。', 'overloaded', info);
  if (status === 413) return new AIError('送る内容が大きすぎました。写真を小さくするか、文章を短くしてお試しください。', 'too_large', info);
  return new AIError(`AIがうまく受け付けてくれませんでした（${status}）。`, 'other', info);
}

/* ---------- AIの種類（モデル）ごとに、使えない指定を覚えておく ---------- */
const offMap = new Map(); // モデル名 → 使えなかった指定の集まり（アプリを開き直すまで）
const capMap = new Map(); // モデル名 → 出力の長さの上限
const isOff = (model, key) => !!(offMap.get(model) && offMap.get(model).has(key));
const markOff = (model, key) => { if (!offMap.has(model)) offMap.set(model, new Set()); offMap.get(model).add(key); };
/** このAIの種類で、記録の道具（Function calling）が使えないと分かっているか */
export function toolsOff(model = modelId()) { return isOff(model, 'tools'); }

const NO_TOOLS_NOTE = '\n\n【重要】いまは、記録の道具が使えません。食事や運動を「記録しました」とは言わないでください。記録したいときは、アプリの＋ボタンから記録するよう、ひとこと案内してください。';

/** 道具が使えないときは、会話に混じっている「道具の呼び出し」を、ふつうの文章にならす */
function flattenTools(msgs) {
  const out = [];
  for (const m of msgs) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      out.push({ role: 'assistant', content: m.content || '（記録の操作をしました）' });
    } else if (m.role === 'tool') {
      let t = '';
      try { const o = JSON.parse(m.content); t = o.summary || o.message || ''; } catch { /* そのまま */ }
      const prev = out[out.length - 1];
      if (t && prev && prev.role === 'assistant') out[out.length - 1] = { role: 'assistant', content: `${prev.content}\n（${t}）` };
    } else out.push(m);
  }
  return out;
}

/** drop＝この通信で外す指定（'named'＝エラー文で名指しされた／'guess'＝原因が分からず試しに外した） */
function buildBody({ system, messages, maxTokens, effort, schema, stream, tools }, drop, model) {
  const off = (k) => drop.has(k) || isOff(model, k);
  const wantTools = !!(tools && tools.length);
  let sys = system;
  if (wantTools && off('tools') && sys) sys += NO_TOOLS_NOTE;
  const base = wantTools && off('tools') ? flattenTools(messages) : messages;
  const body = { model, messages: sys ? [{ role: 'system', content: sys }, ...base] : base };
  const cap = capMap.get(model);
  const mt = cap ? Math.min(maxTokens, cap) : maxTokens;
  if (!off('max_completion_tokens')) body.max_completion_tokens = mt; else body.max_tokens = mt;
  if (effort && !off('reasoning_effort')) body.reasoning_effort = effort;
  if (schema) {
    body.response_format = off('json_schema')
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: 'result', strict: true, schema } };
  }
  if (wantTools && !off('tools')) body.tools = tools;
  if (stream) {
    body.stream = true;
    // 使ったトークン数を、最後に教えてもらう（料金の計算に使う）
    if (!off('stream_options')) body.stream_options = { include_usage: true };
  }
  return body;
}

async function authHeaders() {
  const key = await getKey();
  if (!key) throw new AIError('APIキーがまだ設定されていません。', 'nokey');
  if (!keyLooksValid(key)) throw new AIError('APIキーに、使えない文字がまじっているようです。PROFILE →「AIの設定」で、キーをコピーし直して貼り付けてください。', 'auth');
  if (!navigator.onLine) throw new AIError('インターネットにつながっていません。つながってから、もう一度お試しください。', 'offline');
  return { 'content-type': 'application/json', authorization: `Bearer ${key}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortedError = () => new AIError('中止しました。', 'aborted');

const present = (key, body) => ({
  stream_options: 'stream_options' in body, tools: 'tools' in body, reasoning_effort: 'reasoning_effort' in body,
  json_schema: !!body.response_format, max_completion_tokens: 'max_completion_tokens' in body,
})[key];

/**
 * 「リクエストが受け付けられなかった（400）」ときに、原因の指定を外す／上限を下げる。何か変えたら true
 * （使えない指定は、モデルによってちがうため。アプリが新しい指定を足しても、つながらなくならないようにする）
 */
function fixRequest(err, body, model, drop) {
  const m = `${err.param || ''} ${err.code || ''} ${err.message || ''}`;
  const sent = body.max_completion_tokens || body.max_tokens || 0;
  const cap = m.match(/(?:at most|maximum(?: value)?(?: is| of)?|up to|limit(?: is| of)?)\D{0,30}?(\d{3,6})/i);
  if (/max_tokens|max_completion_tokens/.test(m) && cap && Number(cap[1]) < sent) { capMap.set(model, Number(cap[1])); return true; }
  const named = [
    ['stream_options', /stream_options|include_usage/],
    ['reasoning_effort', /reasoning_effort/],
    ['max_completion_tokens', /max_completion_tokens/],
    ['json_schema', /response_format|json_schema/],
    ['tools', /\btools?\b|tool_choice|tool_calls|function/i],
  ];
  for (const [key, re] of named) {
    if (re.test(m) && !drop.has(key) && !isOff(model, key) && present(key, body)) { drop.set(key, 'named'); return true; }
  }
  // 原因が分からないときは、なくても動く指定を、失っても困らないものから1つずつ外して試す
  for (const key of ['stream_options', 'tools', 'reasoning_effort']) {
    if (!drop.has(key) && present(key, body)) { drop.set(key, 'guess'); return true; }
  }
  return false;
}

/** @returns {Promise<{res: Response, model: string, chars: number}>} chars＝送った文字数（料金の推定に使う） */
async function post(opts, signal) {
  const headers = await authHeaders();
  const model = modelId();
  const drop = new Map();
  let netTries = 0;
  for (let attempt = 0; attempt < 9; attempt++) {
    const body = buildBody(opts, drop, model);
    const text = JSON.stringify(body);
    let res;
    try {
      res = await fetch(`${API_BASE}/chat/completions`, { method: 'POST', headers, body: text, signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw abortedError();
      // iPhoneは、しばらく使っていなかったあとの最初の通信が失敗することがあるので、少し待って2回までやり直す
      if (netTries < 2) {
        netTries++;
        await sleep(700 * netTries);
        if (signal && signal.aborted) throw abortedError();
        continue;
      }
      throw remember(networkError(), model);
    }
    if (res.ok) {
      // 指定を外して成功したら、そのAIの種類では使えないと覚える（名指しされたものと、最後に外したもの）
      const keys = [...drop.keys()];
      keys.forEach((k, i) => { if (drop.get(k) === 'named' || i === keys.length - 1) markOff(model, k); });
      return { res, model, chars: text.length };
    }
    let err = null;
    try { err = (await res.json()).error; } catch { /* ignore */ }
    if (res.status === 400 && err && fixRequest(err, body, model, drop)) continue;
    throw remember(errorFor(res.status, err), model);
  }
  throw remember(new AIError('AIとのやりとりがうまくいきませんでした。もう一度お試しください。', 'other'), model);
}

/** 料金の記録（記録に失敗しても、AIの答えは止めない） */
async function track(model, tag, usage, est) {
  try { await recordUsage({ model, tag, usage, est }); } catch (e) { console.warn('料金の記録に失敗', e); }
}

function checkFinish(reason, refusal) {
  if (refusal || reason === 'content_filter') throw new AIError('この内容にはAIが答えられませんでした。聞き方を変えて、もう一度お試しください。', 'refusal');
}

/** 1回で答えをもらう（食事の見積もり・メニュー作成など） */
export async function ask({ system, messages, maxTokens = 8000, effort = 'low', schema = null, signal = null, tag = 'other' }) {
  const { res, model, chars } = await post({ system, messages, maxTokens, effort, schema }, signal);
  const data = await res.json();
  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  await track(model, tag, data.usage, { i: chars / 2, o: (msg.content || '').length / 1.3 });
  checkFinish(choice.finish_reason, msg.refusal);
  if (choice.finish_reason === 'length' && schema) throw new AIError('AIの答えが途中で切れました。もう一度お試しください。', 'truncated');
  return { text: msg.content || '', usage: data.usage, model: data.model };
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

/**
 * 1回ぶんのやりとり。文字が少しずつ届く形で受け取り、AIが「道具を使いたい」と言ったときはその依頼も集める
 * @returns {Promise<{text: string, toolCalls: {id, name, arguments}[], finish: string|null}>}
 */
async function streamRound({ system, messages, tools = null, maxTokens = 16000, effort = 'medium', onText, signal = null, tag = 'coach' }) {
  const { res, model, chars } = await post({ system, messages, tools, maxTokens, effort, stream: true }, signal);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = ''; let full = ''; let finish = null; let refusal = ''; let usage = null;
  const calls = [];
  const handle = (dataLine) => {
    if (dataLine === '[DONE]') return;
    let ev;
    try { ev = JSON.parse(dataLine); } catch { return; }
    if (ev.error) throw errorFor(500, ev.error);
    if (ev.usage) usage = ev.usage;
    const c = ev.choices && ev.choices[0];
    if (!c) return;
    const d = c.delta || {};
    if (d.refusal) refusal += d.refusal;
    if (d.content) { full += d.content; if (onText) onText(d.content, full); }
    if (Array.isArray(d.tool_calls)) {
      for (const tc of d.tool_calls) {
        const i = Number.isInteger(tc.index) ? tc.index : 0;
        const cur = calls[i] || (calls[i] = { id: '', name: '', arguments: '' });
        if (tc.id) cur.id = tc.id;
        if (tc.function) {
          if (tc.function.name) cur.name = tc.function.name;
          if (tc.function.arguments) cur.arguments += tc.function.arguments;
        }
      }
    }
    if (c.finish_reason) finish = c.finish_reason;
  };
  let failure = null;
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
    failure = e;
  }
  // 料金の記録（最後まで届かなかったときも、使った分は文字数からの推定で記録する）
  const argChars = calls.reduce((t, c) => t + (c ? c.arguments.length + c.name.length : 0), 0);
  await track(model, tag, usage, { i: chars / 2, o: (full.length + argChars) / 1.3 });
  if (failure) {
    if (failure instanceof AIError) throw failure;
    if (failure && failure.name === 'AbortError') throw new AIError('中止しました。', 'aborted');
    throw new AIError('通信が途中で切れました。もう一度お試しください。', 'network');
  }
  checkFinish(finish, refusal);
  const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, arguments: c.arguments || '{}' }));
  return { text: full, toolCalls, finish };
}

/** 文字が少しずつ届く形で答えをもらう（ふりかえりなど） */
export async function streamText({ system, messages, maxTokens = 16000, effort = 'medium', onText, signal = null, tag = 'review' }) {
  const r = await streamRound({ system, messages, maxTokens, effort, onText, signal, tag });
  return { text: r.text, stop: r.finish };
}

/**
 * 会話（コーチ）：AIが「記録する」などの道具を使えるやりとり。
 * 道具を使う依頼が来たら execute で実行し、その結果をAIに返して、続きの答えをもらう。
 *
 * messages は会話の履歴（OpenAIのメッセージ形式）で、新しいやりとりはこの配列の後ろに足されていく。
 *   {role:'user', content}
 *   {role:'assistant', content, tool_calls?}
 *   {role:'tool', tool_call_id, content, ui?}   ← ui は画面に出すためだけの情報（AIには送らない）
 */
export async function runChat({ system, messages, tools, toApi = (m) => m, execute, signal = null, tag = 'coach', maxRounds = 4, onRound, onText, onMessage }) {
  for (let round = 0; round < maxRounds; round++) {
    if (onRound) onRound(round);
    const lastRound = round === maxRounds - 1;
    const r = await streamRound({
      system, messages: toApi(messages), tools: lastRound ? null : tools, maxTokens: 16000,
      effort: round === 0 ? 'medium' : 'low', onText: (_, full) => { if (onText) onText(full); }, signal, tag,
    });
    if (!r.toolCalls.length) {
      const msg = { role: 'assistant', content: r.text.trim() ? r.text : '（うまく答えられませんでした。もう一度聞いてみてください）' };
      messages.push(msg);
      if (onMessage) onMessage(msg);
      return;
    }
    const asst = {
      role: 'assistant', content: r.text || null,
      tool_calls: r.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
    };
    messages.push(asst);
    if (onMessage) onMessage(asst);
    // すべての依頼に必ず答えを返す（答えのない依頼が残ると、次のやりとりがエラーになるため）
    for (const c of r.toolCalls) {
      let out;
      try { out = await execute(c); } catch (e) {
        console.warn('道具の実行に失敗', e);
        out = { content: JSON.stringify({ status: 'error', message: '記録中に問題が起きました' }), ui: { type: 'note', tone: 'warn', text: '記録できませんでした' } };
      }
      const tm = { role: 'tool', tool_call_id: c.id, content: out.content, ui: out.ui || null };
      messages.push(tm);
      if (onMessage) onMessage(tm);
    }
  }
}

/**
 * キーが使えるか確かめる（モデルの一覧を取るだけなので、お金はかかりません）
 * @returns {Promise<string[]>} このキーで使える文章用モデルのID
 */
export async function testKey() {
  const headers = await authHeaders();
  let res = null;
  for (let i = 0; i < 3 && !res; i++) {
    try { res = await fetch(`${API_BASE}/models`, { headers: { authorization: headers.authorization } }); } catch { if (i < 2) await sleep(700 * (i + 1)); }
  }
  if (!res) throw remember(networkError(), 'models');
  if (!res.ok) {
    let err = null;
    try { err = (await res.json()).error; } catch { /* ignore */ }
    throw remember(errorFor(res.status, err), 'models');
  }
  const data = await res.json();
  const ids = ((data && data.data) || []).map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/.test(id) && !/(image|audio|realtime|tts|transcribe|embedding|search|moderation|instruct|codex)/.test(id))
    .sort().reverse();
  await store.setMeta({ aiModels: ids.slice(0, 60) });
  return ids;
}

/* =========================================================
   接続のテスト：つながらないときに、どこで止まっているかを順番に調べる
   ========================================================= */
function friendly(status, err) {
  const code = (err && (err.code || err.type)) || '';
  const msg = (err && err.message) || '';
  if (status === 401) return 'APIキーが正しくありません。';
  if (code === 'insufficient_quota' || /quota|billing/i.test(msg)) return '残高（クレジット）が足りません。';
  if (status === 404 || code === 'model_not_found') return 'このAIの種類は、このキーでは使えません。';
  if (status === 403) return 'このキーでは使えない設定です（権限）。';
  if (status === 429) return '短い時間に使いすぎです。少し待ってください。';
  if (status >= 500) return 'OpenAI側が混み合っています。';
  if (status === 400) return 'この指定は受け付けられませんでした（アプリは、使えない指定を自動でさけます）。';
  return `うまくいきませんでした（${status}）。`;
}

/** 文章の返事（SSE）の中から、使用量を取り出す */
function usageFromSSE(text) {
  let usage = null;
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('data:')) continue;
    try { const ev = JSON.parse(line.slice(5).trim()); if (ev.usage) usage = ev.usage; } catch { /* [DONE] など */ }
  }
  return usage;
}

/**
 * @param {(row, rows) => void} onStep 1項目おわるたびに呼ばれる
 * 1回ずつ「ふつうの形」で送るので、アプリが自動でさける指定も、そのまま試される。
 * ごく少量のAIを数回使うので、1〜数円かかることがあります。
 */
export async function diagnose(onStep) {
  const rows = [];
  const add = (r) => { rows.push(r); if (onStep) onStep(r, rows); return r; };
  const key = await getKey();
  const model = modelId();
  if (!key) { add({ id: 'key', label: 'APIキー', ok: false, note: 'APIキーがまだ設定されていません。' }); return rows; }
  if (!keyLooksValid(key)) { add({ id: 'key', label: 'APIキー', ok: false, note: 'キーに、使えない文字（全角の文字など）がまじっています。コピーし直して貼り付けてください。' }); return rows; }
  const auth = { authorization: `Bearer ${key}` };
  const post = { method: 'POST', headers: { ...auth, 'content-type': 'application/json' } };
  const chatUrl = `${API_BASE}/chat/completions`;

  const probe = async (id, label, url, init, judge) => {
    let res;
    try { res = await fetch(url, init); } catch {
      return add({ id, label, ok: false, status: 0, note: 'つながりませんでした。電波・Wi-Fi・VPN・広告ブロックなどを確かめてください。', detail: '' });
    }
    if (!res.ok) {
      let err = null;
      try { err = (await res.json()).error; } catch { /* ignore */ }
      return add({ id, label, ok: false, status: res.status, note: friendly(res.status, err), detail: scrub((err && err.message) || '').slice(0, 220) });
    }
    const text = await res.text();
    let out = {};
    try { out = judge(text) || {}; } catch { out = { note: '返事がきました' }; }
    if (out.usage) await track(model, 'other', out.usage, null);
    return add({ id, label, ok: true, status: res.status, note: out.note || '問題ありません', warn: !!out.warn });
  };
  const ask1 = [{ role: 'user', content: '「OK」とだけ答えてください。' }];
  const base = { model, messages: ask1, max_completion_tokens: 1500 };
  const plain = (t) => { const d = JSON.parse(t); return { note: '返事がきました', usage: d.usage }; };

  await probe('models', 'キーの確認', `${API_BASE}/models`, { headers: auth }, (t) => {
    const ids = (JSON.parse(t).data || []).map((m) => m.id);
    const ok = ids.includes(model);
    return { note: `使えるAIは${ids.length}種類。選んでいる「${model}」は${ok ? '使えます' : 'このキーでは見つかりません（AIの設定で別の種類を選んでください）'}。`, warn: !ok };
  });
  if (!rows[0].ok) return rows; // キーか通信がだめなら、これ以上は試さない
  await probe('chat', '文章の返事', chatUrl, { ...post, body: JSON.stringify(base) }, plain);
  await probe('effort', '考える深さの指定', chatUrl, { ...post, body: JSON.stringify({ ...base, reasoning_effort: 'low' }) }, plain);
  await probe('stream', '少しずつ届く返事＋使用量', chatUrl, { ...post, body: JSON.stringify({ ...base, stream: true, stream_options: { include_usage: true } }) }, (t) => {
    const usage = usageFromSSE(t);
    return { note: usage ? '返事も使用量も届きました' : '返事は届きましたが、使用量は届きませんでした（料金は推定になります）', usage, warn: !usage };
  });
  await probe('tools', '記録の道具（会話からの自動記録）', chatUrl, {
    ...post,
    body: JSON.stringify({ model, max_completion_tokens: 1500, tools: TOOLS, messages: [{ role: 'user', content: '昼食にラーメンを食べたことにして、record_meal を呼んでください（栄養は適当でかまいません）。' }] }),
  }, (t) => {
    const d = JSON.parse(t);
    const called = d.choices && d.choices[0] && d.choices[0].finish_reason === 'tool_calls';
    return { note: called ? '記録の道具が使えます' : '道具は受け付けられました（今回は呼ばれませんでした）', usage: d.usage };
  });
  await probe('all', 'アプリと同じ形（すべてまとめて）', chatUrl, {
    ...post,
    body: JSON.stringify({ model, max_completion_tokens: 1500, reasoning_effort: 'low', stream: true, stream_options: { include_usage: true }, tools: TOOLS, messages: ask1 }),
  }, (t) => ({ note: '問題ありません', usage: usageFromSSE(t) }));
  return rows;
}

/** 接続のテストの結果を、コピーして貼り付けられる文章にする（キーは入れない） */
export function diagText(rows) {
  const lines = [`EVOLVE 接続のテスト（v${store.APP_VERSION}）`, `AIの種類: ${modelId()}`, `日時: ${new Date().toLocaleString('ja-JP')}`];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.label}: ${r.ok ? (r.warn ? '注意' : 'OK') : `だめ${r.status ? `（${r.status}）` : ''}`} … ${r.note}${r.detail ? `\n   詳細: ${r.detail}` : ''}`);
  });
  const le = getLastError();
  if (le) lines.push(`直前のエラー: ${le.kind}${le.status ? `（${le.status}）` : ''} ${le.detail || ''}`);
  return lines.join('\n');
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
  const now = new Date();
  lines.push(`今の時刻:${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
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
