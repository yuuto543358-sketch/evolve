// 今日の予定：毎日はじめて開いたときに予定を聞き、それに合ったトレーニングをおすすめする
import * as store from './store.js';
import { S } from './store.js';
import { icon } from './icons.js';
import { openSheet, toast, haptic } from './ui.js';
import { today, byDateDesc } from './util.js';

/**
 * 予定の選択肢と、それぞれに合ったメニュー
 * menu: 種目（初期種目のキー）/ sets: セット数（null なら前回と同じ）/ cardio: 有酸素のおすすめ
 */
export const PLANS = [
  {
    id: 'desk', label: 'デスクワーク', sub: '座っている時間が長い日', ic: 'laptop', tone: 'green',
    title: 'デスクワークの日メニュー',
    note: '座りっぱなしで固まった脚とお腹まわりを動かして、血のめぐりをリセット。',
    menu: ['squat', 'plank', 'lunge'], sets: null,
    cardio: { kind: 'walk', minutes: 15, note: '昼休みや帰り道に少し歩くと、肩こり・むくみ対策にも。' },
  },
  {
    id: 'out', label: '仕事で外出', sub: '外回り・よく歩く日', ic: 'briefcase', tone: 'blue',
    title: '外出の日メニュー',
    note: '脚はもう十分使う日。上半身とお腹を短めに鍛えましょう。',
    menu: ['pushup', 'situp'], sets: null,
    cardio: null,
  },
  {
    id: 'physical', label: '立ち仕事・力仕事', sub: '身体をよく使う日', ic: 'bolt', tone: 'amber',
    title: '身体を使う日メニュー',
    note: '身体はもう働いています。体幹だけ軽く整えて、回復を優先しましょう。',
    menu: ['plank'], sets: 2,
    cardio: null,
  },
  {
    id: 'off', label: '休日・時間がある', sub: 'しっかり動ける日', ic: 'sun', tone: 'gold',
    title: '休日のしっかりメニュー',
    note: '時間のある日は全身をまんべんなく。細マッチョへのいちばんの近道です。',
    menu: ['pushup', 'squat', 'situp', 'plank'], sets: null,
    cardio: { kind: 'run', minutes: 20, note: '筋トレのあとに軽く走ると、脂肪が燃えやすくなります。' },
  },
  {
    id: 'busy', label: '忙しくて時間がない', sub: '5分だけなら動ける日', ic: 'clock', tone: 'slate',
    title: '5分だけメニュー',
    note: '1種目1セットでも立派な積み重ね。やらないよりずっと成長します。',
    menu: ['@rotate'], sets: 1,
    cardio: null,
  },
  {
    id: 'party', label: '飲み会・外食がある', sub: 'たくさん食べる予定の日', ic: 'glass', tone: 'amber',
    title: '外食の日メニュー',
    note: '食事の前に軽く動いておけば安心。焼き鳥・刺身・枝豆などを選ぶとタンパク質もとれます。楽しんでOK！',
    menu: ['squat', 'pushup'], sets: 2,
    cardio: { kind: 'walk', minutes: 20, note: '帰りにひと駅ぶん歩くだけでも十分です。' },
  },
  {
    id: 'rest', label: '疲れ気味・休みたい', sub: '身体を休める日', ic: 'moon', tone: 'sage',
    title: '今日は休養日',
    note: '休むのも成長のうち。筋肉は休んでいる間に育ちます。お風呂とストレッチ、早めの睡眠を。',
    menu: [], sets: null,
    cardio: { kind: 'walk', minutes: 10, note: '気が向いたら、気分転換に少しだけ散歩を。', optional: true },
  },
];

export function planById(id) { return PLANS.find((p) => p.id === id) || null; }

/** 今日選んだ予定（まだなら null） */
export function todayPlan() {
  const id = S.meta.plans && S.meta.plans[today()];
  return id ? planById(id) : null;
}

function findExercise(key) {
  return S.exercises.find((e) => e.key === key) || null;
}

/** 予定に合った種目リスト（前回の回数つき） */
export function planExercises(plan) {
  let keys = plan.menu;
  if (keys[0] === '@rotate') {
    // しばらくやっていない種目を1つ選ぶ
    const cands = ['squat', 'pushup', 'situp'].map(findExercise).filter(Boolean);
    const lastDate = (ex) => (S.workouts.filter((w) => w.exerciseId === ex.id).sort(byDateDesc)[0] || {}).date || '0';
    cands.sort((a, b) => (lastDate(a) < lastDate(b) ? -1 : 1));
    return cands.slice(0, 1).map((ex) => withLast(ex, plan.sets));
  }
  let list = keys.map(findExercise).filter(Boolean);
  // 初期種目を消している場合は、手持ちの種目から補う
  if (!list.length && keys.length) list = S.exercises.filter((e) => !e.useWeight).slice(0, keys.length);
  return list.map((ex) => withLast(ex, plan.sets));
}

function withLast(ex, sets) {
  const last = S.workouts.filter((w) => w.exerciseId === ex.id).sort(byDateDesc)[0];
  return {
    ex,
    reps: last ? last.reps : (ex.unit === 'sec' ? 30 : 10),
    sets: sets || (last ? last.sets : 3),
  };
}

async function setPlan(id) {
  const plans = { ...(S.meta.plans || {}) };
  plans[today()] = id;
  // 古い記録は60日分だけ残す
  const keys = Object.keys(plans).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete plans[k];
  await store.setMeta({ plans, planAsked: today() });
}

/** 今日の予定を聞くシート */
export function openPlanSheet({ onPicked = null } = {}) {
  const cur = todayPlan();
  let picked = false;
  openSheet({
    title: '今日の予定は？',
    subtitle: '予定に合わせて、今日のおすすめを用意します',
    html: `<div class="group plan-list">${PLANS.map((p) => `
      <button type="button" class="g-row plan-row tone-${p.tone} ${cur && cur.id === p.id ? 'on' : ''}" data-plan-id="${p.id}">
        <span class="plan-ic">${icon(p.ic, 20)}</span>
        <span class="g-label"><strong>${p.label}</strong><small>${p.sub}</small></span>
        <span class="plan-check">${icon('check', 14)}</span>
      </button>`).join('')}</div>
      <p class="hint center">あとからホームの「今日のおすすめ」でいつでも変えられます</p>`,
    onClose() {
      if (!picked && S.meta.planAsked !== today()) store.setMeta({ planAsked: today() });
    },
    onMount(body, close) {
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-plan-id]');
        if (!b) return;
        picked = true;
        haptic(8);
        body.querySelectorAll('.plan-row').forEach((r) => r.classList.toggle('on', r === b));
        const plan = planById(b.dataset.planId);
        await setPlan(plan.id);
        setTimeout(() => {
          close();
          toast(`「${plan.label}」の日のおすすめを用意しました`, { icon: plan.ic });
          if (onPicked) onPicked(plan);
        }, 220);
      });
    },
  });
}

/** 今日まだ聞いていなければ聞く */
export function maybeAskPlan(opts) {
  if (S.meta.planAsked === today()) return false;
  if (document.querySelector('.sheet-wrap, .alert-wrap, .levelup-wrap, .cam, .viewer')) return false;
  openPlanSheet(opts);
  return true;
}
