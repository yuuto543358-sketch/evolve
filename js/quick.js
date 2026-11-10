// ＋ボタン：どの画面からでもすぐ記録できるクイックメニュー
import * as store from './store.js';
import { S } from './store.js';
import { proteinOf, xpOnDate } from './game.js';
import { icon } from './icons.js';
import { openSheet } from './ui.js';
import { mealEditor, bodyEditor } from './records.js';
import { notify } from './app.js';
import { openCamera } from './camera.js';
import { openHealthImport } from './health.js';
import { today, fmtNum } from './util.js';

function slotByTime() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 17.5) return 'snack';
  return 'dinner';
}

export function openQuickAdd(app) {
  const t = today();
  const per = S.settings.proteinPerShake || 20;
  const goal = (S.profile && S.profile.proteinGoal) || 100;
  const pr = proteinOf(S.meals.filter((m) => m.date === t)).total;
  const xp = app.game ? xpOnDate(app.game, t) : 0;
  const slot = slotByTime();
  const slotName = { breakfast: '朝食', lunch: '昼食', snack: '間食', dinner: '夕食' }[slot];
  const tiles = [
    { id: 'strength', ic: 'dumbbell', label: '筋トレ', sub: '前回のメニューから', tone: 'green' },
    { id: 'cardio', ic: 'run', label: '有酸素', sub: 'ラン・ウォーク', tone: 'blue' },
    { id: 'shake', ic: 'cup', label: 'プロテイン', sub: `タップで +${per}g`, tone: 'gold' },
    { id: 'meal', ic: 'meal', label: slotName, sub: '食事を記録', tone: 'amber' },
    { id: 'body', ic: 'scale', label: '身体測定', sub: '体重・体脂肪', tone: 'sage' },
    { id: 'photo', ic: 'camera', label: '写真', sub: '上半身をガイド撮影', tone: 'slate' },
  ];
  openSheet({
    title: '記録する',
    subtitle: `今日 <b>+${fmtNum(xp)} XP</b> ・ タンパク質 <b>${fmtNum(pr)}</b>/${goal}g`,
    html: `<div class="quick-tiles">${tiles.map((x) => `
      <button type="button" class="qt qt-${x.tone}" data-q="${x.id}">
        <span class="qt-ic">${icon(x.ic, 22)}</span>
        <strong>${x.label}</strong><small>${x.sub}</small>
      </button>`).join('')}</div>
      <button type="button" class="qt-wide" data-q="health"><span class="ic-sq" style="--sq:#D2493E">${icon('heart', 16)}</span><span><strong>Apple Watch・ヘルスケアから取り込む</strong><small>歩数・消費カロリー・ワークアウト・体重</small></span>${icon('right', 16)}</button>`,
    onMount(body, close) {
      body.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-q]');
        if (!b) return;
        const q = b.dataset.q;
        if (q === 'shake') {
          b.classList.add('done');
          const rec = await store.saveRecord('meals', { date: t, slot: 'protein', content: 'プロテイン', protein: per });
          close();
          await notify({
            message: `プロテイン ${per}g を記録しました`,
            undo: { label: '取り消す', onClick: async () => { await store.deleteRecord('meals', rec.id); await notify({ message: '取り消しました', silentXP: true }); } },
          });
          return;
        }
        close();
        // カメラはタップの直後に開く（iPhoneで傾きセンサーの許可を出すため）
        if (q === 'photo') { openCamera({ pose: 'front' }); return; }
        if (q === 'health') { setTimeout(() => openHealthImport(), 180); return; }
        setTimeout(() => {
          if (q === 'strength') app.go('training', { mode: 'strength', date: t });
          else if (q === 'cardio') app.go('training', { mode: 'cardio', date: t });
          else if (q === 'meal') mealEditor({ slot, date: t });
          else if (q === 'body') bodyEditor({ date: t });
        }, 180);
      });
    },
  });
}
