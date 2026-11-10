// NUTRITION：食事・タンパク質の記録
import * as store from '../store.js';
import { S } from '../store.js';
import { proteinOf } from '../game.js';
import { workoutKcal, cardioRecordKcal, bmr } from '../calc.js';
import { icon } from '../icons.js';
import { ring, miniBars } from '../charts.js';
import { dateField, largeTitle, secH, countAttr } from '../ui.js';
import { mealEditor, handleEditClick, SLOT_LABEL, SLOT_ICON } from '../records.js';
import { notify } from '../app.js';
import { today, esc, fmtNum, byDateDesc, addDays, parseYmd, fmtDateLong } from '../util.js';

let date = today();
let showCalories = false;

export function render(root, app) {
  const p = app.params();
  if (p.date) date = p.date;
  app.clearParams();
  if (date > today()) date = today();
  try { showCalories = localStorage.getItem('evolve:showKcal') === '1'; } catch { /* ignore */ }

  const goal = (S.profile && S.profile.proteinGoal) || 100;
  const meals = S.meals.filter((m) => m.date === date);
  const pr = proteinOf(meals);
  const remain = Math.max(0, goal - pr.total);
  const shakes = meals.filter((m) => m.slot === 'protein');
  const per = S.settings.proteinPerShake || 20;

  // 直近7日のタンパク質
  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
  const vals = days.map((d) => proteinOf(S.meals.filter((m) => m.date === d)).total);
  const labels = days.map((d) => ['日', '月', '火', '水', '木', '金', '土'][parseYmd(d).getDay()]);
  const metDays = vals.filter((v) => v >= goal).length;

  root.innerHTML = `
  <div class="page nutrition">
    ${largeTitle({ kicker: 'NUTRITION', title: '食事と栄養', right: dateField('date', date) })}

    <section class="card protein-card ${remain ? '' : 'met'}">
      <div class="protein-top">
        <div class="protein-ring">
          ${ring(pr.total / goal, { size: 156, stroke: 14, grad: pr.total >= goal ? ['#E3C989', '#C99B47'] : ['#3BB39E', '#1F8070'] })}
          <div class="pr-center">
            <span class="pr-label">タンパク質</span>
            <span class="pr-val num"><b ${countAttr('pr-' + date, Math.round(pr.total))}>${fmtNum(pr.total, 0)}</b><small>/${goal}g</small></span>
          </div>
        </div>
        <div class="protein-side">
          <p class="pr-remain ${remain ? '' : 'met'}">${remain ? `目標まで<br><strong>あと ${fmtNum(remain, 0)}g</strong>` : `${icon('check', 18)}<strong>目標達成！</strong>`}</p>
          <div class="pr-break">
            <div><span class="dot food"></span>食事<b>${fmtNum(pr.food, 0)}g</b></div>
            <div><span class="dot shake"></span>プロテイン<b>${fmtNum(pr.shake, 0)}g</b></div>
          </div>
        </div>
      </div>
      <div class="pr-bar"><i class="food" style="width:${Math.min(100, (pr.food / goal) * 100)}%"></i><i class="shake" style="width:${Math.min(100 - Math.min(100, (pr.food / goal) * 100), (pr.shake / goal) * 100)}%"></i></div>
      <button type="button" class="btn btn-gold btn-block btn-lg shake-btn" data-shake>
        ${icon('cup', 20)}プロテインを飲んだ<span class="btn-sub">+${per}g</span>
      </button>
      ${shakes.length ? `<p class="hint center">${date === today() ? '今日' : 'この日'}は ${shakes.length}杯 記録済み ・ <button type="button" class="link" data-edit="meals" data-id="${shakes.sort(byDateDesc)[0].id}">最後の1杯を修正</button></p>` : ''}
    </section>

    ${secH(`${date === today() ? '今日' : fmtDateLong(date)}の食事`)}
    <div class="card list-card slots">
      ${['breakfast', 'lunch', 'dinner', 'snack'].map((slot) => slotHTML(slot, meals.filter((m) => m.slot === slot))).join('')}
    </div>
    <p class="sec-hint">内容だけ・タンパク質だけの記録でもOK。食事を楽しみながら、タンパク質を少し意識するだけで十分です。</p>

    ${secH('この7日間のタンパク質', `<span class="sec-note">目標達成 ${metDays}日</span>`)}
    <section class="card">
      ${miniBars(vals, { labels, color: 'var(--primary)', height: 92, goal, highlight: 6, hiColor: 'var(--gold)' })}
      <p class="chart-legend"><i class="lg-goal"></i>目標 ${goal}g</p>
    </section>

    <section class="card disclosure ${showCalories ? 'open' : ''}">
      <button type="button" class="disc-head" data-toggle-kcal>
        <span class="disc-ic">${icon('flame', 17)}</span><span class="disc-title">カロリーの参考値</span><span class="disc-chev">${icon('down', 16)}</span>
      </button>
      ${showCalories ? `<div class="disc-body">${kcalHTML(meals)}</div>` : ''}
    </section>
  </div>`;

  root.onchange = (e) => {
    if (e.target.matches('input[name=date]')) { date = e.target.value || today(); app.refresh(); }
  };
  root.onclick = async (e) => {
    if (handleEditClick(e)) return;
    if (e.target.closest('[data-shake]')) {
      const rec = await store.saveRecord('meals', { date, slot: 'protein', content: 'プロテイン', protein: per });
      await notify({
        message: `プロテイン ${per}g を記録しました`,
        undo: { label: '取り消す', onClick: async () => { await store.deleteRecord('meals', rec.id); await notify({ message: '取り消しました', silentXP: true }); } },
      });
      return;
    }
    const add = e.target.closest('[data-add-meal]');
    if (add) { mealEditor({ slot: add.dataset.addMeal, date }); return; }
    const same = e.target.closest('[data-same]');
    if (same) {
      const src = S.meals.find((m) => m.id === same.dataset.same);
      if (!src) return;
      const rec = await store.saveRecord('meals', { date, slot: src.slot, content: src.content, protein: src.protein, kcal: src.kcal });
      await notify({
        message: `${SLOT_LABEL[src.slot]}を記録しました`,
        undo: { label: '取り消す', onClick: async () => { await store.deleteRecord('meals', rec.id); await notify({ message: '取り消しました', silentXP: true }); } },
      });
      return;
    }
    if (e.target.closest('[data-toggle-kcal]')) {
      showCalories = !showCalories;
      try { localStorage.setItem('evolve:showKcal', showCalories ? '1' : '0'); } catch { /* ignore */ }
      app.refresh();
    }
  };
}

function slotHTML(slot, items) {
  // 前回の同じ枠の食事（ワンタップで同じ内容を記録）
  const prev = items.length ? null : S.meals.filter((m) => m.slot === slot && m.date < date && (m.content || m.protein)).sort(byDateDesc)[0];
  const p = items.reduce((t, m) => t + (Number(m.protein) || 0), 0);
  return `
  <div class="slot ${items.length ? 'filled' : ''}">
    <div class="slot-head">
      <span class="slot-ic">${icon(SLOT_ICON[slot], 18)}</span>
      <strong>${SLOT_LABEL[slot]}</strong>
      ${items.length ? `<span class="slot-p">${fmtNum(p, 0)}g</span>` : ''}
      <button type="button" class="add-btn" data-add-meal="${slot}" aria-label="${SLOT_LABEL[slot]}を記録">${icon('plus', 18)}</button>
    </div>
    ${items.length ? `<div class="slot-items">${items.sort((a, b) => a.createdAt - b.createdAt).map((m) => `
      <button type="button" class="slot-item" data-edit="meals" data-id="${m.id}">
        <span>${esc(m.content) || 'タンパク質のみ'}</span>
        <small>${fmtNum(m.protein || 0, 0)}g${m.kcal ? ` ・ ${fmtNum(m.kcal)}kcal` : ''}</small>
      </button>`).join('')}</div>` : ''}
    ${prev ? `<button type="button" class="slot-same" data-same="${prev.id}">${icon('route', 14)}前回と同じ：${esc(prev.content || 'タンパク質のみ')}（${fmtNum(prev.protein || 0, 0)}g）</button>` : ''}
  </div>`;
}

function kcalHTML(meals) {
  const intake = meals.reduce((t, m) => t + (Number(m.kcal) || 0), 0);
  const burned = S.workouts.filter((w) => w.date === date).reduce((t, w) => t + workoutKcal(w), 0)
    + S.cardio.filter((c) => c.date === date).reduce((t, c) => t + cardioRecordKcal(c), 0);
  const weight = store.bodyWeightAt(date);
  const base = bmr(S.profile, weight);
  const daily = base ? Math.round(base * 1.4) : null; // 普段の生活での消費の目安
  return `
    <div class="kcal-grid">
      <div><span>摂取（記録分）</span><b>${fmtNum(intake)}<small>kcal</small></b></div>
      <div><span>運動での消費</span><b>${fmtNum(burned)}<small>kcal</small></b></div>
      ${daily ? `<div><span>1日の消費目安</span><b>${fmtNum(daily + burned)}<small>kcal</small></b></div>` : ''}
    </div>
    <p class="fine">すべて目安です。摂取カロリーは入力した分だけを合計しています。${daily ? '1日の消費目安は、基礎代謝（年齢・身長・体重から推定）×1.4＋運動での消費です。' : ''}数字にとらわれすぎず、参考程度にご覧ください。</p>`;
}
