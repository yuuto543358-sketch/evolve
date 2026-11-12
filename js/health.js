// Apple Watch・ヘルスケアからの取り込み
//
// iPhoneのWebアプリは、ヘルスケアやBluetoothに直接つながれません。
// そこで次の2つの方法で取り込みます。
//  1. ヘルスケアの「書き出し」ファイル（export.zip）を読み込む … 設定不要・過去の記録もまとめて
//  2. 「ショートカット」アプリでコピーした今日の記録を貼り付ける … 毎日かんたん
import * as store from './store.js';
import { S } from './store.js';
import { icon } from './icons.js';
import { openSheet, toast, choice, dateField, val } from './ui.js';
import { notify } from './app.js';
import { today, addDays, fmtNum, fmtDate, fmtDateLong, esc, ymd } from './util.js';

/* ---------- ワークアウトの種類 ---------- */
const HK_TYPES = {
  Running: ['run', ''], Walking: ['walk', ''], Hiking: ['walk', 'ハイキング'], Cycling: ['cycle', ''],
  TraditionalStrengthTraining: ['other', '筋トレ'], FunctionalStrengthTraining: ['other', '筋トレ'],
  HighIntensityIntervalTraining: ['other', 'HIIT'], CoreTraining: ['other', '体幹トレーニング'], CrossTraining: ['other', 'クロストレーニング'],
  Yoga: ['other', 'ヨガ'], Pilates: ['other', 'ピラティス'], Swimming: ['other', '水泳'], Elliptical: ['other', 'エリプティカル'],
  Rowing: ['other', 'ローイング'], StairClimbing: ['other', '階段'], Stairs: ['other', '階段'], Dance: ['other', 'ダンス'],
  SocialDance: ['other', 'ダンス'], CardioDance: ['other', 'ダンス'], Boxing: ['other', 'ボクシング'], Kickboxing: ['other', 'キックボクシング'],
  JumpRope: ['other', 'なわとび'], Cooldown: ['other', 'クールダウン'], MixedCardio: ['other', 'ミックスカーディオ'],
  Flexibility: ['other', 'ストレッチ'], Tennis: ['other', 'テニス'], Soccer: ['other', 'サッカー'], Basketball: ['other', 'バスケットボール'],
  Golf: ['other', 'ゴルフ'], Other: ['other', 'その他'],
};

function mapHKType(hk) {
  const k = String(hk || '').replace('HKWorkoutActivityType', '');
  const m = HK_TYPES[k];
  if (m) return { kind: m[0], label: m[1] };
  return { kind: 'other', label: k || 'ワークアウト' };
}

function mapTextType(s) {
  const t = String(s || '');
  if (/ラン|ジョギング|run/i.test(t)) return { kind: 'run', label: '' };
  if (/ハイキング|hik/i.test(t)) return { kind: 'walk', label: 'ハイキング' };
  if (/ウォーク|ウォーキング|walk|散歩/i.test(t)) return { kind: 'walk', label: '' };
  if (/サイクリング|自転車|バイク|cycl/i.test(t)) return { kind: 'cycle', label: '' };
  if (/筋力|筋トレ|strength|ウエイト/i.test(t)) return { kind: 'other', label: '筋トレ' };
  if (/HIIT|高強度/i.test(t)) return { kind: 'other', label: 'HIIT' };
  for (const [, [kind, label]] of Object.entries(HK_TYPES)) if (label && t.includes(label)) return { kind, label };
  return { kind: 'other', label: 'ワークアウト' };
}

/* ---------- 文字から数値・日付を読み取る ---------- */
function firstNumber(s) {
  const m = String(s || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function looseDate(s, fallback = null) {
  const t = String(s || '');
  let m = t.match(/(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/(\d{1,2})月(\d{1,2})日/);
  if (m) return `${today().slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/今日|today/i.test(t)) return today();
  if (/昨日|yesterday/i.test(t)) return addDays(today(), -1);
  return fallback;
}

function parseWorkoutText(line, date) {
  const { kind, label } = mapTextType(line);
  const s = line.replace(/,/g, '');
  let minutes = null;
  let m = s.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (m) minutes = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
  if (minutes === null) {
    const h = s.match(/(\d+(?:\.\d+)?)\s*時間/); const mi = s.match(/(\d+(?:\.\d+)?)\s*(分|min)/i); const se = s.match(/(\d+(?:\.\d+)?)\s*(秒|sec)/i);
    if (h || mi || se) minutes = (h ? Number(h[1]) * 60 : 0) + (mi ? Number(mi[1]) : 0) + (se ? Number(se[1]) / 60 : 0);
  }
  if (minutes === null) { m = s.match(/(\d{1,2}):(\d{2})(?!:)/); if (m && !/\d{4}/.test(s.slice(0, m.index))) minutes = Number(m[1]) + Number(m[2]) / 60; }
  let km = null;
  m = s.match(/(\d+(?:\.\d+)?)\s*km/i);
  if (m) km = Number(m[1]);
  else { m = s.match(/(\d+(?:\.\d+)?)\s*m(?![a-zi])/); if (m) km = Number(m[1]) / 1000; }
  let kcal = null;
  m = s.match(/(\d+(?:\.\d+)?)\s*(kcal|キロカロリー|Cal)/i);
  if (m) kcal = Number(m[1]);
  const d = looseDate(s, date);
  return { date: d, kind, label, minutes: minutes ? Math.round(minutes) : null, distanceKm: km ? Math.round(km * 100) / 100 : null, kcal: kcal ? Math.round(kcal) : null, key: `sc:${d}|${kind}|${label}|${minutes ? Math.round(minutes) : ''}|${km || ''}` };
}

/**
 * ショートカットでコピーした文字を読み取る
 * 例）EVOLVE / 歩数 8234 / 活動 412 kcal / 体重 67.3 kg / 体脂肪 17.5 % / ワークアウト ランニング 30分 5.0km
 */
export function parseShortcutText(text, date = today()) {
  const out = { daily: [], workouts: [], body: [], source: 'shortcut' };
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let d = date;
  let steps = null; let kcal = null; let weight = null; let fat = null;
  let inWorkout = false;
  for (const line of lines) {
    if (/^EVOLVE/i.test(line)) { inWorkout = false; continue; }
    const key = line.match(/^(日付|歩数|活動|アクティブエネルギー|アクティブ|消費|体重|体脂肪率|体脂肪|ワークアウト)\s*[:：]?\s*(.*)$/);
    if (key) {
      const k = key[1]; const rest = key[2];
      inWorkout = false;
      if (k === '日付') d = looseDate(rest, d);
      else if (k === '歩数') steps = firstNumber(rest);
      else if (/活動|アクティブ|消費/.test(k)) { kcal = firstNumber(rest); if (kcal !== null && /kJ/i.test(rest)) kcal /= 4.184; }
      else if (k === '体重') { weight = firstNumber(rest); if (weight !== null && /lb/i.test(rest)) weight *= 0.45359237; }
      else if (k === '体脂肪') { fat = firstNumber(rest); if (fat !== null && fat > 0 && fat <= 1 && !/%/.test(rest)) fat *= 100; }
      else { inWorkout = true; if (rest && firstNumber(rest) !== null) out.workouts.push(parseWorkoutText(rest, d)); }
      continue;
    }
    if (inWorkout && firstNumber(line) !== null) out.workouts.push(parseWorkoutText(line, d));
  }
  out.workouts = out.workouts.map((w) => ({ ...w, date: w.date || d })).filter((w) => w.minutes || w.distanceKm);
  if (steps !== null || kcal !== null) out.daily.push({ date: d, steps: steps !== null ? Math.round(steps) : null, activeKcal: kcal !== null ? Math.round(kcal) : null });
  if (weight || fat) out.body.push({ date: d, weight: weight ? Math.round(weight * 10) / 10 : null, bodyFat: fat ? Math.round(fat * 10) / 10 : null });
  out.date = d;
  out.recognized = !!(out.daily.length || out.body.length || out.workouts.length);
  return out;
}

/* ---------- ヘルスケアの書き出しファイル（export.zip）を読む ---------- */
async function bytes(file, start, end) { return new Uint8Array(await file.slice(start, end).arrayBuffer()); }
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 4294967296;

/** zipの中から export.xml の場所を探す */
async function findExportXml(file) {
  const tailLen = Math.min(file.size, 65557);
  const tail = await bytes(file, file.size - tailLen, file.size);
  let p = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { p = i; break; }
  }
  if (p < 0) throw new Error('zipファイルとして読み込めませんでした');
  let cdSize = u32(tail, p + 12); let cdOffset = u32(tail, p + 16);
  if (cdOffset === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    const lp = p - 20;
    if (lp >= 0 && u32(tail, lp) === 0x07064b50) {
      const z64off = u64(tail, lp + 8);
      const z = await bytes(file, z64off, z64off + 56);
      cdSize = u64(z, 40); cdOffset = u64(z, 48);
    }
  }
  const cd = await bytes(file, cdOffset, cdOffset + cdSize);
  let o = 0; let found = null;
  while (o + 46 <= cd.length && u32(cd, o) === 0x02014b50) {
    const method = u16(cd, o + 10);
    let comp = u32(cd, o + 20); let uncomp = u32(cd, o + 24);
    const nLen = u16(cd, o + 28); const eLen = u16(cd, o + 30); const cLen = u16(cd, o + 32);
    let local = u32(cd, o + 42);
    const name = new TextDecoder().decode(cd.subarray(o + 46, o + 46 + nLen));
    // zip64 の追加情報
    let e = o + 46 + nLen; const eEnd = e + eLen;
    while (e + 4 <= eEnd) {
      const id = u16(cd, e); const sz = u16(cd, e + 2); let q = e + 4;
      if (id === 0x0001) {
        if (uncomp === 0xFFFFFFFF) { uncomp = u64(cd, q); q += 8; }
        if (comp === 0xFFFFFFFF) { comp = u64(cd, q); q += 8; }
        if (local === 0xFFFFFFFF) { local = u64(cd, q); q += 8; }
      }
      e += 4 + sz;
    }
    if (/(^|\/)export\.xml$/.test(name)) found = { method, comp, uncomp, local };
    o += 46 + nLen + eLen + cLen;
  }
  if (!found) throw new Error('zipの中に export.xml が見つかりませんでした');
  const lh = await bytes(file, found.local, found.local + 30);
  const start = found.local + 30 + u16(lh, 26) + u16(lh, 28);
  return { ...found, start };
}

function attr(line, name) {
  const k = ` ${name}="`;
  const i = line.indexOf(k);
  if (i < 0) return null;
  const s = i + k.length;
  return line.slice(s, line.indexOf('"', s));
}

const toKm = (v, unit) => (unit === 'mi' ? v * 1.609344 : unit === 'm' ? v / 1000 : unit === 'yd' ? v * 0.0009144 : v);
const toKcal = (v, unit) => (unit === 'kJ' ? v / 4.184 : v);
const toMin = (v, unit) => (unit === 's' ? v / 60 : unit === 'hr' || unit === 'h' ? v * 60 : v);

/**
 * ヘルスケアの書き出しファイルを読み込む（大きなファイルでも少しずつ読みます）
 * @param {File} file export.zip または export.xml
 * @param {string|null} since この日付以降だけ取り込む
 */
export async function parseHealthExport(file, { since = null, onProgress = null } = {}) {
  let raw; let total;
  if (/\.xml$/i.test(file.name)) {
    raw = file.stream(); total = file.size;
  } else {
    const ent = await findExportXml(file);
    total = ent.comp;
    raw = file.slice(ent.start, ent.start + ent.comp).stream();
    if (ent.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('このiPhoneでは zip を開けません。「ファイル」アプリでzipをタップして展開し、中の export.xml を選んでください');
      raw = countBytes(raw, total, onProgress).pipeThrough(new DecompressionStream('deflate-raw'));
      onProgress = null;
    } else if (ent.method !== 0) throw new Error('対応していない圧縮形式です');
  }
  if (onProgress) raw = countBytes(raw, total, onProgress);
  const reader = raw.pipeThrough(new TextDecoderStream()).getReader();

  const stepsBy = new Map(); // date -> Map(source -> sum)
  const kcalBy = new Map();
  const weightBy = new Map(); // date -> {t, v}
  const fatBy = new Map();
  const workouts = [];
  let cur = null;
  const add = (map, date, src, v) => {
    if (!map.has(date)) map.set(date, new Map());
    const m = map.get(date); m.set(src, (m.get(src) || 0) + v);
  };
  const finishWorkout = () => {
    const w = cur; cur = null;
    if (!w || !w.start) return;
    const date = w.start.slice(0, 10);
    if (since && date < since) return;
    const { kind, label } = mapHKType(w.type);
    workouts.push({
      date, kind, label,
      minutes: w.duration ? Math.round(toMin(w.duration, w.durUnit)) : null,
      distanceKm: w.dist ? Math.round(toKm(w.dist, w.distUnit) * 100) / 100 : null,
      kcal: w.kcal ? Math.round(toKcal(w.kcal, w.kcalUnit)) : null,
      key: `hk:${w.start}|${w.type}`,
    });
  };
  const handle = (line) => {
    if (line.startsWith('<Record ')) {
      const type = attr(line, 'type');
      if (!type || !type.startsWith('HKQuantityTypeIdentifier')) return;
      const t = type.slice(24);
      if (t !== 'StepCount' && t !== 'ActiveEnergyBurned' && t !== 'BodyMass' && t !== 'BodyFatPercentage') return;
      const start = attr(line, 'startDate') || '';
      const date = start.slice(0, 10);
      if (!date || (since && date < since)) return;
      const v = parseFloat(attr(line, 'value'));
      if (!Number.isFinite(v)) return;
      const unit = attr(line, 'unit');
      const src = attr(line, 'sourceName') || '';
      if (t === 'StepCount') add(stepsBy, date, src, v);
      else if (t === 'ActiveEnergyBurned') add(kcalBy, date, src, toKcal(v, unit));
      else if (t === 'BodyMass') {
        const kg = unit === 'lb' ? v * 0.45359237 : unit === 'g' ? v / 1000 : v;
        const p = weightBy.get(date); if (!p || start >= p.t) weightBy.set(date, { t: start, v: kg });
      } else {
        const pct = unit === '%' && v > 1 ? v : v * 100;
        const p = fatBy.get(date); if (!p || start >= p.t) fatBy.set(date, { t: start, v: pct });
      }
    } else if (line.startsWith('<Workout ')) {
      if (cur) finishWorkout();
      cur = {
        type: attr(line, 'workoutActivityType'), start: attr(line, 'startDate'),
        duration: parseFloat(attr(line, 'duration')), durUnit: attr(line, 'durationUnit') || 'min',
        dist: parseFloat(attr(line, 'totalDistance')) || null, distUnit: attr(line, 'totalDistanceUnit') || 'km',
        kcal: parseFloat(attr(line, 'totalEnergyBurned')) || null, kcalUnit: attr(line, 'totalEnergyBurnedUnit') || 'kcal',
      };
      if (line.endsWith('/>')) finishWorkout();
    } else if (cur && line.startsWith('<WorkoutStatistics ')) {
      const type = attr(line, 'type') || '';
      const sum = parseFloat(attr(line, 'sum'));
      if (!Number.isFinite(sum)) return;
      if (/Distance/.test(type) && !cur.dist) { cur.dist = sum; cur.distUnit = attr(line, 'unit') || 'km'; }
      if (/ActiveEnergyBurned/.test(type) && !cur.kcal) { cur.kcal = sum; cur.kcalUnit = attr(line, 'unit') || 'kcal'; }
    } else if (cur && line.startsWith('</Workout>')) finishWorkout();
  };

  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl;
    let pos = 0;
    while ((nl = buf.indexOf('\n', pos)) >= 0) {
      const line = buf.slice(pos, nl).trimStart();
      pos = nl + 1;
      if (line.charCodeAt(0) === 60 /* < */) handle(line);
    }
    buf = buf.slice(pos);
  }
  if (buf) handle(buf.trimStart());
  if (cur) finishWorkout();

  // 同じ日の歩数・カロリーは、iPhoneとApple Watchで二重に記録されることがあるため、
  // 記録元ごとの合計のうち一番多いものを使います（ヘルスケアの表示に近い値になります）
  const dates = new Set([...stepsBy.keys(), ...kcalBy.keys()]);
  const daily = [...dates].sort().map((date) => ({
    date,
    steps: stepsBy.has(date) ? Math.round(Math.max(...stepsBy.get(date).values())) : null,
    activeKcal: kcalBy.has(date) ? Math.round(Math.max(...kcalBy.get(date).values())) : null,
  }));
  const bodyDates = new Set([...weightBy.keys(), ...fatBy.keys()]);
  const body = [...bodyDates].sort().map((date) => ({
    date,
    weight: weightBy.has(date) ? Math.round(weightBy.get(date).v * 10) / 10 : null,
    bodyFat: fatBy.has(date) ? Math.round(fatBy.get(date).v * 10) / 10 : null,
  }));
  workouts.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { daily, workouts, body, source: 'export', recognized: !!(daily.length || workouts.length || body.length) };
}

function countBytes(stream, total, onProgress) {
  if (!onProgress) return stream;
  let n = 0; let last = 0;
  return stream.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      n += chunk.byteLength;
      const now = performance.now();
      if (now - last > 150) { last = now; onProgress(Math.min(1, n / total)); }
      ctrl.enqueue(chunk);
    },
  }));
}

/* ---------- 取り込みの確認と保存 ---------- */
function analyze(result, force = false) {
  const skip = force ? { cardio: [], body: [], daily: [] } : { cardio: [], body: [], daily: [], ...(S.meta.healthSkip || {}) };
  const near = (c, w) => c.date === w.date && c.kind === w.kind && (c.label || '') === (w.label || '') && Math.abs((Number(c.minutes) || 0) - (Number(w.minutes) || 0)) <= 3;
  const deleted = (w) => skip.cardio.some((x) => x.key === w.key || near(x, w));
  const dailyById = new Map((S.daily || []).map((d) => [d.id, d]));
  // 自分で修正・削除した日の歩数は、取り込みで上書きしない
  // ショートカットの貼り付けは「この日の記録を入れたい」という操作なので、
  // 歩数・体重については、前に修正・削除していても取り込む（ワークアウトは消したものを復活させない）
  const direct = result.source === 'shortcut';
  const newDaily = result.daily.filter((d) => { const ex = dailyById.get(`d-${d.date}`); return direct || (!skip.daily.includes(d.date) && (force || !(ex && ex.edited))); });
  const healthKeys = new Set(S.cardio.filter((c) => c.healthKey).map((c) => c.healthKey));
  const imported = S.cardio.filter((c) => c.source === 'health');
  // 書き出しファイルとショートカットの両方で同じワークアウトが届いても二重にしない
  const similar = (w) => imported.some((c) => c.date === w.date && c.kind === w.kind && (c.label || '') === (w.label || '')
    && Math.abs((Number(c.minutes) || 0) - (Number(w.minutes) || 0)) <= 3);
  const seen = new Set();
  const newWorkouts = result.workouts.filter((w) => {
    if (healthKeys.has(w.key) || seen.has(w.key) || similar(w) || deleted(w)) return false;
    seen.add(w.key);
    return true;
  });
  const bodyByDate = new Map(S.body.map((b) => [b.date, b]));
  const newBody = result.body.filter((b) => { const ex = bodyByDate.get(b.date); if (direct) return !ex || ex.source === 'health'; // 手入力の体重は守る
    return !skip.body.includes(b.date) && (!ex || (ex.source === 'health' && (force || !ex.edited))); });
  return { newDaily, newWorkouts, newBody, skippedDaily: result.daily.length - newDaily.length, skippedBody: result.body.length - newBody.length, skippedWorkouts: result.workouts.length - newWorkouts.length };
}

async function commit(result, opts) {
  const a = analyze(result, opts.force);
  let nDaily = 0; let nW = 0; let nB = 0;
  if (opts.force) await store.setMeta({ healthSkip: { cardio: [], body: [], daily: [] } });
  const direct = result.source === 'shortcut';
  if (direct && !opts.force) {
    // 貼り付けた日の「消した印」を外す
    const sk = { cardio: [], body: [], daily: [], ...(S.meta.healthSkip || {}) };
    const dd = new Set(opts.daily ? a.newDaily.map((d) => d.date) : []);
    const bd = new Set(opts.body ? a.newBody.map((b) => b.date) : []);
    await store.setMeta({ healthSkip: { ...sk, daily: sk.daily.filter((d) => !dd.has(d)), body: sk.body.filter((d) => !bd.has(d)) } });
  }
  if (opts.daily && a.newDaily.length) {
    const byId = new Map(S.daily.map((d) => [d.id, d]));
    const recs = a.newDaily.map((d) => {
      const id = `d-${d.date}`;
      const ex = opts.force ? null : byId.get(id);
      return {
        ...(ex || {}), id, date: d.date, source: 'health', edited: false,
        // 貼り付けのときは新しい値でそのまま置きかえる（書き出しファイルのときは大きいほうを残す）
        steps: (direct ? (d.steps ?? (ex && ex.steps)) : Math.max(Number(ex && ex.steps) || 0, Number(d.steps) || 0)) || null,
        activeKcal: (direct ? (d.activeKcal ?? (ex && ex.activeKcal)) : Math.max(Number(ex && ex.activeKcal) || 0, Number(d.activeKcal) || 0)) || null,
      };
    });
    await store.bulkSave('daily', recs);
    nDaily = recs.length;
  }
  if (opts.force && opts.workouts) {
    // 修正したワークアウトを、ヘルスケアの内容にもどす
    const byKey = new Map(result.workouts.map((w) => [w.key, w]));
    const back = S.cardio.filter((c) => c.edited && c.healthKey && byKey.has(c.healthKey)).map((c) => {
      const w = byKey.get(c.healthKey);
      return { ...c, date: w.date, kind: w.kind, label: w.label || null, minutes: w.minutes || null, distanceKm: w.distanceKm || null, kcal: w.kcal || null, edited: false };
    });
    await store.bulkSave('cardio', back);
    nW += back.length;
  }
  if (opts.workouts && a.newWorkouts.length) {
    await store.bulkSave('cardio', a.newWorkouts.map((w) => ({
      date: w.date, kind: w.kind, label: w.label || null, minutes: w.minutes || null, distanceKm: w.distanceKm || null,
      kcal: w.kcal || null, source: 'health', healthKey: w.key,
    })));
    nW += a.newWorkouts.length;
  }
  if (opts.body && a.newBody.length) {
    const byDate = new Map(S.body.map((b) => [b.date, b]));
    await store.bulkSave('body', a.newBody.map((b) => {
      const ex = byDate.get(b.date);
      return { ...(ex || {}), date: b.date, weight: b.weight ?? (ex && ex.weight) ?? null, bodyFat: b.bodyFat ?? (ex && ex.bodyFat) ?? null, muscle: (ex && ex.muscle) || null, waist: (ex && ex.waist) || null, source: 'health', edited: false, note: 'ヘルスケアから' };
    }));
    nB = a.newBody.length;
  }
  await store.setMeta({ lastHealthImport: Date.now() });
  const parts = [];
  if (nDaily) parts.push(`歩数・カロリー${nDaily}日分`);
  if (nW) parts.push(`ワークアウト${nW}件`);
  if (nB) parts.push(`体重${nB}日分`);
  await notify({ message: parts.length ? `${parts.join('・')}を取り込みました` : '新しく取り込む記録はありませんでした' });
}

function previewHTML(result, label) {
  const a = analyze(result);
  const lastDaily = result.daily[result.daily.length - 1];
  const lastBody = result.body[result.body.length - 1];
  const row = (key, ic, color, title, sub, count, on = true) => `
    <label class="imp-row ${count ? '' : 'none'}">
      <span class="ic-sq" style="--sq:${color}">${icon(ic, 17)}</span>
      <span class="imp-text"><strong>${title}</strong><small>${sub}</small></span>
      <input type="checkbox" name="${key}" ${count && on ? 'checked' : ''} ${count ? '' : 'disabled'}>
      <span class="imp-check">${icon('check', 14)}</span>
    </label>`;
  const wSample = a.newWorkouts.slice(-3).reverse().map((w) => `${fmtDate(w.date, { weekday: false })} ${w.label || { run: 'ランニング', walk: 'ウォーキング', cycle: 'サイクリング' }[w.kind] || 'ワークアウト'}${w.minutes ? ` ${w.minutes}分` : ''}${w.distanceKm ? ` ${w.distanceKm}km` : ''}`).join(' / ');
  return `
    <p class="imp-label">${label}</p>
    <div class="group imp-group">
      ${row('daily', 'walk', '#3B7FA8', `歩数・アクティブカロリー <b>${a.newDaily.length}日分</b>${a.skippedDaily ? `<em>（修正・削除した ${a.skippedDaily}日は変更しません）</em>` : ''}`, lastDaily ? `${fmtDate(lastDaily.date, { weekday: false })}：${lastDaily.steps !== null ? fmtNum(lastDaily.steps) + '歩' : ''}${lastDaily.activeKcal !== null ? ` ・ ${fmtNum(lastDaily.activeKcal)}kcal` : ''}` : '見つかりませんでした', a.newDaily.length)}
      ${row('workouts', 'run', '#1F8070', `ワークアウト <b>${a.newWorkouts.length}件</b>${a.skippedWorkouts ? `<em>（取り込み済み ${a.skippedWorkouts}件）</em>` : ''}`, wSample || (result.workouts.length ? 'すべて取り込み済みです' : '見つかりませんでした'), a.newWorkouts.length)}
      ${row('body', 'scale', '#6E9A63', `体重・体脂肪率 <b>${a.newBody.length}日分</b>${a.skippedBody ? `<em>（手入力・修正した ${a.skippedBody}日は変更しません）</em>` : ''}`, lastBody ? `${fmtDate(lastBody.date, { weekday: false })}：${lastBody.weight ? lastBody.weight.toFixed(1) + 'kg' : ''}${lastBody.bodyFat ? ` ・ ${lastBody.bodyFat.toFixed(1)}%` : ''}` : '見つかりませんでした（チョコザップの体重はヘルスケアに入っていない可能性があります）', a.newBody.length)}
    </div>
    ${result.source === 'shortcut' ? '' : '<label class="imp-force"><input type="checkbox" name="force"><span>自分で修正・削除した記録も、ヘルスケアの内容で取り込み直す</span></label>'}
    <p class="hint">同じ記録を何度取り込んでも、二重にはなりません。${result.source === 'shortcut' ? '貼り付けた日の歩数・カロリー・体重は、この内容で置きかわります。' : '自分で直した記録や消した記録は、そのまま残します。'}歩数は1000歩ごとに2XP（1日最大20XP）になります。</p>
    <button type="button" class="btn btn-primary btn-block btn-lg" data-commit ${result.recognized ? '' : 'disabled'}>${icon('download', 18)}取り込む</button>`;
}

/** 取り込み画面 */
export function openHealthImport() {
  const start = (S.profile && S.profile.startDate) || addDays(today(), -30);
  let parsed = null;
  openSheet({
    title: 'ヘルスケアから取り込む',
    subtitle: 'Apple Watch・体重計アプリの記録',
    html: `
      <div class="imp-step" data-step="choose">
        <div class="imp-card">
          <div class="imp-card-h"><span class="ic-sq" style="--sq:#D2493E">${icon('heart', 17)}</span><div><strong>まとめて取り込む</strong><small>ヘルスケアの「書き出し」ファイルから（設定不要・過去の分も）</small></div></div>
          <div class="field"><span class="field-label">取り込む期間</span>${choice('since', [{ value: start, label: 'EVOLVEを始めてから' }, { value: addDays(today(), -90), label: '直近90日' }, { value: '', label: 'すべて' }], start)}</div>
          <label class="btn btn-primary btn-block file-btn">${icon('upload', 18)}書き出しファイルを選ぶ<input type="file" name="exportFile" accept=".zip,.xml,application/zip,text/xml"></label>
          <button type="button" class="text-btn" data-guide="export">${icon('info', 14)}書き出しファイルの作り方</button>
        </div>
        <div class="imp-card">
          <div class="imp-card-h"><span class="ic-sq" style="--sq:#5B6B78">${icon('bolt', 17)}</span><div><strong>今日の分をすばやく</strong><small>「ショートカット」アプリでコピーした記録を貼り付け</small></div></div>
          <button type="button" class="btn btn-soft btn-block" data-paste>${icon('download', 18)}コピーした記録を貼り付け</button>
          <textarea class="input imp-text-in" name="pasteText" rows="4" placeholder="うまく貼り付けられないときは、ここを長押しして「ペースト」してください"></textarea>
          <button type="button" class="text-btn" data-guide="shortcut">${icon('info', 14)}ショートカットの作り方</button>
        </div>
      </div>
      <div class="imp-step" data-step="progress" hidden>
        <div class="imp-progress"><div class="imp-bar"><i data-bar></i></div><p data-ptext>読み込んでいます…</p><small>データが多いと1〜2分かかることがあります。画面を閉じずにお待ちください。</small></div>
      </div>
      <div class="imp-step" data-step="preview" hidden></div>`,
    onMount(body, close) {
      const show = (step) => body.querySelectorAll('[data-step]').forEach((el) => { el.hidden = el.dataset.step !== step; });
      const toPreview = (result, label) => {
        parsed = result;
        const pv = body.querySelector('[data-step="preview"]');
        pv.innerHTML = previewHTML(result, label) + (result.source === 'shortcut' ? `<div class="field imp-date"><span class="field-label">この記録の日付</span>${dateField('impDate', result.date || today())}</div>` : '') + '<button type="button" class="text-btn" data-back>戻る</button>';
        show('preview');
        if (!result.recognized) toast('記録を読み取れませんでした。ショートカットの作り方を確認してください', { icon: 'info', duration: 4000 });
      };
      const fromText = (text) => {
        if (!text || !text.trim()) { toast('貼り付ける記録がありません', { icon: 'info' }); return; }
        body.querySelector('[name=pasteText]').value = text;
        toPreview(parseShortcutText(text), 'ショートカットの記録');
      };
      body.addEventListener('click', async (e) => {
        if (e.target.closest('[data-paste]')) {
          const typed = body.querySelector('[name=pasteText]').value;
          if (typed.trim()) { fromText(typed); return; }
          try { fromText(await navigator.clipboard.readText()); } catch { toast('下の欄を長押しして「ペースト」してください', { icon: 'info', duration: 3500 }); body.querySelector('[name=pasteText]').focus(); }
          return;
        }
        const g = e.target.closest('[data-guide]');
        if (g) { openHealthGuide(g.dataset.guide); return; }
        if (e.target.closest('[data-back]')) { show('choose'); return; }
        if (e.target.closest('[data-commit]') && parsed) {
          const opts = {
            daily: !!body.querySelector('[name=daily]:checked'),
            workouts: !!body.querySelector('[name=workouts]:checked'),
            body: !!body.querySelector('[name=body]:checked'),
            force: !!body.querySelector('[name=force]:checked'),
          };
          // 取り込み直すときは、すべての種類を対象にする
          if (opts.force) { opts.daily = true; opts.workouts = true; opts.body = true; }
          if (parsed.source === 'shortcut') {
            const d = val(body, 'impDate') || parsed.date;
            if (d !== parsed.date) parsed = parseShortcutText(body.querySelector('[name=pasteText]').value, d);
          }
          e.target.closest('[data-commit]').disabled = true;
          close();
          await commit(parsed, opts);
        }
      });
      body.addEventListener('change', async (e) => {
        if (e.target.name !== 'exportFile') return;
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;
        const since = val(body, 'since') || null;
        show('progress');
        const bar = body.querySelector('[data-bar]');
        const ptext = body.querySelector('[data-ptext]');
        try {
          const result = await parseHealthExport(file, {
            since,
            onProgress: (p) => { bar.style.width = `${(p * 100).toFixed(0)}%`; ptext.textContent = `読み込んでいます… ${(p * 100).toFixed(0)}%`; },
          });
          toPreview(result, `${since ? `${fmtDateLong(since)}から` : 'すべての期間'}の記録`);
        } catch (err) {
          console.error(err);
          show('choose');
          toast(esc(err.message || '読み込めませんでした'), { icon: 'info', duration: 5000 });
        }
      });
    },
  });
}

/** 使い方の説明 */
export function openHealthGuide(kind = 'export') {
  const exportHTML = `
    <h3 class="mini-h">書き出しファイルの作り方（おすすめ・設定不要）</h3>
    <ol class="steps">
      <li>iPhoneの <b>「ヘルスケア」</b> アプリを開きます</li>
      <li>右上の <b>丸い人のアイコン</b>（自分のアイコン）をタップ</li>
      <li>いちばん下の <b>「すべてのヘルスケアデータを書き出す」</b> → <b>「書き出す」</b> をタップ</li>
      <li>数分待つと共有メニューが出るので、<b>「"ファイル"に保存」</b> → 保存場所を選んで <b>「保存」</b></li>
      <li>EVOLVEに戻り、<b>「書き出しファイルを選ぶ」</b> から、保存した <b>「書き出したデータ.zip」</b>（export.zip）を選びます</li>
    </ol>
    <p class="fine">データが多いと書き出しに数分かかります。週に1回くらいまとめて取り込むのがおすすめです。zipが選べない・読み込めないときは、「ファイル」アプリでzipをタップして展開し、中の <b>export.xml</b> を選んでください。</p>`;
  const shortcutHTML = `
    <h3 class="mini-h">ショートカットの作り方（最初に1回だけ）</h3>
    <p class="hint top">「ショートカット」アプリで、今日の記録をコピーするボタンを作ります。表示の名前はiOSのバージョンで少し違うことがあります。</p>
    <ol class="steps">
      <li><b>「ショートカット」</b> アプリを開き、右上の <b>「＋」</b> をタップ</li>
      <li>「アクションを検索」で <b>「ヘルスケアのサンプルを検索」</b> を追加し、次のように設定します
        <ul class="sub-steps"><li>種類：<b>歩数</b></li><li>条件を追加：<b>開始日</b> が <b>今日</b></li><li>グループ化：<b>日</b>（あれば）</li></ul></li>
      <li>次に <b>「変数を設定」</b> を追加し、名前を <b>歩数</b> にします</li>
      <li>同じように「ヘルスケアのサンプルを検索」→「変数を設定」を、あと4セット作ります
        <ul class="sub-steps">
          <li>種類 <b>アクティブエネルギー</b>（開始日が今日・グループ化：日）→ 変数名 <b>活動</b></li>
          <li>種類 <b>体重</b>（並び順：新しい順・制限：1）→ 変数名 <b>体重</b></li>
          <li>種類 <b>体脂肪率</b>（並び順：新しい順・制限：1）→ 変数名 <b>体脂肪</b></li>
          <li>種類 <b>ワークアウト</b>（開始日が今日）→ 変数名 <b>ワークアウト</b>（選べないときは省略してOK）</li>
        </ul></li>
      <li><b>「テキスト」</b> を追加し、下のように書きます。［ ］の部分は、キーボードの上に出る変数（さっき付けた名前）をタップして入れます
        <pre class="code-box">EVOLVE
歩数 ［歩数］
活動 ［活動］
体重 ［体重］
体脂肪 ［体脂肪］
ワークアウト ［ワークアウト］</pre></li>
      <li><b>「クリップボードにコピー」</b> を追加します</li>
      <li>上の名前を <b>「EVOLVEに送る」</b> にして、完了をタップ</li>
    </ol>
    <h3 class="mini-h">毎日の使い方</h3>
    <ol class="steps">
      <li>ショートカットの <b>「EVOLVEに送る」</b> をタップ（初回は「許可」をタップ）</li>
      <li>EVOLVEを開いて ＋ボタン →「ヘルスケア」→ <b>「コピーした記録を貼り付け」</b></li>
      <li>内容を確認して <b>「取り込む」</b></li>
    </ol>
    <p class="fine">ショートカットをホーム画面に追加しておくと、もっと手軽です。ワークアウトがうまく読み取れないときは、書き出しファイルからの取り込みを使ってください。</p>`;
  const chocoHTML = `
    <h3 class="mini-h">チョコザップの体重計について</h3>
    <p class="hint top">チョコザップアプリの体重がヘルスケアに入っていれば、いっしょに取り込めます。確かめ方：「ヘルスケア」アプリ →「ブラウズ」→「身体測定」→「体重」を開き、チョコザップの記録が表示されるか見てください。入っていない場合は、チョコザップアプリの設定に「ヘルスケア」との連携がないか確認してください。連携できないときは、これまでどおり EVOLVE の「身体測定」で入力してください。</p>`;
  openSheet({
    title: kind === 'shortcut' ? 'ショートカットの作り方' : '書き出しファイルの作り方',
    html: `<div class="guide">${kind === 'shortcut' ? shortcutHTML : exportHTML}${chocoHTML}</div>`,
  });
}

export { ymd };
