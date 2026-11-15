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
const offMap = new Map(); // モデル名 → 使えなかった指定の集まり（アプリを開き直すまで）。'r_' で始まるものは新しい入り口（Responses）用
const capMap = new Map(); // モデル名 → 出力の長さの上限（'r:モデル名' は新しい入り口用）
const whyMap = new Map(); // モデル名 → { responses, chat }：道具が使えなかった理由（OpenAIが返した英語の説明）
const pathMap = new Map(); // モデル名 → 'responses' | 'chat' | 'none'：道具を使う会話で、いちばん最近うまくいった通り道
const isOff = (model, key) => !!(offMap.get(model) && offMap.get(model).has(key));
const markOff = (model, key) => { if (!offMap.has(model)) offMap.set(model, new Set()); offMap.get(model).add(key); };
const setWhy = (model, which, msg) => { const w = whyMap.get(model) || {}; w[which] = scrub(String(msg || '')).slice(0, 160); whyMap.set(model, w); };
/** 前に覚えたことを忘れる（接続のテストの前に、まっさらにする） */
function forget(model) { offMap.delete(model); capMap.delete(model); capMap.delete(`r:${model}`); whyMap.delete(model); pathMap.delete(model); }
/** このAIの種類で、会話からの自動記録（道具）が、どちらの入り口でも使えなかったか */
export function toolsOff(model = modelId()) { return pathMap.get(model) === 'none'; }
/** 道具が使えなかった理由（OpenAIが返した英語の説明。画面の「くわしく」に出す） */
export function toolsWhy(model = modelId()) {
  const w = whyMap.get(model) || {};
  return [w.responses && `新しい入り口：${w.responses}`, w.chat && `古い入り口：${w.chat}`].filter(Boolean).join(' / ');
}
/** 道具を使う会話で、いま使っている入り口（まだ試していなければ null） */
export function toolPath(model = modelId()) { return pathMap.get(model) || null; }

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
    if (re.test(m) && !drop.has(key) && !isOff(model, key) && present(key, body)) {
      drop.set(key, 'named');
      if (key === 'tools') setWhy(model, 'chat', err.message);
      return true;
    }
  }
  // 原因が分からないときは、なくても動く指定を、失っても困らないものから1つずつ外して試す
  for (const key of ['stream_options', 'tools', 'reasoning_effort']) {
    if (!drop.has(key) && present(key, body)) {
      drop.set(key, 'guess');
      if (key === 'tools') setWhy(model, 'chat', err.message);
      return true;
    }
  }
  return false;
}

/** 通信が切れて、やり直しても送れなかった／OpenAIが受け付けなかった（番号つき）ことを伝える、内部のしるし */
class NetFail extends Error {}
class HttpFail extends Error {
  constructor(status, err, body) { super('http'); this.status = status; this.err = err; this.body = body; }
}

/**
 * OpenAIに送る（入り口の path は '/chat/completions' か '/responses'）。
 * 通信が切れたら少し待って2回までやり直し、400で「この指定がだめ」と分かったら、その指定を外して送り直す。
 * @returns {Promise<{res: Response, drop: Map, body: object, chars: number}>} chars＝送った文字数（料金の推定に使う）
 */
async function sendJSON(path, signal, makeBody, fix) {
  const headers = await authHeaders();
  const drop = new Map();
  let netTries = 0;
  for (let attempt = 0; attempt < 9; attempt++) {
    const body = makeBody(drop);
    const text = JSON.stringify(body);
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: text, signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw abortedError();
      // iPhoneは、しばらく使っていなかったあとの最初の通信が失敗することがあるので、少し待って2回までやり直す
      if (netTries < 2) {
        netTries++;
        await sleep(700 * netTries);
        if (signal && signal.aborted) throw abortedError();
        continue;
      }
      throw new NetFail();
    }
    if (res.ok) return { res, drop, body, chars: text.length };
    let err = null;
    try { err = (await res.json()).error; } catch { /* ignore */ }
    if (res.status === 400 && err && fix(err, body, drop)) continue;
    throw new HttpFail(res.status, err, body);
  }
  throw new HttpFail(0, null, null);
}

/** 指定を外して成功したら、そのAIの種類では使えないと覚える（名指しされたものと、最後に外したもの） */
function learnDrops(model, drop, prefix = '') {
  const keys = [...drop.keys()];
  keys.forEach((k, i) => { if (drop.get(k) === 'named' || i === keys.length - 1) markOff(model, prefix + k); });
}

const stuckError = () => new AIError('AIとのやりとりがうまくいきませんでした。もう一度お試しください。', 'other');

function chatFailure(e, model) {
  if (e instanceof NetFail) return remember(networkError(), model);
  if (e instanceof HttpFail) return remember(e.status ? errorFor(e.status, e.err) : stuckError(), model);
  return e;
}

/** @returns {Promise<{res: Response, model: string, chars: number, tools: boolean}>} chars＝送った文字数、tools＝道具をつけて送れたか */
async function post(opts, signal) {
  const model = modelId();
  try {
    const { res, drop, body, chars } = await sendJSON('/chat/completions', signal, (d) => buildBody(opts, d, model), (err, b, d) => fixRequest(err, b, model, d));
    learnDrops(model, drop);
    return { res, model, chars, tools: 'tools' in body };
  } catch (e) { throw chatFailure(e, model); }
}

/* =========================================================
   もうひとつの入り口：Responses API（道具を使う会話は、まずこちらを使う）
   ---------------------------------------------------------
   新しいAI（GPT-6.1 Sol など）は、「記録の道具（Function calling）」を、
   古い入り口（Chat Completions）では受け付けず、新しい入り口（Responses）だけで受け付けます。
   そのため、道具を使う会話は、まず新しい入り口で送ります。
   新しい入り口が使えないときは、これまでの入り口（Chat Completions）にもどります。
   ========================================================= */

/** 新しい入り口が使えないので、古い入り口にもどる、という内部のしるし */
class ResponsesFallback extends Error {}

/** 道具の定義を、新しい入り口の形（name などがそのまま並ぶ形）にする。オプションの項目があるので strict は使わない */
const flatTools = (tools) => tools.map((t) => ({
  type: 'function', name: t.function.name, description: t.function.description, parameters: t.function.parameters, strict: false,
}));

/**
 * 会話の履歴（Chat Completionsの形）→ 新しい入り口の input の形。
 * replay＝この会話のいまのやりとりの中で、AIが返してきた「考えの記録つきの返事」。道具の結果を返すときは、そのまま添えて送る。
 */
function toResponsesInput(messages, replay) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      const raw = replay && calls.length ? replay.get(calls[0].id) : null;
      if (raw) { out.push(...raw); continue; }
      if (m.content) out.push({ role: 'assistant', content: m.content });
      for (const c of calls) out.push({ type: 'function_call', call_id: c.id, name: c.function.name, arguments: c.function.arguments || '{}' });
    } else if (m.role === 'tool') out.push({ type: 'function_call_output', call_id: m.tool_call_id, output: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
  }
  return out;
}

/** drop＝この通信で外す指定（'named'＝エラー文で名指しされた／'guess'＝原因が分からず試しに外した） */
function buildResponsesBody({ system, messages, tools, noTools, replay, maxTokens, effort }, drop, model) {
  const off = (k) => drop.has(k) || isOff(model, `r_${k}`);
  // store:false＝OpenAIの側に会話を残さない。include＝考えの記録（暗号化）を受け取って、道具の結果を返すときに添える
  const body = { model, store: false, stream: true, input: toResponsesInput(messages, off('include') ? null : replay) };
  if (system) body.instructions = system;
  const cap = capMap.get(`r:${model}`);
  body.max_output_tokens = cap ? Math.min(maxTokens, cap) : maxTokens;
  if (effort && !off('reasoning')) body.reasoning = { effort };
  if (!off('include')) body.include = ['reasoning.encrypted_content'];
  body.tools = flatTools(tools);
  body.tool_choice = noTools ? 'none' : 'auto';
  return body;
}

const CAP_RE = /(?:at most|maximum(?: value)?(?: is| of)?|up to|limit(?: is| of)?)\D{0,30}?(\d{3,6})/i;

/** 新しい入り口で「受け付けられなかった（400）」ときの、直し方（fixRequest の新しい入り口版）。何か変えたら true */
function fixResponsesRequest(err, body, model, drop) {
  const m = `${err.param || ''} ${err.code || ''} ${err.message || ''}`;
  const cap = m.match(CAP_RE);
  if (/max_output_tokens/.test(m) && cap && Number(cap[1]) < (body.max_output_tokens || 0)) { capMap.set(`r:${model}`, Number(cap[1])); return true; }
  // 道具の呼び出しと「考えの記録」の組み合わせがおかしい → 考えの記録はやめて、道具の呼び出しだけを送る
  if (/reasoning['"]?\s+item|without its required|encrypted_content|\binclude\b/i.test(m) && 'include' in body && !drop.has('include')) { drop.set('include', 'named'); return true; }
  if (/reasoning/i.test(m) && 'reasoning' in body && !drop.has('reasoning')) { drop.set('reasoning', 'named'); return true; }
  // 新しい入り口でも道具が受け付けられない → 古い入り口にもどる（この種類では、新しい入り口を道具には使わない）
  if (/\btools?\b|tool_choice|function/i.test(m)) { markOff(model, 'r_tools'); setWhy(model, 'responses', err.message); return false; }
  for (const key of ['include', 'reasoning']) {
    if (!drop.has(key) && key in body) { drop.set(key, 'guess'); return true; }
  }
  return false;
}

function responsesFailure(e, model) {
  if (e instanceof NetFail) return remember(networkError(), model);
  if (e instanceof HttpFail) {
    const { status, err } = e;
    const code = (err && (err.code || err.type)) || '';
    const msg = (err && err.message) || `HTTP ${status}`;
    // この入り口そのものが使えない／このキーでは許可されていない → 古い入り口にもどる（この種類では、もう新しい入り口を使わない）
    if ((status === 404 && code !== 'model_not_found') || status === 403) { markOff(model, 'r_api'); setWhy(model, 'responses', msg); return new ResponsesFallback(); }
    // 直せなかった400は、今回だけ古い入り口で試す（原因が会話の中身かもしれないので、覚えはしない）
    if (status === 400 && err) { setWhy(model, 'responses', msg); return new ResponsesFallback(); }
    return remember(status ? errorFor(status, err) : stuckError(), model);
  }
  return e;
}

/** 新しい入り口の返事の中の使用量 → 料金の計算で使う形（Chat Completionsと同じ名前）にそろえる */
function respUsage(u) {
  if (!u || typeof u !== 'object') return null;
  return {
    prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens,
    prompt_tokens_details: { cached_tokens: (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0 },
  };
}

/** 流れの途中で届いたエラー（response.failed / error）を、わかりやすいエラーにする */
function streamFailure(info) {
  const code = (info && (info.code || info.type)) || '';
  if (/rate_limit/.test(code)) return errorFor(429, info);
  if (/server_error|overloaded|unavailable|timeout/.test(code)) return errorFor(500, info);
  return errorFor(/quota/.test(code) ? 429 : 400, info);
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

/** 少しずつ届く返事（SSE）を1行ずつ読んで、「data:」のあとの中身を handle に渡す */
async function readSSE(res, handle) {
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
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
  if (buf.startsWith('data:')) handle(buf.slice(5).trim());
}

/** 1回ぶんの通信の後始末：料金を記録し、途中で切れていたらエラーにする（最後まで届かなかったときも、使った分は文字数からの推定で記録する） */
async function closeRound({ model, tag, usage, chars, outChars, failure }) {
  await track(model, tag, usage, { i: chars / 2, o: outChars / 1.3 });
  if (!failure) return;
  if (failure instanceof AIError) throw failure;
  if (failure && failure.name === 'AbortError') throw new AIError('中止しました。', 'aborted');
  throw new AIError('通信が途中で切れました。もう一度お試しください。', 'network');
}

/**
 * 1回ぶんのやりとり（これまでの入り口：Chat Completions）。
 * 文字が少しずつ届く形で受け取り、AIが「道具を使いたい」と言ったときはその依頼も集める
 * @returns {Promise<{text: string, toolCalls: {id, name, arguments}[], finish: string|null, items: null}>}
 */
async function streamRoundChat({ system, messages, tools = null, noTools = false, maxTokens = 16000, effort = 'medium', onText, signal = null, tag = 'coach' }) {
  const wantTools = !!(tools && tools.length) && !noTools;
  const { res, model, chars, tools: sentTools } = await post({ system, messages, tools: wantTools ? tools : null, maxTokens, effort, stream: true }, signal);
  if (wantTools) pathMap.set(model, sentTools ? 'chat' : 'none');
  let full = ''; let finish = null; let refusal = ''; let usage = null;
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
  try { await readSSE(res, handle); } catch (e) { failure = e; }
  const argChars = calls.reduce((t, c) => t + (c ? c.arguments.length + c.name.length : 0), 0);
  await closeRound({ model, tag, usage, chars, outChars: full.length + argChars, failure });
  checkFinish(finish, refusal);
  const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, arguments: c.arguments || '{}' }));
  return { text: full, toolCalls, finish, items: null };
}

/**
 * 1回ぶんのやりとり（新しい入り口：Responses）。返事の形は streamRoundChat と同じ。
 * items＝AIが返してきた「考えの記録つきの返事」。道具の結果を返すときに、そのまま添えて送るために持っておく（使えないときは null）
 */
async function streamRoundResponses({ system, messages, tools, noTools = false, replay = null, maxTokens = 16000, effort = 'medium', onText, signal = null, tag = 'coach' }, model) {
  let sent;
  try {
    sent = await sendJSON('/responses', signal, (d) => buildResponsesBody({ system, messages, tools, noTools, replay, maxTokens, effort }, d, model), (err, b, d) => fixResponsesRequest(err, b, model, d));
  } catch (e) { throw responsesFailure(e, model); }
  const { res, drop, chars } = sent;
  learnDrops(model, drop, 'r_');
  let full = ''; let refusal = ''; let usage = null; let finish = null; let ended = false; let finalOutput = null;
  const calls = []; const items = []; const byItem = new Map();
  const callAt = (i) => calls[i] || (calls[i] = { id: '', name: '', arguments: '' });
  const indexOf = (ev, fallback) => (Number.isInteger(ev.output_index) ? ev.output_index : (byItem.has(ev.item_id) ? byItem.get(ev.item_id) : fallback));
  const handle = (dataLine) => {
    if (dataLine === '[DONE]') return;
    let ev;
    try { ev = JSON.parse(dataLine); } catch { return; }
    switch (ev.type) {
      case 'response.output_item.added': {
        const it = ev.item || {};
        if (it.type !== 'function_call') break;
        const i = Number.isInteger(ev.output_index) ? ev.output_index : calls.length;
        const c = callAt(i);
        c.id = it.call_id || it.id || c.id; c.name = it.name || c.name; c.arguments = it.arguments || c.arguments;
        if (it.id) byItem.set(it.id, i);
        break;
      }
      case 'response.function_call_arguments.delta': {
        const c = calls[indexOf(ev, calls.length - 1)];
        if (c && ev.delta) c.arguments += ev.delta;
        break;
      }
      case 'response.function_call_arguments.done': {
        const c = calls[indexOf(ev, calls.length - 1)];
        if (c && typeof ev.arguments === 'string') c.arguments = ev.arguments;
        break;
      }
      case 'response.output_item.done': {
        const it = ev.item || {};
        if (Number.isInteger(ev.output_index)) items[ev.output_index] = it; else items.push(it);
        if (it.type === 'function_call') {
          const c = callAt(indexOf({ output_index: ev.output_index, item_id: it.id }, calls.length));
          if (it.call_id || it.id) c.id = it.call_id || it.id;
          if (it.name) c.name = it.name;
          if (typeof it.arguments === 'string' && it.arguments) c.arguments = it.arguments;
        }
        break;
      }
      case 'response.output_text.delta':
        if (ev.delta) { full += ev.delta; if (onText) onText(ev.delta, full); }
        break;
      case 'response.refusal.delta': refusal += ev.delta || ''; break;
      case 'response.completed':
      case 'response.incomplete': {
        ended = true;
        const r = ev.response || {};
        if (r.usage) usage = r.usage;
        if (ev.type === 'response.incomplete' || r.status === 'incomplete') {
          const why = r.incomplete_details && r.incomplete_details.reason;
          finish = why === 'content_filter' ? 'content_filter' : 'length';
        }
        if (Array.isArray(r.output)) finalOutput = r.output;
        break;
      }
      case 'response.failed': throw streamFailure((ev.response && ev.response.error) || {});
      case 'error': throw streamFailure(ev);
      default: break;
    }
  };
  let failure = null;
  try { await readSSE(res, handle); } catch (e) { failure = e; }
  if (!failure && !ended && !full && !calls.some(Boolean)) failure = new Error('何も届かないまま、流れが終わった');
  // 流れの途中の知らせが足りなかったときは、最後にまとまって届く内容から補う
  if (!failure) {
    if (!items.some(Boolean) && finalOutput) finalOutput.forEach((it, i) => { items[i] = it; });
    const done = items.filter(Boolean);
    if (!calls.some((c) => c && c.name)) {
      for (const it of done) if (it.type === 'function_call') calls.push({ id: it.call_id || it.id || '', name: it.name || '', arguments: it.arguments || '' });
    }
    if (!full) {
      const t = done.filter((it) => it.type === 'message').flatMap((it) => it.content || []).filter((c) => c && c.type === 'output_text').map((c) => c.text || '').join('');
      if (t) { full = t; if (onText) onText(t, t); }
    }
  }
  const argChars = calls.reduce((t, c) => t + (c ? c.arguments.length + c.name.length : 0), 0);
  await closeRound({ model, tag, usage: respUsage(usage), chars, outChars: full.length + argChars, failure });
  checkFinish(finish, refusal);
  const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, name: c.name, arguments: c.arguments || '{}' }));
  if (!finish) finish = toolCalls.length ? 'tool_calls' : 'stop';
  // 次に道具の結果を返すとき、そのまま添えられる形か（考えの記録が暗号化されて届いていて、道具の呼び出しにIDがあるとき）
  const done = items.filter(Boolean);
  const replayable = !drop.has('include') && !isOff(model, 'r_include') && done.length
    && done.every((it) => (it.type !== 'reasoning' || it.encrypted_content) && (it.type !== 'function_call' || it.call_id));
  return { text: full, toolCalls, finish, items: replayable ? done : null };
}

/**
 * 1回ぶんのやりとり。道具を使う会話は、まず新しい入り口（Responses）で送り、使えないときはこれまでの入り口（Chat Completions）にもどる。
 * noTools＝この回は道具を使わせない（会話が長引いたときの、最後の答え）
 * @returns {Promise<{text: string, toolCalls: {id, name, arguments}[], finish: string|null, items: object[]|null}>}
 */
async function streamRound(opts) {
  const model = modelId();
  if (opts.tools && opts.tools.length && !isOff(model, 'r_api') && !isOff(model, 'r_tools')) {
    try {
      const r = await streamRoundResponses(opts, model);
      if (!opts.noTools) pathMap.set(model, 'responses');
      return r;
    } catch (e) {
      if (!(e instanceof ResponsesFallback)) throw e;
    }
  }
  return streamRoundChat(opts);
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
  // このやりとりの中で、AIが返してきた「考えの記録つきの返事」（道具の呼び出しのID → 返事そのもの）。保存はしない
  const replay = new Map();
  for (let round = 0; round < maxRounds; round++) {
    if (onRound) onRound(round);
    const lastRound = round === maxRounds - 1;
    const r = await streamRound({
      system, messages: toApi(messages), tools, noTools: lastRound, replay, maxTokens: 16000,
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
    if (r.items) for (const c of r.toolCalls) replay.set(c.id, r.items);
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

/** 文章の返事（SSE）の中から、使用量を取り出す（これまでの入り口は ev.usage、新しい入り口は ev.response.usage） */
function usageFromSSE(text) {
  let usage = null;
  for (const line of String(text).split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim());
      if (ev.usage) usage = ev.usage;
      else if (ev.response && ev.response.usage) usage = respUsage(ev.response.usage);
    } catch { /* [DONE] など */ }
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
  forget(model); // 前に覚えたことは、いったん忘れる（このあと、アプリが自分で調べなおす）
  const auth = { authorization: `Bearer ${key}` };
  const postInit = { method: 'POST', headers: { ...auth, 'content-type': 'application/json' } };
  const chatUrl = `${API_BASE}/chat/completions`;
  const respUrl = `${API_BASE}/responses`;

  // soften(status, err) が文章を返したら、「だめ」ではなく「注意（使わないので問題なし）」として見せる
  const probe = async (id, label, url, init, judge, soften = null) => {
    let res;
    try { res = await fetch(url, init); } catch {
      return add({ id, label, ok: false, status: 0, note: 'つながりませんでした。電波・Wi-Fi・VPN・広告ブロックなどを確かめてください。', detail: '' });
    }
    if (!res.ok) {
      let err = null;
      try { err = (await res.json()).error; } catch { /* ignore */ }
      const detail = scrub((err && err.message) || '').slice(0, 220);
      const soft = soften && soften(res.status, err);
      if (soft) return add({ id, label, ok: true, warn: true, status: res.status, note: soft, detail });
      return add({ id, label, ok: false, status: res.status, note: friendly(res.status, err), detail });
    }
    const text = await res.text();
    let out = {};
    try { out = judge(text) || {}; } catch { out = { note: '返事がきました' }; }
    if (out.usage) await track(model, 'other', out.usage, null);
    return add({ id, label, ok: true, status: res.status, note: out.note || '問題ありません', warn: !!out.warn });
  };
  const okRow = (id) => rows.some((r) => r.id === id && r.ok && !r.warn);
  const ask1 = [{ role: 'user', content: '「OK」とだけ答えてください。' }];
  const meal = '昼食にラーメンを食べたことにして、record_meal を呼んでください（栄養は適当でかまいません）。';
  const base = { model, messages: ask1, max_completion_tokens: 1500 };
  const plain = (t) => { const d = JSON.parse(t); return { note: '返事がきました', usage: d.usage }; };
  const rBase = { model, store: false, max_output_tokens: 1500, reasoning: { effort: 'low' } };
  const rPlain = (t) => { const d = JSON.parse(t); return { note: '返事がきました', usage: respUsage(d.usage) }; };

  await probe('models', 'キーの確認', `${API_BASE}/models`, { headers: auth }, (t) => {
    const ids = (JSON.parse(t).data || []).map((m) => m.id);
    const ok = ids.includes(model);
    return { note: `使えるAIは${ids.length}種類。選んでいる「${model}」は${ok ? '使えます' : 'このキーでは見つかりません（AIの設定で別の種類を選んでください）'}。`, warn: !ok };
  });
  if (!rows[0].ok) return rows; // キーか通信がだめなら、これ以上は試さない
  await probe('chat', '文章の返事', chatUrl, { ...postInit, body: JSON.stringify(base) }, plain);
  await probe('effort', '考える深さの指定', chatUrl, { ...postInit, body: JSON.stringify({ ...base, reasoning_effort: 'low' }) }, plain);
  await probe('stream', '少しずつ届く返事＋使用量', chatUrl, { ...postInit, body: JSON.stringify({ ...base, stream: true, stream_options: { include_usage: true } }) }, (t) => {
    const usage = usageFromSSE(t);
    return { note: usage ? '返事も使用量も届きました' : '返事は届きましたが、使用量は届きませんでした（料金は推定になります）', usage, warn: !usage };
  });
  // 会話からの自動記録は、新しい入り口（Responses）を使う
  await probe('resp', '新しい入り口での返事', respUrl, { ...postInit, body: JSON.stringify({ ...rBase, input: ask1[0].content }) }, rPlain);
  await probe('rtools', '記録の道具（新しい入り口）', respUrl, {
    ...postInit, body: JSON.stringify({ ...rBase, tools: flatTools(TOOLS), input: meal }),
  }, (t) => {
    const d = JSON.parse(t);
    const called = (d.output || []).some((o) => o.type === 'function_call');
    return { note: called ? '記録の道具が使えます' : '道具は受け付けられました（今回は呼ばれませんでした）', usage: respUsage(d.usage) };
  });
  await probe('rall', 'アプリと同じ形（新しい入り口・すべてまとめて）', respUrl, {
    ...postInit,
    body: JSON.stringify({ ...rBase, stream: true, include: ['reasoning.encrypted_content'], tools: flatTools(TOOLS), tool_choice: 'auto', instructions: 'あなたは短く答えるアシスタントです。', input: ask1 }),
  }, (t) => ({ note: '問題ありません', usage: usageFromSSE(t) }));
  // これまでの入り口：新しい入り口で道具が使えるなら、こちらで使えなくても問題ない
  const viaResp = okRow('rtools') || okRow('rall');
  await probe('tools', '記録の道具（これまでの入り口）', chatUrl, {
    ...postInit, body: JSON.stringify({ model, max_completion_tokens: 1500, tools: TOOLS, messages: [{ role: 'user', content: meal }] }),
  }, (t) => {
    const d = JSON.parse(t);
    const called = d.choices && d.choices[0] && d.choices[0].finish_reason === 'tool_calls';
    return { note: called ? '記録の道具が使えます' : '道具は受け付けられました（今回は呼ばれませんでした）', usage: d.usage };
  }, (status) => (viaResp && status === 400 ? 'このAIは、これまでの入り口では道具を使えません。新しい入り口で使うので、問題ありません。' : null));
  const viaChat = okRow('tools');
  add({
    id: 'path', label: '会話からの自動記録', ok: viaResp || viaChat,
    note: viaResp ? '使えます（新しい入り口）' : viaChat ? '使えます（これまでの入り口）' : '使えません。記録は、画面下の＋ボタンからお願いします。',
  });
  return rows;
}

/** 接続のテストの結果を、コピーして貼り付けられる文章にする（キーは入れない） */
export function diagText(rows) {
  const lines = [`EVOLVE 接続のテスト（v${store.APP_VERSION}）`, `AIの種類: ${modelId()}`, `日時: ${new Date().toLocaleString('ja-JP')}`];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.label}: ${r.ok ? (r.warn ? '注意' : 'OK') : `だめ${r.status ? `（${r.status}）` : ''}`} … ${r.note}${r.detail ? `\n   詳細: ${r.detail}` : ''}`);
  });
  const tp = toolPath();
  if (tp) lines.push(`アプリが使っている道具の入り口: ${tp === 'responses' ? '新しい入り口（Responses）' : tp === 'chat' ? 'これまでの入り口（Chat Completions）' : '道具なし'}`);
  const why = toolsWhy();
  if (why) lines.push(`道具が使えなかった理由: ${why}`);
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
