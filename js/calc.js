// 消費カロリーの推定（すべて目安です）
import { S, bodyWeightAt, exerciseById } from './store.js';
import { round1 } from './util.js';

export const CARDIO_KINDS = [
  { id: 'run', name: 'ランニング', short: 'ラン', defaultSpeed: 9, icon: 'run' },
  { id: 'walk', name: 'ウォーキング', short: 'ウォーク', defaultSpeed: 4.8, icon: 'walk' },
  { id: 'cycle', name: 'サイクリング', short: 'サイクル', defaultSpeed: 16, icon: 'cycle' },
  { id: 'other', name: 'その他', short: 'その他', defaultSpeed: 6, icon: 'spark' },
];

export function cardioKind(id) { return CARDIO_KINDS.find((k) => k.id === id) || CARDIO_KINDS[3]; }

/** 速度(km/h)から運動強度(METs)を推定。速度が分からなければ設定値を使う */
export function cardioMET(kind, minutes, km, settings = S.settings) {
  const base = (settings.mets && settings.mets[kind]) || 4;
  if (!settings.useSpeedMets || !minutes || !km) return base;
  const v = km / (minutes / 60);
  if (kind === 'run') {
    // ランニングは速度(km/h) ≒ METs 程度
    return Math.max(6, Math.min(16, v * 1.0));
  }
  if (kind === 'walk') {
    if (v < 3.2) return 2.8;
    if (v < 4.8) return 3.5;
    if (v < 5.6) return 4.3;
    if (v < 6.5) return 5.0;
    return 6.3;
  }
  if (kind === 'cycle') {
    if (v < 16) return 4.0;
    if (v < 19) return 6.8;
    if (v < 22) return 8.0;
    if (v < 25) return 10.0;
    return 12.0;
  }
  return base;
}

/** 時間がない場合は距離と標準速度から時間を推定 */
export function effectiveMinutes(kind, minutes, km) {
  if (minutes) return minutes;
  if (km) return (km / cardioKind(kind).defaultSpeed) * 60;
  return 0;
}

/** 有酸素運動の消費カロリー(kcal) = METs × 体重(kg) × 時間(h) × 1.05 */
export function cardioKcal(kind, minutes, km, weightKg, settings = S.settings) {
  const min = effectiveMinutes(kind, minutes, km);
  if (!min) return 0;
  const met = cardioMET(kind, minutes, km, settings);
  return round1(met * weightKg * (min / 60) * 1.05);
}

export function cardioRecordKcal(c) {
  return cardioKcal(c.kind, c.minutes, c.distanceKm, bodyWeightAt(c.date));
}

/** 筋トレの消費カロリー */
export function strengthKcal(ex, reps, sets, weightLoad, bodyWeight, settings = S.settings) {
  if (!ex) return 0;
  const per = Number(ex.kcalPer) || 0;
  let k = per * (reps || 0) * (sets || 1);
  if (ex.useWeight && weightLoad) k *= 1 + Math.min(weightLoad, 60) / 40;
  if (settings.kcalWeightAdjust && bodyWeight) k *= bodyWeight / 65;
  return round1(k);
}

export function workoutKcal(w) {
  const ex = exerciseById(w.exerciseId) || { kcalPer: w.kcalPer, useWeight: !!w.weight };
  return strengthKcal(ex, w.reps, w.sets, w.weight, bodyWeightAt(w.date));
}

export function speedOf(minutes, km) {
  if (!minutes || !km) return null;
  return km / (minutes / 60);
}

/** 基礎代謝の目安（Mifflin-St Jeor式）。性別未設定の場合は男女の中間値 */
export function bmr(profile, weight) {
  if (!profile || !profile.age || !profile.height || !weight) return null;
  const base = 10 * weight + 6.25 * profile.height - 5 * profile.age;
  if (profile.sex === 'male') return Math.round(base + 5);
  if (profile.sex === 'female') return Math.round(base - 161);
  return Math.round(base - 78);
}
