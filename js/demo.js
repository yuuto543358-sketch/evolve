// デモデータ（あなたの記録とは別のデータベース「evolve-demo」に保存されます）
import * as store from './store.js';
import { S } from './store.js';
import { computeGame } from './game.js';
import { today, addDays, parseYmd } from './util.js';
import { savePhotoCanvas, PHOTO_W, PHOTO_H } from './photos.js';

function rnd(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export async function seedDemo() {
  const r = rnd(42);
  const days = 49;
  const start = addDays(today(), -days);
  await store.setProfile({
    age: 28, height: 172, weight: 68.4, bodyFat: 19.5, sex: 'male', proteinGoal: 100, fatLimit: 60,
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
      meals.push({ date: d, slot: 'breakfast', content: r() > 0.5 ? '卵2個とトースト' : 'ヨーグルトとバナナ', protein: r() > 0.5 ? 15 : 8, fat: 12, kcal: 400 });
      meals.push({ date: d, slot: 'lunch', content: r() > 0.5 ? '鶏むね肉の定食' : '親子丼', protein: r() > 0.5 ? 32 : 24, fat: 18, kcal: 700 });
      if (r() > 0.25) meals.push({ date: d, slot: 'dinner', content: r() > 0.5 ? '焼き魚と味噌汁' : 'カレーライス', protein: r() > 0.5 ? 28 : 18, fat: r() > 0.5 ? 14 : 24, kcal: 750 });
      if (r() > 0.4) meals.push({ date: d, slot: 'protein', content: 'プロテイン', protein: 20 });
      if (r() > 0.7) meals.push({ date: d, slot: 'snack', content: 'ナッツ', protein: 5, fat: 14, kcal: 180 });
    }
    if (i % 7 === 0 || i === days) {
      body.push({ date: d, weight: Math.round((68.4 - prog * 1.4 + (r() - 0.5) * 0.6) * 10) / 10, bodyFat: Math.round((19.5 - prog * 1.8 + (r() - 0.5) * 0.4) * 10) / 10, muscle: Math.round((52.6 + prog * 0.5) * 10) / 10, waist: Math.round((81 - prog * 2.2) * 2) / 2 });
    }
  }
  const daily = [];
  for (let i = 0; i <= days; i++) {
    const dd = addDays(start, i);
    daily.push({ id: `d-${dd}`, date: dd, source: 'demo', steps: Math.round(5200 + r() * 6000 + (i / days) * 1500), activeKcal: Math.round(260 + r() * 260) });
  }
  await store.bulkSave('daily', daily);
  await store.saveMany('workouts', workouts);
  await store.saveMany('cardio', cardio);
  await store.saveMany('meals', meals);
  await store.saveMany('body', body);
  // デモ用の写真（イラスト）。本物の写真ではないことが分かるよう「DEMO」と入れています
  for (let i = 0; i <= days; i += 7) {
    const d = addDays(start, i);
    const prog = i / days;
    await savePhotoCanvas(demoPhoto(prog, 'front'), { pose: 'front', date: d });
    if (i % 14 === 0) await savePhotoCanvas(demoPhoto(prog, 'side'), { pose: 'side', date: d });
  }
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

function demoPhoto(prog, pose) {
  const W = PHOTO_W; const H = PHOTO_H;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#E4EAE7'); bg.addColorStop(1, '#CBD5D1');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const k = W / 300; // シルエット座標(300x400)からの倍率
  g.save(); g.scale(k, k);
  g.fillStyle = '#93A7A0';
  if (pose === 'side') {
    g.beginPath(); g.ellipse(150, 92, 38, 47, 0, 0, Math.PI * 2); g.fill();
    const belly = 120 - prog * 10;
    g.beginPath();
    g.moveTo(134, 140); g.lineTo(170, 140);
    g.bezierCurveTo(200, 175, 204, 215, 202, 250); g.bezierCurveTo(200, 300, 196, 350, 194, 400);
    g.lineTo(belly, 400); g.bezierCurveTo(belly - 4, 350, belly + 2, 300, 122, 280);
    g.bezierCurveTo(116, 260, 106, 244, 106, 216); g.bezierCurveTo(106, 190, 118, 172, 134, 160);
    g.closePath(); g.fill();
  } else {
    g.beginPath(); g.ellipse(150, 92, 36, 46, 0, 0, Math.PI * 2); g.fill();
    const waist = 58 - prog * 8;
    const sh = 108 + prog * 4;
    g.beginPath();
    g.moveTo(134, 135); g.lineTo(166, 135); g.lineTo(168, 160);
    g.bezierCurveTo(200, 168, 150 + sh, 172, 150 + sh, 230);
    g.lineTo(150 + sh - 4, 330); g.lineTo(150 + sh - 6, 400);
    g.lineTo(150 + waist + 18, 400); g.lineTo(150 + waist + 14, 300); g.lineTo(150 + waist, 400);
    g.lineTo(150 - waist, 400); g.lineTo(150 - waist - 14, 300); g.lineTo(150 - waist - 18, 400);
    g.lineTo(150 - sh + 6, 400); g.lineTo(150 - sh + 4, 330); g.lineTo(150 - sh, 230);
    g.bezierCurveTo(150 - sh, 172, 100, 168, 132, 160);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(150, 200); g.lineTo(150, 380); g.stroke();
    g.beginPath(); g.moveTo(118, 215); g.quadraticCurveTo(150, 232, 182, 215); g.stroke();
  }
  g.restore();
  g.fillStyle = 'rgba(30,50,45,.45)';
  g.font = 'bold 34px sans-serif';
  g.fillText('DEMO', 34, 64);
  return c;
}
