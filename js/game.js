// 経験値・レベル・ステータス・実績の計算
// 経験値は「記録」から毎回自動で計算します。
// 記録を編集・削除しても数値が正しく保たれ、同じ記録を何度も登録しても
// 1日あたりの上限があるため不自然に稼げない仕組みです。
import { S } from './store.js';
import { weekStart, today, addDays, diffDays, groupBy } from './util.js';

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

export const XP_RULES = [
  { label: '筋トレ', detail: '1日20XP＋種目数×5XP（6種目まで）＋回数に応じて最大30XP。1日最大80XP' },
  { label: 'ランニング', detail: '1回15XP＋1kmごとに6XP（距離がなければ1分0.8XP）' },
  { label: 'ウォーキング', detail: '1回5XP＋1分ごとに0.4XP' },
  { label: 'サイクリング・その他', detail: '1回8XP＋1分ごとに0.5XP' },
  { label: '有酸素運動の上限', detail: '1日最大90XP' },
  { label: '歩数（Apple Watch）', detail: '1000歩ごとに2XP（1日最大20XP）' },
  { label: '食事記録', detail: '朝・昼・夕・間食それぞれ5XP（1日最大20XP）、プロテイン記録3XP' },
  { label: 'タンパク質目標達成', detail: 'ボーナス20XP' },
  { label: '身体測定', detail: '1日15XP' },
  { label: '写真記録', detail: '1日10XP' },
  { label: '週ボーナス', detail: '1週間（月〜日）に3日運動で50XP、5日運動でさらに30XP' },
  { label: '実績', detail: '実績を達成するとボーナスXP' },
];

export const TITLES = [
  [1, 'ビギナー'], [3, 'ルーキー'], [6, 'チャレンジャー'], [10, 'アスリート'],
  [15, 'エキスパート'], [20, 'エリート'], [30, 'マスター'], [40, 'レジェンド'], [50, 'エボルバー'],
];

export const STAGES = [
  { from: 1, name: 'STAGE 1', label: '芽生え' },
  { from: 5, name: 'STAGE 2', label: '成長' },
  { from: 10, name: 'STAGE 3', label: '躍進' },
  { from: 20, name: 'STAGE 4', label: '覚醒' },
  { from: 35, name: 'STAGE 5', label: '進化' },
];

export const STAT_DEFS = [
  { id: 'str', name: '筋力', en: 'STRENGTH', color: '#22806F', desc: '筋トレの積み重ねで成長' },
  { id: 'end', name: '持久力', en: 'ENDURANCE', color: '#3B7FA8', desc: 'ランニング・ウォーキングなどで成長' },
  { id: 'con', name: '継続力', en: 'CONSISTENCY', color: '#B8914A', desc: '記録した日数や週の継続で成長' },
  { id: 'cnd', name: 'コンディション', en: 'CONDITION', color: '#6E9A63', desc: '食事・タンパク質・測定・休養で成長' },
];

export const ACHIEVEMENTS = [
  { id: 'first_workout', name: '初めてのトレーニング', desc: '筋トレを1回記録', xp: 30, icon: 'dumbbell', test: (c) => c.strengthDays >= 1 },
  { id: 'first_run', name: '初めてのランニング', desc: 'ランニングを1回記録', xp: 30, icon: 'run', test: (c) => c.runCount >= 1 },
  { id: 'first_walk', name: '最初の一歩', desc: 'ウォーキングを1回記録', xp: 20, icon: 'walk', test: (c) => c.walkCount >= 1 },
  { id: 'first_meal', name: 'いただきます', desc: '食事を1回記録', xp: 20, icon: 'meal', test: (c) => c.mealCount >= 1 },
  { id: 'first_body', name: '現在地を知る', desc: '身体測定を1回記録', xp: 20, icon: 'scale', test: (c) => c.bodyCount >= 1 },
  { id: 'first_photo', name: 'ビフォーの1枚', desc: '写真を1枚記録', xp: 20, icon: 'camera', test: (c) => c.photoDays >= 1 },
  { id: 'protein_goal', name: 'タンパク質マスター見習い', desc: 'タンパク質の目標を達成', xp: 30, icon: 'leaf', test: (c) => c.proteinGoalDays >= 1 },
  { id: 'protein_7', name: '栄養を味方に', desc: 'タンパク質の目標を累計7日達成', xp: 60, icon: 'leaf', test: (c) => c.proteinGoalDays >= 7 },
  { id: 'streak3', name: '3日継続', desc: '3日連続で記録', xp: 40, icon: 'flame', test: (c) => c.bestStreak >= 3 },
  { id: 'streak7', name: '7日継続', desc: '7日連続で記録', xp: 80, icon: 'flame', test: (c) => c.bestStreak >= 7 },
  { id: 'streak14', name: '14日継続', desc: '14日連続で記録', xp: 120, icon: 'flame', test: (c) => c.bestStreak >= 14 },
  { id: 'week3', name: '週3の習慣', desc: '1週間に3日運動', xp: 50, icon: 'calendar', test: (c) => c.weekBonusCount >= 1 },
  { id: 'month1', name: '1か月継続', desc: '4週連続で運動', xp: 150, icon: 'calendar', test: (c) => c.bestWeekRun >= 4 },
  { id: 'ex10', name: '累計10回の運動', desc: '運動を合計10回記録', xp: 50, icon: 'bolt', test: (c) => c.sessions >= 10 },
  { id: 'ex50', name: '累計50回の運動', desc: '運動を合計50回記録', xp: 120, icon: 'bolt', test: (c) => c.sessions >= 50 },
  { id: 'ex100', name: '累計100回の運動', desc: '運動を合計100回記録', xp: 250, icon: 'bolt', test: (c) => c.sessions >= 100 },
  { id: 'body10', name: '体重記録10回', desc: '身体測定を10日記録', xp: 60, icon: 'scale', test: (c) => c.bodyCount >= 10 },
  { id: 'body30', name: '体重記録30回', desc: '身体測定を30日記録', xp: 120, icon: 'scale', test: (c) => c.bodyCount >= 30 },
  { id: 'reps1000', name: '1000レップ', desc: '筋トレの回数が累計1000回', xp: 80, icon: 'dumbbell', test: (c) => c.totalReps >= 1000 },
  { id: 'reps10000', name: '10000レップ', desc: '筋トレの回数が累計10000回', xp: 200, icon: 'dumbbell', test: (c) => c.totalReps >= 10000 },
  { id: 'km10', name: '累計10km', desc: 'ラン・ウォークの距離が累計10km', xp: 50, icon: 'route', test: (c) => c.totalKm >= 10 },
  { id: 'km100', name: '累計100km', desc: 'ラン・ウォークの距離が累計100km', xp: 200, icon: 'route', test: (c) => c.totalKm >= 100 },
  { id: 'health_link', name: 'つながる記録', desc: 'ヘルスケアから記録を取り込む', xp: 20, icon: 'heart', test: (c) => c.healthLinked },
  { id: 'steps10k', name: '1日1万歩', desc: '1日で10000歩あるく', xp: 50, icon: 'walk', test: (c) => c.maxSteps >= 10000 },
  { id: 'steps500k', name: '累計50万歩', desc: '歩数が累計500000歩', xp: 150, icon: 'route', test: (c) => c.totalSteps >= 500000 },
  { id: 'pb', name: '自己ベスト更新', desc: '筋トレで自己ベストを更新', xp: 30, icon: 'star', test: (c) => c.pbCount >= 1 },
  { id: 'lv5', name: 'Lv5 到達', desc: 'レベル5になる', xp: 0, icon: 'crown', test: (c) => c.level >= 5 },
  { id: 'lv10', name: 'Lv10 到達', desc: 'レベル10になる', xp: 0, icon: 'crown', test: (c) => c.level >= 10 },
  { id: 'lv20', name: 'Lv20 到達', desc: 'レベル20になる', xp: 0, icon: 'crown', test: (c) => c.level >= 20 },
];

export function xpForLevel(L) { return Math.floor(50 * Math.pow(L, 1.6) + 50); }

export function levelFromXP(xp) {
  let L = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (rest >= xpForLevel(L) && L < 999) { rest -= xpForLevel(L); L++; }
  return { level: L, into: rest, next: xpForLevel(L), toNext: xpForLevel(L) - rest };
}

export function titleFor(level) {
  let t = TITLES[0][1];
  for (const [lv, name] of TITLES) if (level >= lv) t = name;
  return t;
}

export function stageFor(level) {
  let s = STAGES[0]; let idx = 0;
  STAGES.forEach((st, i) => { if (level >= st.from) { s = st; idx = i; } });
  return { ...s, index: idx + 1 };
}

export function statValue(pts) { return 10 + Math.floor(2 * Math.sqrt(Math.max(0, pts))); }

export function rankFor(v) {
  if (v >= 220) return 'S';
  if (v >= 150) return 'A';
  if (v >= 100) return 'B';
  if (v >= 60) return 'C';
  if (v >= 30) return 'D';
  return 'E';
}

function strengthXP(ws) {
  if (!ws.length) return 0;
  const distinct = new Set(ws.map((w) => w.exerciseId || w.exerciseName)).size;
  let vol = 0;
  for (const w of ws) vol += (w.unit === 'sec' ? (w.reps || 0) / 3 : (w.reps || 0)) * (w.sets || 1);
  return Math.min(80, 20 + 5 * Math.min(distinct, 6) + Math.min(30, Math.floor(vol / 10)));
}

function cardioEntryXP(c) {
  const min = Number(c.minutes) || 0;
  const km = Number(c.distanceKm) || 0;
  if (!min && !km) return 0;
  switch (c.kind) {
    case 'run': return 15 + (km ? km * 6 : min * 0.8);
    case 'walk': return 5 + (min ? min * 0.4 : km * 5);
    case 'cycle': return 8 + (min ? min * 0.5 : km * 1.5);
    default: return 8 + (min ? min * 0.5 : km * 2);
  }
}

/** 1日ぶんの記録をまとめる */
function buildDays(data, asOf) {
  const days = new Map();
  const get = (d) => {
    if (!days.has(d)) days.set(d, { date: d, w: [], c: [], m: [], body: false, photo: false, steps: 0, activeKcal: 0 });
    return days.get(d);
  };
  const ok = (r) => r.date && (!asOf || r.date <= asOf);
  for (const w of data.workouts) if (ok(w)) get(w.date).w.push(w);
  for (const c of data.cardio) if (ok(c)) get(c.date).c.push(c);
  for (const m of data.meals) if (ok(m)) get(m.date).m.push(m);
  for (const b of data.body) if (ok(b)) get(b.date).body = true;
  for (const p of data.photos) if (ok(p)) get(p.date).photo = true;
  for (const x of (data.daily || [])) if (ok(x)) { const d = get(x.date); d.steps = Number(x.steps) || 0; d.activeKcal = Number(x.activeKcal) || 0; }
  return days;
}

export function proteinOf(meals) {
  let food = 0; let shake = 0; let kcal = 0;
  for (const m of meals) {
    if (m.slot === 'protein') shake += Number(m.protein) || 0;
    else food += Number(m.protein) || 0;
    kcal += Number(m.kcal) || 0;
  }
  return { food, shake, total: food + shake, kcal };
}

/** 1日の経験値の内訳 */
export function dayXP(day, proteinGoal) {
  const str = strengthXP(day.w);
  const car = Math.min(90, Math.round(day.c.reduce((t, c) => t + cardioEntryXP(c), 0)));
  const slots = new Set(day.m.filter((m) => MEAL_SLOTS.includes(m.slot)).map((m) => m.slot)).size;
  const hasShake = day.m.some((m) => m.slot === 'protein');
  const meal = slots * 5 + (hasShake ? 3 : 0);
  const p = proteinOf(day.m);
  const proteinBonus = day.m.length && proteinGoal && p.total >= proteinGoal ? 20 : 0;
  const body = day.body ? 15 : 0;
  const photo = day.photo ? 10 : 0;
  // 歩数：1000歩ごとに2XP（1日最大20XP）
  const steps = Math.min(20, Math.floor((day.steps || 0) / 1000) * 2);
  return {
    str, car, meal, proteinBonus, body, photo, steps,
    total: str + car + meal + proteinBonus + body + photo + steps,
    exercised: day.w.length > 0 || day.c.length > 0,
    active: day.w.length > 0 || day.c.length > 0 || day.m.length > 0 || day.body || day.photo || (day.steps || 0) >= 1000,
    proteinMet: proteinBonus > 0,
  };
}

/** 自己ベストの検出 */
export function personalBests(workouts) {
  const events = [];
  const best = new Map();
  const sorted = [...workouts].sort((a, b) => (a.date === b.date ? (a.createdAt || 0) - (b.createdAt || 0) : (a.date < b.date ? -1 : 1)));
  for (const w of sorted) {
    const key = w.exerciseId || w.exerciseName;
    const prev = best.get(key) || { reps: 0, weight: 0, count: 0 };
    if (prev.count > 0 && (w.reps || 0) > prev.reps) {
      events.push({ date: w.date, name: w.exerciseName, value: w.reps, unit: w.unit, kind: 'reps' });
    } else if (prev.count > 0 && w.weight && w.weight > prev.weight) {
      events.push({ date: w.date, name: w.exerciseName, value: w.weight, unit: 'kg', kind: 'weight' });
    }
    best.set(key, {
      reps: Math.max(prev.reps, w.reps || 0),
      weight: Math.max(prev.weight, w.weight || 0),
      count: prev.count + 1,
    });
  }
  return { events, best };
}

/**
 * ゲームの状態をすべて計算する
 * @param {object} opts.asOf  この日付までの記録で計算（週の伸びの比較用）
 */
export function computeGame(opts = {}) {
  const data = S;
  const asOf = opts.asOf || null;
  const goal = (data.profile && data.profile.proteinGoal) || 100;
  const days = buildDays(data, asOf);
  const dates = [...days.keys()].sort();

  const dayInfo = new Map();
  let recordXP = 0;
  const pts = { str: 0, end: 0, con: 0, cnd: 0 };
  let activeDays = 0; let proteinGoalDays = 0; let strengthDays = 0;
  const exerciseDates = [];
  const activeSet = new Set();

  for (const d of dates) {
    const info = dayXP(days.get(d), goal);
    dayInfo.set(d, info);
    recordXP += info.total;
    pts.str += info.str;
    pts.end += info.car + info.steps;
    pts.cnd += info.meal + info.proteinBonus + info.body + info.photo;
    if (info.active) { activeDays++; activeSet.add(d); }
    if (info.proteinMet) proteinGoalDays++;
    if (days.get(d).w.length) strengthDays++;
    if (info.exercised) exerciseDates.push(d);
  }

  // 休養もコンディションの一部：運動した翌日・翌々日の休みはプラス
  const exSet = new Set(exerciseDates);
  for (const d of exerciseDates) {
    for (const n of [1, 2]) {
      const r = addDays(d, n);
      if (!exSet.has(r) && (!asOf || r <= asOf) && r <= today()) { pts.cnd += 3; break; }
    }
  }

  // 週ボーナス
  const weeks = groupBy(exerciseDates, weekStart);
  let weekBonusXP = 0; let weekBonusCount = 0;
  const weekBonusEvents = [];
  for (const [, ds] of weeks) {
    const sortedDs = [...ds].sort();
    if (sortedDs.length >= 3) { weekBonusXP += 50; weekBonusCount++; weekBonusEvents.push({ date: sortedDs[2], xp: 50 }); }
    if (sortedDs.length >= 5) { weekBonusXP += 30; weekBonusEvents.push({ date: sortedDs[4], xp: 30 }); }
  }
  pts.con = activeDays * 12 + weekBonusCount * 25;

  // 連続記録（途切れてもペナルティはなし）
  let bestStreak = 0; let run = 0; let prev = null;
  for (const d of [...activeSet].sort()) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = d;
  }
  const ref = asOf || today();
  let currentStreak = 0;
  let cur = activeSet.has(ref) ? ref : addDays(ref, -1);
  while (activeSet.has(cur)) { currentStreak++; cur = addDays(cur, -1); }

  // 連続して運動した週
  const weekKeys = [...weeks.keys()].sort();
  let bestWeekRun = 0; let wr = 0; let pw = null;
  for (const w of weekKeys) {
    wr = pw && diffDays(w, pw) === 7 ? wr + 1 : 1;
    bestWeekRun = Math.max(bestWeekRun, wr);
    pw = w;
  }

  const filt = (arr) => arr.filter((r) => !asOf || r.date <= asOf);
  const workouts = filt(data.workouts);
  const cardio = filt(data.cardio);
  const pbs = personalBests(workouts);
  const ctxBase = {
    strengthDays,
    runCount: cardio.filter((c) => c.kind === 'run').length,
    walkCount: cardio.filter((c) => c.kind === 'walk').length,
    mealCount: filt(data.meals).length,
    bodyCount: new Set(filt(data.body).map((b) => b.date)).size,
    photoDays: new Set(filt(data.photos).map((p) => p.date)).size,
    proteinGoalDays,
    bestStreak,
    weekBonusCount,
    bestWeekRun,
    sessions: strengthDays + cardio.length,
    totalReps: workouts.filter((w) => w.unit !== 'sec').reduce((t, w) => t + (w.reps || 0) * (w.sets || 1), 0),
    totalKm: cardio.filter((c) => c.kind === 'run' || c.kind === 'walk').reduce((t, c) => t + (Number(c.distanceKm) || 0), 0),
    pbCount: pbs.events.length,
    healthLinked: (data.daily || []).some((x) => !asOf || x.date <= asOf) || cardio.some((c) => c.source === 'health'),
    maxSteps: Math.max(0, ...(data.daily || []).filter((x) => !asOf || x.date <= asOf).map((x) => Number(x.steps) || 0)),
    totalSteps: (data.daily || []).filter((x) => !asOf || x.date <= asOf).reduce((t, x) => t + (Number(x.steps) || 0), 0),
  };

  // 実績（一度達成した実績は消えません）
  const unlocked = { ...data.achievements };
  const newly = [];
  const achXP = () => ACHIEVEMENTS.reduce((t, a) => t + (unlocked[a.id] ? a.xp : 0), 0);
  let totalXP = recordXP + weekBonusXP + achXP();
  const unlockDate = asOf || today();
  if (!asOf || opts.withAchievements) {
    for (let pass = 0; pass < 3; pass++) {
      const ctx = { ...ctxBase, level: levelFromXP(totalXP).level };
      let changed = false;
      for (const a of ACHIEVEMENTS) {
        if (!unlocked[a.id] && a.test(ctx)) {
          unlocked[a.id] = unlockDate;
          newly.push(a);
          changed = true;
        }
      }
      totalXP = recordXP + weekBonusXP + achXP();
      if (!changed) break;
    }
  }

  const lv = levelFromXP(totalXP);
  const stats = {};
  for (const s of STAT_DEFS) stats[s.id] = statValue(pts[s.id]);

  return {
    totalXP, recordXP, weekBonusXP, ...lv,
    title: titleFor(lv.level), stage: stageFor(lv.level),
    stats, pts, dayInfo, activeDays, exerciseDates, bestStreak, currentStreak,
    unlocked, newly, ctx: ctxBase, pbs, weekBonusEvents,
  };
}

/** 日付ごとの累計XPからレベルアップした日を求める（成長記録用） */
export function levelTimeline(game) {
  const byDate = new Map();
  const add = (d, x) => byDate.set(d, (byDate.get(d) || 0) + x);
  for (const [d, info] of game.dayInfo) add(d, info.total);
  for (const e of game.weekBonusEvents) add(e.date, e.xp);
  for (const a of ACHIEVEMENTS) if (game.unlocked[a.id] && a.xp) add(game.unlocked[a.id], a.xp);
  const events = [];
  let cum = 0; let level = 1;
  for (const d of [...byDate.keys()].sort()) {
    cum += byDate.get(d);
    const L = levelFromXP(cum).level;
    if (L > level) { events.push({ date: d, level: L }); level = L; }
  }
  return events;
}

/** 指定日の獲得XP */
export function xpOnDate(game, date) {
  let x = game.dayInfo.get(date)?.total || 0;
  for (const e of game.weekBonusEvents) if (e.date === date) x += e.xp;
  for (const a of ACHIEVEMENTS) if (game.unlocked[a.id] === date) x += a.xp;
  return x;
}
