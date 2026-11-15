// AIコーチが「会話の中で、そのまま記録する」ための道具（Function calling）
//
// ・ユーザーが「ラーメン食べた」「スクワット30回を3セットやった」と話したら、AIが道具を呼んで記録する
// ・AIが作った記録には source: 'ai' の印をつける（画面に「AI」と表示し、あとから直せる）
// ・AIが送ってくる数字は、そのまま信じずに、ここで範囲を確かめてから保存する
import * as store from './store.js';
import { S } from './store.js';
import { workoutKcal, cardioRecordKcal, cardioKind } from './calc.js';
import { today, addDays, fmtDate, fmtNum } from './util.js';

export const SLOT_JP = { breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食', protein: 'プロテイン' };
const SLOTS = Object.keys(SLOT_JP);

const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});
const DAYS_AGO = { type: 'integer', description: '何日前のことか。今日なら0、昨日なら1。省略すると今日' };

export const TOOLS = [
  fn('record_meal', 'ユーザーが食べた・飲んだものを、食事の記録として1件保存する。「食べた・飲んだ」と確かに言っているときだけ使う。複数の食事は1回ずつ呼ぶ。', {
    slot: { type: 'string', enum: SLOTS, description: 'breakfast=朝食, lunch=昼食, dinner=夕食, snack=間食, protein=プロテイン（シェイク）。プロテインのときはタンパク質だけが記録される' },
    name: { type: 'string', description: '食べたものの短い名前（例：牛丼（並）とみそ汁）。20文字くらいまで' },
    protein_g: { type: 'number', description: 'タンパク質(g)の見積もり。プロテインで量が分からなければ省略（設定の1杯ぶんになる）' },
    fat_g: { type: 'number', description: '脂質(g)の見積もり' },
    kcal: { type: 'number', description: 'カロリー(kcal)の見積もり' },
    days_ago: DAYS_AGO,
  }, ['slot', 'name', 'protein_g', 'fat_g', 'kcal']),
  fn('record_workout', '筋トレを1種目ぶん、記録として保存する。「やった」と確かに言っているときだけ使う。種目が複数あれば1種目ずつ呼ぶ。', {
    exercise: { type: 'string', description: '種目名。「登録している筋トレ種目」にあるものは、その名前と完全に同じ文字で書く。ないものは新しい種目名（例：バーピー）' },
    reps: { type: 'integer', description: '1セットの回数。プランクのように秒数で記録する種目は、1セットの秒数（1分なら60）' },
    sets: { type: 'integer', description: 'セット数。言われていなければ1' },
    weight_kg: { type: 'number', description: '使った重さ(kg)。重さを使わない種目は省略' },
    unit: { type: 'string', enum: ['reps', 'sec'], description: '新しい種目のときだけ使う。回数で数えるなら reps、秒数で数えるなら sec' },
    part: { type: 'string', enum: ['upper', 'lower', 'core'], description: '新しい種目のときだけ使う。鍛える部位（upper=上半身, lower=下半身, core=体幹）' },
    days_ago: DAYS_AGO,
  }, ['exercise', 'reps', 'sets']),
  fn('record_cardio', 'ランニング・ウォーキング・サイクリングなどの有酸素運動を、1回ぶん記録として保存する。「やった」と確かに言っているときだけ使う。', {
    kind: { type: 'string', enum: ['run', 'walk', 'cycle', 'other'], description: 'run=ランニング, walk=ウォーキング, cycle=サイクリング, other=そのほか（水泳・ヨガなど）' },
    label: { type: 'string', description: 'kind が other のときの名前（例：水泳、ヨガ）。ほかのときは省略してよい' },
    minutes: { type: 'number', description: '運動した時間（分）。分からなければ省略' },
    distance_km: { type: 'number', description: '距離(km)。分からなければ省略' },
    days_ago: DAYS_AGO,
  }, ['kind']),
  fn('update_record', 'さっき AI が記録した内容にまちがいがあったとき、その記録を直す。record_id は、記録したときの結果に入っている値。直したい項目だけ渡す。新しく記録し直さないこと。', {
    record_id: { type: 'string', description: '直したい記録の record_id' },
    name: { type: 'string', description: '食事の名前（食事のとき）' },
    protein_g: { type: 'number' }, fat_g: { type: 'number' }, kcal: { type: 'number' },
    reps: { type: 'integer', description: '1セットの回数または秒数（筋トレのとき）' },
    sets: { type: 'integer' }, weight_kg: { type: 'number' },
    minutes: { type: 'number', description: '時間（分）（有酸素のとき）' },
    distance_km: { type: 'number', description: '距離(km)（有酸素のとき）' },
  }, ['record_id']),
];

/** コーチの会話にだけ追加する、記録についてのルール */
export const RECORD_RULES = `記録のルール（あなたは次の道具で、ユーザーの記録アプリにその場で記録できます）:
- record_meal=食事・間食・プロテイン / record_workout=筋トレ / record_cardio=ランニングなどの有酸素運動 / update_record=さっきAIが記録した内容の訂正
- ユーザーが「食べた・飲んだ・やった・走った」と、実際にしたことを話したら、確認をとらずにすぐ記録する。記録したあとは、何をどう記録したかを1〜2文で短く伝える（画面にも記録カードが出るので、数字を長くくり返さない）。
- 「これから食べる」「何を食べたらいい？」「やるつもり」のような予定・質問・たとえ話は記録しない。
- 記録に必要なことが足りないときは、記録する前に、いちばん大事なことを1つだけ聞く。
  筋トレ=種目と回数（セット数が分からなければ聞く。重さは重さを使う種目だけ） / 有酸素=時間か距離のどちらか / 食事=何を食べたか。
- 食事は、量が分からなくても、日本の一般的な1人前を仮定して記録してよい。そのときは「〇〇として記録しました」と、仮定したことを伝える（数字はあとから直せる）。
- 1回の食事に複数の品があれば、1件にまとめる（例：牛丼とみそ汁）。朝食と昼食など別々の食事は、それぞれ別に記録する。
- 同じ内容を二重に記録しない。上の「ユーザーの記録」の今日の欄にすでにあるものは記録しない。
- 記録を直したいと言われたら、update_record で直す（新しく記録し直さない）。AIが記録していないもの（ユーザーが自分で入力した記録）は直せないので、画面の記録から直してもらうよう伝える。
- 日付は days_ago で伝える（今日0・昨日1）。食事の時間帯を言われていないときは、「今の時刻」から朝食・昼食・夕食・間食を決めてよい。
- 栄養の数字は目安。細かすぎる端数にはしない。食べたものを評価したり、注意したりしない。
- 「聞き取り」を頼まれたとき（例：「今日食べたものを聞き取って記録して」）は、1回に1つだけ質問して、順番に聞き取る。
  食事は朝・昼・夕・間食の順に聞く（すでに記録がある食事は飛ばす）。運動は筋トレと有酸素。
  1つ答えをもらうたびに、すぐ記録して、次を聞く。「ほかにはありますか？」と最後に確かめて終わる。`;

/* ---------- 文字や数字を整える ---------- */
const norm = (s) => String(s || '').normalize('NFKC').replace(/[\s・、,.。ー-]/g, '').toLowerCase();
const num = (v, min, max) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? Math.min(max, n) : null;
};
const round1 = (n) => Math.round(n * 10) / 10;
const json = (o) => JSON.stringify(o);

function dateOf(a) {
  const n = Math.round(Number(a.days_ago));
  return addDays(today(), -(Number.isFinite(n) ? Math.min(30, Math.max(0, n)) : 0));
}

function guessSlot() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17.5) return 'snack';
  return 'dinner';
}

/** 登録している種目から、名前でさがす（完全一致→ほぼ一致。3文字以上のときだけ「ふくまれる」で一致とみなす） */
function findExercise(name) {
  const n = norm(name);
  if (!n) return null;
  const exact = S.exercises.find((e) => norm(e.name) === n);
  if (exact) return exact;
  return S.exercises.find((e) => {
    const m = norm(e.name);
    return Math.min(m.length, n.length) >= 3 && (m.includes(n) || n.includes(m));
  }) || null;
}

const recent = (r) => Date.now() - (r.createdAt || 0) < 3 * 60 * 1000;

/** 画面に出す短い説明（記録カードと、AIへの結果の両方で使う） */
export function recSummary(kind, rec) {
  const dateTail = rec.date && rec.date !== today() ? `（${fmtDate(rec.date, { weekday: false })}）` : '';
  if (kind === 'meals') {
    const parts = [];
    if (rec.protein) parts.push(`タンパク質${fmtNum(rec.protein, 0)}g`);
    if (rec.fat) parts.push(`脂質${fmtNum(rec.fat, 0)}g`);
    if (rec.kcal) parts.push(`${fmtNum(rec.kcal)}kcal`);
    return { label: `${SLOT_JP[rec.slot] || '食事'}${dateTail}`, main: rec.slot === 'protein' ? 'プロテイン' : (rec.content || SLOT_JP[rec.slot] || '食事'), sub: parts.join(' ・ ') };
  }
  if (kind === 'workouts') {
    const sec = rec.unit === 'sec';
    const parts = [`${rec.reps}${sec ? '秒' : '回'}×${rec.sets}セット`];
    if (rec.weight) parts.push(`${fmtNum(rec.weight, 1)}kg`);
    parts.push(`約${fmtNum(workoutKcal(rec))}kcal`);
    return { label: `筋トレ${dateTail}`, main: rec.exerciseName, sub: parts.join(' ・ ') };
  }
  const parts = [];
  if (rec.minutes) parts.push(`${fmtNum(rec.minutes)}分`);
  if (rec.distanceKm) parts.push(`${fmtNum(rec.distanceKm, 2)}km`);
  parts.push(`約${fmtNum(cardioRecordKcal(rec))}kcal`);
  return { label: `有酸素運動${dateTail}`, main: rec.label || cardioKind(rec.kind).name, sub: parts.join(' ・ ') };
}

const ok = (kind, rec, op, extra = {}, uiExtra = {}) => {
  const s = recSummary(kind, rec);
  return {
    content: json({ status: op === 'create' ? 'recorded' : 'updated', record_id: rec.id, date: rec.date, summary: `${s.label} ${s.main} ${s.sub}`.trim(), ...extra }),
    ui: { type: 'rec', kind, id: rec.id, op, summary: `${s.label} ${s.main}`, ...uiExtra },
  };
};
/** ui=null のときは、AIが自分でユーザーに聞き返す（画面には何も出さない） */
const fail = (message, uiText = null) => ({
  content: json({ status: 'error', message }),
  ui: uiText ? { type: 'note', tone: 'warn', text: uiText } : null,
});
const dup = () => ({
  content: json({ status: 'duplicate', message: '同じ記録が直前にあるため、保存しませんでした（すでに記録されています）' }),
  ui: { type: 'note', tone: 'muted', text: '同じ記録がすぐ前にあるため、記録しませんでした' },
});

/* ---------- 道具の実行 ---------- */
async function toolMeal(a) {
  const slot = SLOTS.includes(a.slot) ? a.slot : guessSlot();
  const date = dateOf(a);
  let rec;
  if (slot === 'protein') {
    const p = num(a.protein_g, 1, 100) ?? (S.settings.proteinPerShake || 20);
    rec = { date, slot, content: 'プロテイン', protein: Math.round(p), fat: null, kcal: null };
  } else {
    const name = String(a.name || '').trim().slice(0, 40);
    if (!name) return fail('食べたものの名前がありません。ユーザーに何を食べたか聞いてください。');
    const protein = num(a.protein_g, 0, 300); const fat = num(a.fat_g, 0, 300); const kcal = num(a.kcal, 0, 5000);
    if (protein === null && fat === null && kcal === null) return fail('栄養の見積もりがありません。見積もって、もう一度呼んでください。');
    rec = { date, slot, content: name, protein: Math.round(protein || 0), fat: fat ? Math.round(fat) : null, kcal: kcal ? Math.round(kcal / 10) * 10 : null };
  }
  if (S.meals.some((m) => m.date === date && m.slot === slot && norm(m.content) === norm(rec.content) && recent(m))) return dup();
  const saved = await store.saveRecord('meals', { ...rec, source: 'ai' }, { silent: true });
  return ok('meals', saved, 'create');
}

async function toolWorkout(a) {
  const name = String(a.exercise || '').trim().slice(0, 30);
  if (!name) return fail('種目名がありません。ユーザーに何をやったか聞いてください。');
  const reps = Math.round(Number(a.reps));
  if (!Number.isFinite(reps) || reps < 1) return fail('回数（または秒数）がありません。ユーザーに聞いてください。');
  const sets = Math.round(Number(a.sets));
  const setsN = Number.isFinite(sets) && sets >= 1 ? Math.min(20, sets) : 1;
  const date = dateOf(a);
  let ex = findExercise(name);
  let newEx = false;
  if (!ex) {
    // 登録していない種目は、新しい種目として追加する（TRAININGの「種目を管理」でいつでも直せる）
    const unit = a.unit === 'sec' ? 'sec' : 'reps';
    ex = await store.saveRecord('exercises', {
      name, unit, kcalPer: unit === 'sec' ? 0.07 : 0.4, useWeight: Number(a.weight_kg) > 0,
      part: ['upper', 'lower', 'core'].includes(a.part) ? a.part : 'upper', builtin: false,
      order: Math.max(0, ...S.exercises.map((x) => x.order ?? 0)) + 1, source: 'ai',
    }, { silent: true });
    newEx = true;
  }
  const r = Math.min(reps, ex.unit === 'sec' ? 3600 : 1000);
  const weight = num(a.weight_kg, 0.1, 300);
  if (S.workouts.some((w) => w.date === date && w.exerciseId === ex.id && w.reps === r && w.sets === setsN && recent(w))) return dup();
  const saved = await store.saveRecord('workouts', {
    date, exerciseId: ex.id, exerciseName: ex.name, unit: ex.unit, kcalPer: ex.kcalPer,
    reps: r, sets: setsN, weight: weight ? round1(weight) : null, source: 'ai',
  }, { silent: true });
  return ok('workouts', saved, 'create', newEx ? { note: `「${ex.name}」を新しい種目として追加しました` } : {}, { exId: ex.id, newEx });
}

async function toolCardio(a) {
  const kind = ['run', 'walk', 'cycle', 'other'].includes(a.kind) ? a.kind : 'other';
  const minutes = num(a.minutes, 1, 1000); const km = num(a.distance_km, 0.1, 500);
  if (!minutes && !km) return fail('時間か距離が分かりません。ユーザーにどちらかを聞いてください。');
  const label = String(a.label || '').trim().slice(0, 20) || null;
  const date = dateOf(a);
  const rec = { date, kind, label, minutes: minutes ? Math.round(minutes) : null, distanceKm: km ? Math.round(km * 100) / 100 : null };
  if (S.cardio.some((c) => c.date === date && c.kind === kind && (c.minutes || 0) === (rec.minutes || 0) && (c.distanceKm || 0) === (rec.distanceKm || 0) && recent(c))) return dup();
  const saved = await store.saveRecord('cardio', { ...rec, source: 'ai' }, { silent: true });
  return ok('cardio', saved, 'create');
}

async function toolUpdate(a) {
  const id = String(a.record_id || '');
  let kind = null; let rec = null;
  for (const k of ['meals', 'workouts', 'cardio']) {
    const r = S[k].find((x) => x.id === id);
    if (r) { kind = k; rec = r; break; }
  }
  if (!rec) return fail('その記録は見つかりませんでした（すでに削除された可能性があります）。', '直したい記録が見つかりませんでした');
  if (rec.source !== 'ai') return fail('この記録はユーザーが自分で入力したものなので、AIは直せません。画面の記録を直してもらうよう伝えてください。');
  const patch = { ...rec };
  if (kind === 'meals') {
    if (a.name && rec.slot !== 'protein') patch.content = String(a.name).trim().slice(0, 40) || rec.content;
    const p = num(a.protein_g, 0, 300); const f = num(a.fat_g, 0, 300); const k = num(a.kcal, 0, 5000);
    if (p !== null) patch.protein = Math.round(p);
    if (f !== null && rec.slot !== 'protein') patch.fat = f ? Math.round(f) : null;
    if (k !== null && rec.slot !== 'protein') patch.kcal = k ? Math.round(k / 10) * 10 : null;
  } else if (kind === 'workouts') {
    const reps = num(a.reps, 1, rec.unit === 'sec' ? 3600 : 1000); const sets = num(a.sets, 1, 20); const w = num(a.weight_kg, 0, 300);
    if (reps !== null) patch.reps = Math.round(reps);
    if (sets !== null) patch.sets = Math.round(sets);
    if (w !== null) patch.weight = w ? round1(w) : null;
  } else {
    const m = num(a.minutes, 1, 1000); const d = num(a.distance_km, 0.1, 500);
    if (m !== null) patch.minutes = Math.round(m);
    if (d !== null) patch.distanceKm = Math.round(d * 100) / 100;
    if (!patch.minutes && !patch.distanceKm) return fail('時間も距離もない記録にはできません。');
  }
  const saved = await store.saveRecord(kind, patch, { silent: true });
  return ok(kind, saved, 'update');
}

/** AIが呼んだ道具を実行する。戻り値の content はAIに返す結果、ui は画面に出すカードの情報 */
export async function runTool(call) {
  let a;
  try { a = JSON.parse(call.arguments || '{}'); } catch { return fail('引数がJSONとして読み取れませんでした。正しい形で、もう一度呼んでください。'); }
  if (!a || typeof a !== 'object' || Array.isArray(a)) a = {};
  switch (call.name) {
    case 'record_meal': return toolMeal(a);
    case 'record_workout': return toolWorkout(a);
    case 'record_cardio': return toolCardio(a);
    case 'update_record': return toolUpdate(a);
    default: return fail(`「${call.name}」という道具はありません。`);
  }
}

/** 記録カードの「取り消す」：記録を消す（AIが新しく作った種目で、ほかに使っていなければ、その種目も消す） */
export async function undoRecord(ui) {
  await store.deleteRecord(ui.kind, ui.id);
  if (ui.kind === 'workouts' && ui.newEx && ui.exId && !S.workouts.some((w) => w.exerciseId === ui.exId)) {
    await store.deleteRecord('exercises', ui.exId);
  }
}

/* ---------- 会話の履歴 ---------- */

/** 取り消された記録は、AIにも「もうない」と伝える */
function freshContent(m) {
  const ui = m.ui;
  if (ui && ui.type === 'rec' && ui.op === 'create' && !(S[ui.kind] || []).some((r) => r.id === ui.id)) {
    try {
      const o = JSON.parse(m.content);
      o.status = 'deleted_by_user';
      o.note = 'ユーザーが取り消したか削除したので、この記録はもうありません';
      return JSON.stringify(o);
    } catch { /* そのまま */ }
  }
  return m.content;
}

/** 保存している履歴 → AIに送る形（画面用の ui などは外す） */
export function toApiMessages(history) {
  const out = [];
  for (const m of history) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length) out.push({ role: 'assistant', content: m.content || null, tool_calls: m.tool_calls });
      else if (m.content) out.push({ role: 'assistant', content: m.content });
    } else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: freshContent(m) });
  }
  return out;
}

/** 読み込んだ履歴を整える（道具の呼び出しと結果がそろっていないものは捨てる。先頭はユーザーの発言にする） */
export function sanitizeHistory(raw) {
  const arr = Array.isArray(raw) ? raw.filter((m) => m && typeof m === 'object') : [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    if (m.role === 'user') {
      if (typeof m.content === 'string') out.push(m);
    } else if (m.role === 'assistant') {
      if (m.tool_calls && m.tool_calls.length) {
        const tools = [];
        let j = i + 1;
        while (j < arr.length && arr[j].role === 'tool') { tools.push(arr[j]); j++; }
        if (m.tool_calls.every((c) => tools.some((t) => t.tool_call_id === c.id))) out.push(m, ...tools);
        i = j - 1;
      } else if (typeof m.content === 'string' && m.content) out.push(m);
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** 長くなりすぎないよう、新しいほうから max 件だけ残す（必ずユーザーの発言から始める） */
export function trimHistory(h, max = 60) {
  if (h.length <= max) return h;
  let start = h.length - max;
  while (start < h.length && h[start].role !== 'user') start++;
  if (start >= h.length) start = Math.max(0, h.map((m) => m.role).lastIndexOf('user'));
  return h.slice(start);
}
