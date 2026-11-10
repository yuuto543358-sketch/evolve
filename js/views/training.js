// TRAINING：筋トレ・有酸素運動の記録
import * as store from '../store.js';
import { S, exerciseById } from '../store.js';
import { strengthKcal, cardioKcal, cardioKind, CARDIO_KINDS } from '../calc.js';
import { icon } from '../icons.js';
import { segmented, stepper, chips, dateField, num, val, openSheet, toast, choice, confirmDialog } from '../ui.js';
import { workoutRow, cardioRow, handleEditClick, unitLabel, workoutText, cardioFormHTML, updateCardioEstimate } from '../records.js';
import { notify } from '../app.js';
import { today, esc, fmtNum, byDateDesc, addDays, fmtDateLong, relDay, groupBy } from '../util.js';

let mode = 'strength';
let date = today();
let cart = [];               // 今回まとめて記録する種目
let historyLimit = 14;
let appRef = null;

function lastOf(exId) {
  return S.workouts.filter((w) => w.exerciseId === exId).sort(byDateDesc)[0] || null;
}

/** よく使う種目を上に（直近60日の使用日数順） */
function sortedExercises() {
  const since = addDays(today(), -60);
  const freq = {};
  for (const w of S.workouts) if (w.date >= since) freq[w.exerciseId] = (freq[w.exerciseId] || 0) + 1;
  return [...S.exercises].sort((a, b) => (freq[b.id] || 0) - (freq[a.id] || 0) || (a.order ?? 0) - (b.order ?? 0)).map((e) => ({ ...e, freq: freq[e.id] || 0 }));
}

function addToCart(ex) {
  if (cart.some((c) => c.exerciseId === ex.id)) return false;
  const last = lastOf(ex.id);
  cart.push({
    key: Math.random().toString(36).slice(2),
    exerciseId: ex.id,
    reps: last ? last.reps : (ex.unit === 'sec' ? 30 : 10),
    sets: last ? last.sets : 3,
    weight: last ? last.weight : null,
  });
  return true;
}

export function render(root, app) {
  const p = app.params();
  if (p.mode) mode = p.mode;
  if (p.date) date = p.date;
  if (p.add) {
    const ex = exerciseById(p.add);
    if (ex) addToCart(ex);
  }
  if (p.kind) { cardioDraft.kind = p.kind; cardioDraft.touched = false; }
  if (p.manage) setTimeout(() => manageExercises(app), 60);
  app.clearParams(); // パラメータは一度だけ使う
  appRef = app;
  if (date > today()) date = today();

  root.innerHTML = `
  <div class="page training">
    <header class="page-head">
      <h1>TRAINING</h1>
      ${mode !== 'history' ? dateField('date', date) : ''}
    </header>
    ${segmented('mode', [{ value: 'strength', label: '筋トレ' }, { value: 'cardio', label: '有酸素' }, { value: 'history', label: '履歴' }], mode)}
    <div class="mode-body scope">${mode === 'strength' ? strengthHTML() : mode === 'cardio' ? cardioHTML() : historyHTML()}</div>
  </div>
  ${mode === 'strength' && cart.length ? cartBarHTML() : ''}`;

  if (mode === 'cardio') updateCardioEstimate(root.querySelector('.mode-body'));

  root.onchange = (e) => {
    if (e.target.matches('input[name=date]') && e.target.closest('.page-head')) {
      date = e.target.value || today();
      app.refresh();
    } else if (mode === 'cardio') {
      if (e.target.name === 'kind') prefillCardio(root);
      updateCardioEstimate(root.querySelector('.mode-body'));
    }
  };
  root.oninput = (e) => {
    if (mode === 'strength') {
      const item = e.target.closest('[data-cart]');
      if (item) {
        const c = cart.find((x) => x.key === item.dataset.cart);
        if (c) {
          c[e.target.name.split('-')[0]] = e.target.value === '' ? null : Number(e.target.value);
          updateCartKcal(root);
        }
      }
    } else if (mode === 'cardio') {
      saveCardioDraft(root);
      updateCardioEstimate(root.querySelector('.mode-body'));
    }
  };
  root.onclick = async (e) => {
    const seg = e.target.closest('[data-seg] [data-v]');
    if (seg) { mode = seg.dataset.v; app.refresh(); window.scrollTo(0, 0); return; }
    if (handleEditClick(e)) return;
    const addEx = e.target.closest('[data-add-ex]');
    if (addEx) {
      const ex = exerciseById(addEx.dataset.addEx);
      if (ex && !addToCart(ex)) cart = cart.filter((c) => c.exerciseId !== ex.id);
      app.refresh();
      if (cart.some((c) => c.exerciseId === ex.id)) {
        const el = root.querySelector(`[data-cart-ex="${ex.id}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) { cart = cart.filter((c) => c.key !== rm.dataset.rm); app.refresh(); return; }
    if (e.target.closest('[data-save-cart]')) { await saveCart(); return; }
    if (e.target.closest('[data-clear-cart]')) { cart = []; app.refresh(); return; }
    if (e.target.closest('[data-manage]')) { manageExercises(app); return; }
    if (e.target.closest('[data-save-cardio]')) { await saveCardio(root); return; }
    if (e.target.closest('[data-more]')) { historyLimit += 14; app.refresh(); return; }
    const repeat = e.target.closest('[data-repeat]');
    if (repeat) { await repeatDay(repeat.dataset.repeat); }
  };
}

/* ---------- 筋トレ ---------- */
function strengthHTML() {
  const list = sortedExercises();
  const todays = S.workouts.filter((w) => w.date === date).sort(byDateDesc);
  const lastDay = [...new Set(S.workouts.filter((w) => w.date < date).map((w) => w.date))].sort().pop();
  const frequent = list.filter((e) => e.freq > 0).slice(0, 4);
  const rest = list.filter((e) => !frequent.includes(e));
  const exRow = (ex) => {
    const last = lastOf(ex.id);
    const inCart = cart.some((c) => c.exerciseId === ex.id);
    return `<button type="button" class="ex-row ${inCart ? 'in' : ''}" data-add-ex="${ex.id}">
      <span class="ex-name">${esc(ex.name)}</span>
      <span class="ex-last">${last ? `前回 ${workoutText(last)}` : 'はじめての種目'}</span>
      <span class="ex-add">${icon(inCart ? 'check' : 'plus', 18)}</span>
    </button>`;
  };
  return `
    ${cart.length ? `<section class="card cart">
      <div class="card-h-row"><h2 class="card-h">${icon('bolt', 18)}今回の記録</h2><button type="button" class="link" data-clear-cart>クリア</button></div>
      <p class="hint top">前回の内容が入っています。変えたいところだけタップ。</p>
      ${cart.map(cartItemHTML).join('')}
    </section>` : ''}
    ${!cart.length && lastDay ? `<button type="button" class="card repeat-card" data-repeat="${lastDay}">
      ${icon('route', 18)}<span><strong>前回（${relDay(lastDay)}）と同じメニュー</strong><small>${S.workouts.filter((w) => w.date === lastDay).map((w) => esc(w.exerciseName)).join('・')}</small></span>${icon('right', 18)}
    </button>` : ''}
    <section class="card">
      <div class="card-h-row"><h2 class="card-h">${icon('dumbbell', 18)}種目を選ぶ</h2><button type="button" class="link" data-manage>${icon('settings', 15)}種目を管理</button></div>
      ${frequent.length ? `<p class="list-label">よく使う種目</p><div class="ex-list">${frequent.map(exRow).join('')}</div><p class="list-label">その他の種目</p>` : ''}
      <div class="ex-list">${rest.map(exRow).join('')}</div>
    </section>
    <section class="card">
      <h2 class="card-h">${icon('check', 18)}${date === today() ? '今日' : fmtDateLong(date)}の筋トレ</h2>
      ${todays.length ? `<div class="rec-list">${todays.map(workoutRow).join('')}</div><p class="hint">タップで修正・削除できます</p>` : '<div class="empty-soft">まだ記録はありません。上の種目をタップして始めましょう。</div>'}
    </section>`;
}

function cartItemHTML(c) {
  const ex = exerciseById(c.exerciseId);
  if (!ex) return '';
  const sec = ex.unit === 'sec';
  const repVals = sec ? [20, 30, 45, 60, 90] : [5, 10, 15, 20, 30];
  return `
  <div class="cart-item" data-cart="${c.key}" data-cart-ex="${ex.id}">
    <div class="cart-head"><strong>${esc(ex.name)}</strong><span class="cart-kcal" data-kcal>${fmtNum(itemKcal(c))}kcal</span><button type="button" class="icon-btn sm" data-rm="${c.key}" aria-label="外す">${icon('x', 16)}</button></div>
    <div class="cart-grid">
      <div class="field compact"><span class="field-label">${sec ? '秒数' : '回数'}</span>
        ${stepper(`reps-${c.key}`, c.reps, { step: sec ? 5 : 1, min: 1, max: 1000, unit: unitLabel(ex.unit) })}
        ${chips(`reps-${c.key}`, repVals, c.reps)}</div>
      <div class="field compact"><span class="field-label">セット</span>
        ${chips(`sets-${c.key}`, [1, 2, 3, 4, 5], c.sets, { cls: 'sets' })}
        <input type="hidden" name="sets-${c.key}" value="${c.sets}">
      </div>
      ${ex.useWeight ? `<div class="field compact"><span class="field-label">重量 <em>任意</em></span>${stepper(`weight-${c.key}`, c.weight, { step: 0.5, min: 0, max: 300, unit: 'kg', decimals: 1, placeholder: '0' })}</div>` : ''}
    </div>
  </div>`;
}

function itemKcal(c) {
  const ex = exerciseById(c.exerciseId);
  return strengthKcal(ex, c.reps, c.sets, c.weight, store.bodyWeightAt(date));
}

function updateCartKcal(root) {
  let total = 0;
  for (const c of cart) {
    const k = itemKcal(c);
    total += k;
    const el = root.querySelector(`[data-cart="${c.key}"] [data-kcal]`);
    if (el) el.textContent = `${fmtNum(k)}kcal`;
    root.querySelectorAll(`[data-chips-for="sets-${c.key}"] .chip`).forEach((ch) => ch.classList.toggle('on', Number(ch.dataset.v) === c.sets));
  }
  const bar = document.querySelector('[data-cart-total]');
  if (bar) bar.textContent = `約 ${fmtNum(total)}kcal`;
}

function cartBarHTML() {
  const total = cart.reduce((t, c) => t + itemKcal(c), 0);
  return `<div class="action-bar">
    <button type="button" class="btn btn-primary btn-block btn-lg" data-save-cart>
      ${icon('check', 20)}${cart.length}種目をまとめて記録<span class="btn-sub" data-cart-total>約 ${fmtNum(total)}kcal</span>
    </button></div>`;
}

async function saveCart() {
  const valid = cart.filter((c) => c.reps > 0 && c.sets > 0 && exerciseById(c.exerciseId));
  if (!valid.length) { toast('回数とセット数を入力してください'); return; }
  const recs = valid.map((c) => {
    const ex = exerciseById(c.exerciseId);
    return {
      date, exerciseId: ex.id, exerciseName: ex.name, unit: ex.unit, kcalPer: ex.kcalPer,
      reps: c.reps, sets: c.sets, weight: ex.useWeight ? (c.weight || null) : null,
    };
  });
  const saved = await store.saveMany('workouts', recs);
  cart = [];
  await notify({
    message: `${saved.length}種目を記録しました`,
    undo: { label: '取り消す', onClick: async () => { for (const r of saved) await store.deleteRecord('workouts', r.id); await notify({ message: '取り消しました', silentXP: true }); } },
  });
}

async function repeatDay(d) {
  const items = S.workouts.filter((w) => w.date === d);
  for (const w of items) {
    const ex = exerciseById(w.exerciseId);
    if (ex && !cart.some((c) => c.exerciseId === ex.id)) {
      cart.push({ key: Math.random().toString(36).slice(2), exerciseId: ex.id, reps: w.reps, sets: w.sets, weight: w.weight });
    }
  }
  if (!cart.length) toast('前回の種目が見つかりませんでした');
  appRef.refresh();
}

/* ---------- 種目の管理 ---------- */
function manageExercises(app) {
  const listHTML = () => S.exercises.map((ex) => `
    <div class="manage-row">
      <div><strong>${esc(ex.name)}</strong><small>${ex.unit === 'sec' ? '秒' : '回数'}で記録 ・ 1${unitLabel(ex.unit)}あたり約${ex.kcalPer}kcal${ex.useWeight ? ' ・ 重量あり' : ''}</small></div>
      <button type="button" class="icon-btn" data-edit-ex="${ex.id}" aria-label="編集">${icon('edit', 18)}</button>
    </div>`).join('');
  openSheet({
    title: '種目を管理',
    html: `<div data-list>${listHTML()}</div>
      <button type="button" class="btn btn-soft btn-block" data-new-ex>${icon('plus', 18)}種目を追加</button>
      <p class="hint">消費カロリーは目安です。体重・動作の速さ・強度によって変わります。数値は自由に変更できます。</p>`,
    onMount(body, close) {
      body.onclick = (e) => {
        const ed = e.target.closest('[data-edit-ex]');
        if (ed) { close(); exerciseEditor(app, exerciseById(ed.dataset.editEx)); return; }
        if (e.target.closest('[data-new-ex]')) { close(); exerciseEditor(app, null); }
      };
    },
  });
}

function exerciseEditor(app, ex) {
  const isNew = !ex;
  const e0 = ex || { name: '', unit: 'reps', kcalPer: 0.4, useWeight: false, part: 'upper' };
  openSheet({
    title: isNew ? '種目を追加' : '種目を編集',
    html: `<form class="form" onsubmit="return false">
      <div class="field"><span class="field-label">種目名</span><input class="input" type="text" name="name" value="${esc(e0.name)}" maxlength="30" placeholder="例：バーピー"></div>
      <div class="field"><span class="field-label">記録のしかた</span>${choice('unit', [{ value: 'reps', label: '回数' }, { value: 'sec', label: '秒数' }], e0.unit)}</div>
      <div class="field"><span class="field-label">鍛える部位</span>${choice('part', [{ value: 'upper', label: '上半身' }, { value: 'lower', label: '下半身' }, { value: 'core', label: '体幹' }], e0.part || 'upper')}</div>
      <div class="field"><span class="field-label">消費カロリー目安（1回 or 1秒あたり）</span>${stepper('kcalPer', e0.kcalPer, { step: 0.01, min: 0, max: 20, unit: 'kcal', decimals: 2 })}</div>
      <div class="field"><span class="field-label">重量を記録する</span>${choice('useWeight', [{ value: '0', label: 'しない' }, { value: '1', label: 'する' }], e0.useWeight ? '1' : '0')}</div>
      <div class="sheet-actions">${isNew ? '<span></span>' : `<button type="button" class="btn btn-text-danger" data-del>${icon('trash', 16)}削除する</button>`}<button type="button" class="btn btn-primary" data-save>保存する</button></div>
    </form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        if (e.target.closest('[data-save]')) {
          const name = val(body, 'name').trim();
          if (!name) { toast('種目名を入力してください'); return; }
          if (S.exercises.some((x) => x.name === name && (!ex || x.id !== ex.id))) { toast('同じ名前の種目があります'); return; }
          const rec = {
            ...e0, name, unit: val(body, 'unit'), part: val(body, 'part'),
            kcalPer: num(body, 'kcalPer') ?? 0, useWeight: val(body, 'useWeight') === '1',
          };
          if (isNew) rec.order = Math.max(0, ...S.exercises.map((x) => x.order ?? 0)) + 1;
          await store.saveRecord('exercises', rec, { silent: true });
          // 過去の記録の種目名も合わせる
          if (!isNew && ex.name !== name) {
            for (const w of S.workouts.filter((x) => x.exerciseId === ex.id)) await store.saveRecord('workouts', { ...w, exerciseName: name, unit: rec.unit }, { silent: true });
          }
          close();
          toast(isNew ? `「${esc(name)}」を追加しました` : '種目を更新しました');
          app.refresh();
        } else if (e.target.closest('[data-del]')) {
          const used = S.workouts.filter((x) => x.exerciseId === ex.id).length;
          const ok = await confirmDialog(`「${esc(ex.name)}」を削除しますか？${used ? `<br><small>過去の記録（${used}件）は残ります。</small>` : ''}`, { ok: '削除する', danger: true });
          if (!ok) return;
          await store.deleteRecord('exercises', ex.id);
          cart = cart.filter((c) => c.exerciseId !== ex.id);
          close();
          toast('種目を削除しました');
          app.refresh();
        }
      };
    },
  });
}

/* ---------- 有酸素 ---------- */
const cardioDraft = { kind: null, minutes: null, distanceKm: null, touched: false };

function lastCardio(kind) {
  return S.cardio.filter((c) => !kind || c.kind === kind).sort(byDateDesc)[0] || null;
}

function cardioHTML() {
  if (!cardioDraft.kind) {
    const last = lastCardio();
    cardioDraft.kind = last ? last.kind : 'walk';
  }
  if (!cardioDraft.touched) {
    const last = lastCardio(cardioDraft.kind);
    cardioDraft.minutes = last ? last.minutes : (cardioDraft.kind === 'run' ? 30 : 20);
    cardioDraft.distanceKm = last ? last.distanceKm : null;
  }
  const todays = S.cardio.filter((c) => c.date === date).sort(byDateDesc);
  const last = lastCardio(cardioDraft.kind);
  return `
    <section class="card">
      <h2 class="card-h">${icon('run', 18)}有酸素運動を記録</h2>
      ${last ? `<p class="hint top">前回の${cardioKind(cardioDraft.kind).name}（${relDay(last.date)}）の内容が入っています。</p>` : ''}
      <div class="form">${cardioFormHTML(cardioDraft, { showDate: false })}</div>
      <button type="button" class="btn btn-primary btn-block btn-lg" data-save-cardio>${icon('check', 20)}記録する</button>
      <p class="fine">消費カロリーは体重・時間・速度から推定した目安です（METs法）。</p>
    </section>
    <section class="card">
      <h2 class="card-h">${icon('check', 18)}${date === today() ? '今日' : fmtDateLong(date)}の有酸素運動</h2>
      ${todays.length ? `<div class="rec-list">${todays.map(cardioRow).join('')}</div>` : '<div class="empty-soft">まだ記録はありません。歩いた時間だけでも立派な記録です。</div>'}
    </section>`;
}

function saveCardioDraft(root) {
  cardioDraft.kind = val(root, 'kind') || cardioDraft.kind;
  cardioDraft.minutes = num(root, 'minutes');
  cardioDraft.distanceKm = num(root, 'distanceKm');
  cardioDraft.touched = true;
}

function prefillCardio(root) {
  const kind = val(root, 'kind');
  cardioDraft.kind = kind;
  const last = lastCardio(kind);
  const set = (name, v) => {
    const el = root.querySelector(`[name="${name}"]`);
    if (!el) return;
    el.value = v ?? '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  set('minutes', last ? last.minutes : (kind === 'run' ? 30 : 20));
  set('distanceKm', last && last.distanceKm ? Number(last.distanceKm).toFixed(1) : '');
  cardioDraft.touched = false;
}

async function saveCardio(root) {
  const body = root.querySelector('.mode-body');
  const kind = val(body, 'kind');
  const minutes = num(body, 'minutes');
  const km = num(body, 'distanceKm');
  if (!minutes && !km) { toast('時間か距離を入力してください'); return; }
  const rec = await store.saveRecord('cardio', { date, kind, minutes: minutes || null, distanceKm: km || null });
  cardioDraft.touched = false;
  await notify({
    message: `${cardioKind(kind).name}を記録しました`,
    undo: { label: '取り消す', onClick: async () => { await store.deleteRecord('cardio', rec.id); await notify({ message: '取り消しました', silentXP: true }); } },
  });
}

/* ---------- 履歴 ---------- */
function historyHTML() {
  const all = [
    ...S.workouts.map((r) => ({ ...r, _t: 'w' })),
    ...S.cardio.map((r) => ({ ...r, _t: 'c' })),
  ].sort(byDateDesc);
  if (!all.length) return '<section class="card"><div class="empty-soft">運動の記録はまだありません。<br>筋トレか有酸素のタブから、最初の1回を記録しましょう。</div></section>';
  const byDate = groupBy(all, (r) => r.date);
  const dates = [...byDate.keys()].slice(0, historyLimit);
  return `
    ${dates.map((d) => {
      const items = byDate.get(d);
      return `<section class="card hist-day">
        <h3 class="hist-h">${fmtDateLong(d)}<span>${relDay(d) !== d ? relDay(d) : ''}</span></h3>
        <div class="rec-list">${items.map((r) => (r._t === 'w' ? workoutRow(r) : cardioRow(r))).join('')}</div>
      </section>`;
    }).join('')}
    ${byDate.size > historyLimit ? '<button type="button" class="btn btn-ghost btn-block" data-more>もっと見る</button>' : ''}
    <p class="hint center">記録をタップすると修正・削除できます</p>`;
}

export { CARDIO_KINDS };
