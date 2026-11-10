// デモデータ（あなたの記録とは別のデータベース「evolve-demo」に保存されます）
import * as store from './store.js';
import { S } from './store.js';
import { computeGame } from './game.js';
import { today, addDays, parseYmd } from './util.js';

function rnd(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export async function seedDemo() {
  const r = rnd(42);
  const days = 49;
  const start = addDays(today(), -days);
  await store.setProfile({
    age: 28, height: 172, weight: 68.4, bodyFat: 19.5, sex: 'male', proteinGoal: 100,
    goal: 'hosomacho', goalNote: '夏までに腹筋のラインを出す', onboarded: true, startDate: start, createdAt: Date.now(), demo: true,
  });
  await store.ensureDefaultExercises();
  const ex = (key) => S.exercises.find((e) => e.key === key);
  const workouts = []; const cardio = []; const meals = []; const body = [];
  for (let i = 0; i <= days; i++) {
    const d = addDays(start, i);
    const dow = parseYmd(d).getDay();
    const prog = i / days;
    const strengthDay = [1, 3, 5].includes(dow) || (dow === 6 && r() > 0.6);
    if (strengthDay && r() > 0.12) {
      const menu = dow === 3 ? ['squat', 'lunge', 'plank'] : ['pushup', 'situp', 'squat', dow === 5 ? 'dumbbell' : 'plank'];
      for (const k of menu) {
        const e = ex(k);
        const base = { pushup: 10, situp: 15, squat: 15, lunge: 10, plank: 30, dumbbell: 10 }[k];
        const reps = Math.round(base * (1 + prog * 0.6) + (r() > 0.7 ? 2 : 0));
        workouts.push({ date: d, exerciseId: e.id, exerciseName: e.name, unit: e.unit, kcalPer: e.kcalPer, reps: e.unit === 'sec' ? Math.round(reps / 5) * 5 : reps, sets: 3, weight: e.useWeight ? (5 + Math.floor(prog * 3)) : null });
      }
    }
    if ((dow === 2 || dow === 0) && r() > 0.2) {
      const run = dow === 0;
      cardio.push({ date: d, kind: run ? 'run' : 'walk', minutes: run ? 25 + Math.round(prog * 10) : 30, distanceKm: run ? Math.round((3.5 + prog * 1.5) * 10) / 10 : 2.4 });
    }
    if (r() > 0.15) {
      meals.push({ date: d, slot: 'breakfast', content: r() > 0.5 ? '卵2個とトースト' : 'ヨーグルトとバナナ', protein: r() > 0.5 ? 15 : 8, kcal: 400 });
      meals.push({ date: d, slot: 'lunch', content: r() > 0.5 ? '鶏むね肉の定食' : '親子丼', protein: r() > 0.5 ? 32 : 24, kcal: 700 });
      if (r() > 0.25) meals.push({ date: d, slot: 'dinner', content: r() > 0.5 ? '焼き魚と味噌汁' : 'カレーライス', protein: r() > 0.5 ? 28 : 18, kcal: 750 });
      if (r() > 0.4) meals.push({ date: d, slot: 'protein', content: 'プロテイン', protein: 20 });
      if (r() > 0.7) meals.push({ date: d, slot: 'snack', content: 'ナッツ', protein: 5, kcal: 180 });
    }
    if (i % 7 === 0 || i === days) {
      body.push({ date: d, weight: Math.round((68.4 - prog * 1.4 + (r() - 0.5) * 0.6) * 10) / 10, bodyFat: Math.round((19.5 - prog * 1.8 + (r() - 0.5) * 0.4) * 10) / 10, muscle: Math.round((52.6 + prog * 0.5) * 10) / 10, waist: Math.round((81 - prog * 2.2) * 2) / 2 });
    }
  }
  await store.saveMany('workouts', workouts);
  await store.saveMany('cardio', cardio);
  await store.saveMany('meals', meals);
  await store.saveMany('body', body);
  // 実績の達成日を日付順に再現
  const unlocked = {};
  for (let i = 0; i <= days; i++) {
    const d = addDays(start, i);
    S.achievements = { ...unlocked };
    const g = computeGame({ asOf: d, withAchievements: true });
    for (const a of g.newly) unlocked[a.id] = d;
  }
  await store.setAchievements(unlocked);
  const g = computeGame();
  await store.setMeta({ lastSeenLevel: g.level, demo: true });
}
