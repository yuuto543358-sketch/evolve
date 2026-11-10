// アプリ全体のデータ（メモリ上のキャッシュ）と保存処理
import * as db from './db.js';
import { uid, today } from './util.js';

export const APP_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  proteinPerShake: 20,          // プロテイン1杯のタンパク質(g)
  kcalWeightAdjust: true,       // 消費カロリーを体重で補正する
  mets: { run: 8.3, walk: 3.5, cycle: 6.8, other: 4.0 }, // 速度不明時のMETs
  useSpeedMets: true,           // 距離と時間から速度を求めてMETsを調整
};

export const DEFAULT_EXERCISES = [
  { key: 'pushup', name: '腕立て伏せ', unit: 'reps', kcalPer: 0.4, useWeight: false, part: 'upper' },
  { key: 'situp', name: '腹筋', unit: 'reps', kcalPer: 0.3, useWeight: false, part: 'core' },
  { key: 'plank', name: 'プランク', unit: 'sec', kcalPer: 0.07, useWeight: false, part: 'core' },
  { key: 'squat', name: 'スクワット', unit: 'reps', kcalPer: 0.4, useWeight: false, part: 'lower' },
  { key: 'lunge', name: 'ランジ', unit: 'reps', kcalPer: 0.45, useWeight: false, part: 'lower' },
  { key: 'pullup', name: '懸垂', unit: 'reps', kcalPer: 1.0, useWeight: false, part: 'upper' },
  { key: 'dumbbell', name: 'ダンベル運動', unit: 'reps', kcalPer: 0.35, useWeight: true, part: 'upper' },
];

export const GOALS = [
  { id: 'hosomacho', name: '細マッチョ', desc: '脂肪を抑えて、腹筋・胸・肩・腕が適度に引き締まったバランスの良い身体' },
  { id: 'tone', name: '引き締め', desc: 'お腹まわりを中心に、すっきり引き締まった身体' },
  { id: 'stamina', name: '体力アップ', desc: '疲れにくく、走れる・動ける身体' },
  { id: 'health', name: '健康維持', desc: '無理なく続けて、調子の良い毎日を保つ' },
];

/** メモリ上のデータ */
export const S = {
  ready: false,
  profile: null,
  settings: { ...DEFAULT_SETTINGS },
  meta: {},
  achievements: {},   // { id: 'YYYY-MM-DD' }
  exercises: [],
  workouts: [],
  cardio: [],
  meals: [],
  body: [],
  photos: [],         // 写真の情報（本体画像は photoBlobs に別保存）
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(info) { for (const fn of listeners) fn(info); }

export async function loadAll() {
  const [profile, settings, meta, achievements, ...lists] = await Promise.all([
    db.kvGet('profile'), db.kvGet('settings'), db.kvGet('meta'), db.kvGet('achievements'),
    ...db.RECORD_STORES.map((s) => db.getAll(s)),
  ]);
  S.profile = profile || null;
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}), mets: { ...DEFAULT_SETTINGS.mets, ...((settings && settings.mets) || {}) } };
  S.meta = meta || {};
  S.achievements = achievements || {};
  db.RECORD_STORES.forEach((name, i) => { S[name] = lists[i] || []; });
  S.exercises.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  S.ready = true;
}

export async function ensureDefaultExercises() {
  if (S.exercises.length) return;
  const now = Date.now();
  const list = DEFAULT_EXERCISES.map((e, i) => ({
    id: uid(), ...e, builtin: true, order: i, createdAt: now, updatedAt: now,
  }));
  await db.bulkPut('exercises', list);
  S.exercises = list;
}

/** 記録を保存（新規 or 更新） */
export async function saveRecord(store, rec, opts = {}) {
  const now = Date.now();
  const item = { ...rec };
  if (!item.id) item.id = uid();
  if (!item.createdAt) item.createdAt = now;
  item.updatedAt = now;
  if (store !== 'exercises' && !item.date) item.date = today();
  await db.put(store, item);
  const arr = S[store];
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = item; else arr.push(item);
  if (store === 'exercises') arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!opts.silent) emit({ type: 'save', store, item });
  return item;
}

export async function saveMany(store, recs) {
  const out = [];
  for (const r of recs) out.push(await saveRecord(store, r, { silent: true }));
  emit({ type: 'save', store, items: out });
  return out;
}

export async function deleteRecord(store, id) {
  await db.del(store, id);
  S[store] = S[store].filter((x) => x.id !== id);
  if (store === 'photos') await db.del('photoBlobs', id);
  emit({ type: 'delete', store, id });
}

export async function setProfile(p) {
  S.profile = { ...p, updatedAt: Date.now() };
  await db.kvSet('profile', S.profile);
  emit({ type: 'profile' });
}

export async function setSettings(patch) {
  S.settings = { ...S.settings, ...patch };
  await db.kvSet('settings', S.settings);
  emit({ type: 'settings' });
}

export async function setMeta(patch) {
  S.meta = { ...S.meta, ...patch };
  await db.kvSet('meta', S.meta);
}

export async function setAchievements(map) {
  S.achievements = map;
  await db.kvSet('achievements', map);
}

export async function savePhotoBlob(id, buffer, type) {
  await db.put('photoBlobs', { type, data: buffer }, id);
}

export async function getPhotoBlob(id) {
  const v = await db.get('photoBlobs', id);
  if (!v) return null;
  return new Blob([v.data], { type: v.type || 'image/jpeg' });
}

/** 最新の体重（指定日以前）。なければプロフィール、なければ65kg */
export function bodyWeightAt(date) {
  let best = null;
  for (const b of S.body) {
    if (b.weight && (!date || b.date <= date)) {
      if (!best || b.date > best.date || (b.date === best.date && b.createdAt > best.createdAt)) best = b;
    }
  }
  if (best) return best.weight;
  if (date) {
    // 指定日より前の記録がない場合は最も古い記録
    const sorted = S.body.filter((b) => b.weight).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (sorted.length) return sorted[0].weight;
  }
  return (S.profile && S.profile.weight) || 65;
}

export function exerciseById(id) { return S.exercises.find((e) => e.id === id); }
