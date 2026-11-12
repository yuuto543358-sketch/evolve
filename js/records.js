// 記録の表示・編集・削除（各画面で共通して使う）
import * as store from './store.js';
import { S, exerciseById } from './store.js';
import { workoutKcal, cardioRecordKcal, cardioKind, CARDIO_KINDS, cardioKcal, speedOf } from './calc.js';
import { openSheet, stepper, chips, choice, dateField, num, val, confirmDialog, toast, onSwipeDelete } from './ui.js';
import { icon } from './icons.js';
import { esc, fmtNum, fmtDateLong, today, byDateDesc } from './util.js';
import { notify } from './app.js';

export const SLOT_LABEL = { breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食', protein: 'プロテイン' };
export const SLOT_ICON = { breakfast: 'sun', lunch: 'meal', dinner: 'moon', snack: 'leaf', protein: 'cup' };

export function unitLabel(unit) { return unit === 'sec' ? '秒' : '回'; }

export function workoutText(w) {
  return `${w.reps}${unitLabel(w.unit)} × ${w.sets}セット${w.weight ? ` ・ ${fmtNum(w.weight, 1)}kg` : ''}`;
}

export function cardioText(c) {
  const parts = [];
  if (c.minutes) parts.push(`${fmtNum(c.minutes)}分`);
  if (c.distanceKm) parts.push(`${fmtNum(c.distanceKm, 2)}km`);
  return parts.join(' ・ ') || '—';
}

export function bodyText(b) {
  const parts = [];
  if (b.weight) parts.push(`${Number(b.weight).toFixed(1)}kg`);
  if (b.bodyFat) parts.push(`体脂肪 ${Number(b.bodyFat).toFixed(1)}%`);
  if (b.muscle) parts.push(`筋肉 ${Number(b.muscle).toFixed(1)}kg`);
  if (b.waist) parts.push(`ウエスト ${fmtNum(b.waist, 1)}cm`);
  return parts.join(' ・ ') || '—';
}

/** 一覧の1行（左にスワイプすると削除ボタンが出ます） */
export function row({ ic, title, sub = '', right = '', attrs = '', color = '', edit = null }) {
  const inner = `<button type="button" class="rec-row ${edit ? 'swipe-front' : ''}" ${attrs}>
    <span class="rec-ic" ${color ? `style="--ic:${color}"` : ''}>${icon(ic, 18)}</span>
    <span class="rec-main"><span class="rec-title">${title}</span>${sub ? `<span class="rec-sub">${sub}</span>` : ''}</span>
    <span class="rec-right">${right}</span>
    ${edit ? `<span class="rec-chev">${icon('right', 16)}</span>` : ''}
  </button>`;
  if (!edit) return inner;
  return `<div class="swipe"><button type="button" class="swipe-del" data-store="${edit.store}" data-id="${edit.id}" aria-label="削除">${icon('trash', 18)}<span>削除</span></button>${inner}</div>`;
}

const DELETE_LABEL = { workouts: '筋トレの記録を削除しました', cardio: '有酸素運動の記録を削除しました', meals: '食事の記録を削除しました', body: '身体測定の記録を削除しました', daily: '歩数・活動の記録を削除しました' };
onSwipeDelete(async (storeName, id) => {
  const rec = S[storeName] && S[storeName].find((r) => r.id === id);
  if (rec) await removeWithUndo(storeName, rec, DELETE_LABEL[storeName] || '削除しました');
});

export function workoutRow(w) {
  return row({ ic: 'dumbbell', title: esc(w.exerciseName), sub: workoutText(w), right: `${fmtNum(workoutKcal(w))}<small>kcal</small>`, attrs: `data-edit="workouts" data-id="${w.id}"`, edit: { store: 'workouts', id: w.id } });
}
export function cardioRow(c) {
  const k = cardioKind(c.kind);
  return row({ ic: k.icon, title: c.label ? esc(c.label) : k.name, sub: `${cardioText(c)}${c.source === 'health' ? ' ・ <span class="src-tag">Apple Watch</span>' : ''}`, right: `${fmtNum(cardioRecordKcal(c))}<small>kcal</small>`, attrs: `data-edit="cardio" data-id="${c.id}"`, edit: { store: 'cardio', id: c.id }, color: 'var(--blue)' });
}
export function mealRow(m) {
  return row({ ic: SLOT_ICON[m.slot] || 'meal', title: m.slot === 'protein' ? 'プロテイン' : (esc(m.content) || SLOT_LABEL[m.slot]), sub: `${SLOT_LABEL[m.slot] || ''}${m.fat ? ` ・ 脂質${fmtNum(m.fat, 1)}g` : ''}${m.kcal ? ` ・ ${fmtNum(m.kcal)}kcal` : ''}`, right: `${fmtNum(m.protein || 0, 1)}<small>g</small>`, attrs: `data-edit="meals" data-id="${m.id}"`, edit: { store: 'meals', id: m.id }, color: 'var(--gold-deep)' });
}
export function bodyRow(b) {
  const parts = bodyText(b).split(' ・ ');
  const title = b.weight ? parts.shift() : parts.shift();
  const rest = parts.join(' ・ ');
  const sub = [rest, b.note ? esc(b.note) : (rest ? '' : '身体測定')].filter(Boolean).join('<br>');
  return row({ ic: 'scale', title, sub, attrs: `data-edit="body" data-id="${b.id}"`, edit: { store: 'body', id: b.id }, color: 'var(--sage)' });
}

/** data-edit 属性のついた行をタップしたときに編集画面を開く */
export function handleEditClick(e) {
  const el = e.target.closest('[data-edit]');
  if (!el) return false;
  const st = el.dataset.edit;
  const rec = S[st].find((r) => r.id === el.dataset.id);
  if (!rec) return true;
  if (st === 'workouts') editWorkout(rec);
  else if (st === 'cardio') editCardio(rec);
  else if (st === 'meals') mealEditor({ rec });
  else if (st === 'body') bodyEditor({ rec });
  else if (st === 'daily') dailyEditor({ rec });
  return true;
}

/**
 * ヘルスケアから取り込んだ記録を消したとき、次の取り込みで復活しないように覚えておく
 * meta.healthSkip = { cardio: [{key,date,kind,label,minutes}], body: [日付], daily: [日付] }
 */
async function rememberSkip(storeName, rec, on) {
  if (rec.source !== 'health' || !['cardio', 'body', 'daily'].includes(storeName)) return;
  const skip = { cardio: [], body: [], daily: [], ...(S.meta.healthSkip || {}) };
  if (storeName === 'cardio') {
    skip.cardio = skip.cardio.filter((x) => x.key !== rec.healthKey);
    if (on) skip.cardio.push({ key: rec.healthKey, date: rec.date, kind: rec.kind, label: rec.label || '', minutes: rec.minutes || 0 });
    skip.cardio = skip.cardio.slice(-500);
  } else {
    skip[storeName] = skip[storeName].filter((d) => d !== rec.date);
    if (on) skip[storeName].push(rec.date);
    skip[storeName] = skip[storeName].slice(-1000);
  }
  await store.setMeta({ healthSkip: skip });
}

/** 削除して「取り消す」を表示 */
export async function removeWithUndo(storeName, rec, label = '削除しました') {
  await store.deleteRecord(storeName, rec.id);
  await rememberSkip(storeName, rec, true);
  await notify({ type: 'delete', silentXP: true });
  toast(label, {
    action: {
      label: '取り消す',
      onClick: async () => { await store.saveRecord(storeName, rec); await rememberSkip(storeName, rec, false); await notify({ message: '元に戻しました', silentXP: true }); },
    },
  });
}

function deleteButton() {
  return `<button type="button" class="btn btn-text-danger" data-del>${icon('trash', 16)}削除する</button>`;
}

/* ---------- 筋トレ ---------- */
export function editWorkout(w) {
  const ex = exerciseById(w.exerciseId);
  const unit = w.unit || 'reps';
  const useWeight = (ex && ex.useWeight) || !!w.weight;
  const repVals = unit === 'sec' ? [20, 30, 45, 60, 90, 120] : [5, 8, 10, 12, 15, 20, 30];
  openSheet({
    title: esc(w.exerciseName),
    html: `<form class="form" onsubmit="return false">
      <div class="field"><span class="field-label">日付</span>${dateField('date', w.date)}</div>
      <div class="field"><span class="field-label">${unit === 'sec' ? '時間（1セット）' : '回数（1セット）'}</span>
        ${stepper('reps', w.reps, { step: unit === 'sec' ? 5 : 1, min: 1, max: 1000, unit: unitLabel(unit) })}
        ${chips('reps', repVals, w.reps)}</div>
      <div class="field"><span class="field-label">セット数</span>
        ${stepper('sets', w.sets, { step: 1, min: 1, max: 20, unit: 'セット' })}
        ${chips('sets', [1, 2, 3, 4, 5], w.sets)}</div>
      ${useWeight ? `<div class="field"><span class="field-label">重量 <em>任意</em></span>${stepper('weight', w.weight, { step: 0.5, min: 0, max: 300, unit: 'kg', decimals: 1, placeholder: '0' })}</div>` : ''}
      <div class="sheet-actions">${deleteButton()}<button type="button" class="btn btn-primary" data-save>保存する</button></div>
    </form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        if (e.target.closest('[data-save]')) {
          const reps = num(body, 'reps'); const sets = num(body, 'sets');
          if (!reps || !sets) { toast('回数とセット数を入力してください'); return; }
          await store.saveRecord('workouts', { ...w, date: val(body, 'date') || w.date, reps, sets, weight: useWeight ? (num(body, 'weight') || null) : null });
          close();
          await notify({ message: '記録を更新しました', silentXP: true });
        } else if (e.target.closest('[data-del]')) {
          close();
          await removeWithUndo('workouts', w, `${esc(w.exerciseName)}の記録を削除しました`);
        }
      };
    },
  });
}

/* ---------- 有酸素運動 ---------- */
export function cardioFormHTML(c, { showDate = true } = {}) {
  return `
    ${showDate ? `<div class="field"><span class="field-label">日付</span>${dateField('date', c.date || today())}</div>` : ''}
    <div class="field"><span class="field-label">種類</span>${choice('kind', CARDIO_KINDS.map((k) => ({ value: k.id, label: k.name, icon: k.icon })), c.kind || 'walk', 'kind-choice')}</div>
    <div class="field"><span class="field-label">運動時間</span>
      ${stepper('minutes', c.minutes, { step: 5, min: 0, max: 600, unit: '分', placeholder: '0' })}
      ${chips('minutes', [10, 15, 20, 30, 45, 60], c.minutes)}</div>
    <div class="field"><span class="field-label">距離 <em>任意</em></span>
      ${stepper('distanceKm', c.distanceKm, { step: 0.5, min: 0, max: 300, unit: 'km', decimals: 1, placeholder: '0' })}
      ${chips('distanceKm', [1, 2, 3, 5, 10], c.distanceKm)}</div>
    <div class="estimate" data-estimate></div>`;
}

export function updateCardioEstimate(root) {
  const kind = val(root, 'kind') || 'walk';
  const minutes = num(root, 'minutes') || 0;
  const km = num(root, 'distanceKm') || 0;
  const date = val(root, 'date') || today();
  const kcal = cardioKcal(kind, minutes, km, store.bodyWeightAt(date));
  const sp = speedOf(minutes, km);
  const el = root.querySelector('[data-estimate]');
  if (!el) return;
  el.innerHTML = minutes || km
    ? `${icon('flame', 16)}<span>消費カロリー目安 <strong>${fmtNum(kcal)}</strong> kcal${sp ? ` ・ 平均 ${fmtNum(sp, 1)} km/h` : ''}</span>`
    : `${icon('info', 16)}<span>時間か距離を入れると、消費カロリーを自動で計算します</span>`;
}

/** ヘルスケアから取り込んだ記録につける説明 */
function healthNote(rec) {
  if (rec.source !== 'health') return '';
  return `<div class="src-note">${icon('heart', 15)}<span>${rec.edited ? 'ヘルスケアから取り込んで、あなたが修正した記録です。' : 'ヘルスケア（Apple Watch）から取り込んだ記録です。'}ここで直した内容は、次に取り込んでも上書きされません。</span></div>`;
}

export function editCardio(c) {
  openSheet({
    title: c.label ? esc(c.label) : cardioKind(c.kind).name,
    html: `<form class="form" onsubmit="return false">${healthNote(c)}${cardioFormHTML(c)}
      <div class="field"><span class="field-label">名前 <em>任意・「その他」のとき表示</em></span>
        <input class="input" type="text" name="label" value="${esc(c.label || '')}" maxlength="20" placeholder="例：筋トレ・ヨガ・水泳"></div>
      <div class="field"><span class="field-label">消費カロリー <em>任意・空欄なら自動で計算</em></span>
        ${stepper('kcal', c.kcal, { step: 10, min: 0, max: 5000, unit: 'kcal', placeholder: '' })}
        ${c.kcal ? '<button type="button" class="link" data-auto-kcal>自動計算にもどす</button>' : ''}</div>
      <div class="sheet-actions">${deleteButton()}<button type="button" class="btn btn-primary" data-save>保存する</button></div></form>`,
    onMount(body, close) {
      updateCardioEstimate(body);
      body.oninput = () => updateCardioEstimate(body);
      body.onchange = () => updateCardioEstimate(body);
      body.onclick = async (e) => {
        if (e.target.closest('[data-auto-kcal]')) { body.querySelector('[name=kcal]').value = ''; toast('保存すると、時間と距離から自動で計算します', { icon: 'info' }); return; }
        if (e.target.closest('[data-save]')) {
          const minutes = num(body, 'minutes'); const km = num(body, 'distanceKm');
          if (!minutes && !km) { toast('時間か距離を入力してください'); return; }
          await store.saveRecord('cardio', {
            ...c, date: val(body, 'date') || c.date, kind: val(body, 'kind'), minutes: minutes || null, distanceKm: km || null,
            label: val(body, 'label').trim() || null, kcal: num(body, 'kcal') || null,
            ...(c.source === 'health' ? { edited: true } : {}),
          });
          close();
          await notify({ message: '記録を更新しました', silentXP: true });
        } else if (e.target.closest('[data-del]')) {
          close();
          await removeWithUndo('cardio', c, '有酸素運動の記録を削除しました');
        }
      };
    },
  });
}

/* ---------- 歩数・活動（1日ごと） ---------- */
export function dailyEditor({ rec = null, date = today() } = {}) {
  if (!rec) rec = (S.daily || []).find((x) => x.date === date) || null;
  const isNew = !rec;
  const d = rec || { id: `d-${date}`, date, steps: null, activeKcal: null, source: 'manual' };
  openSheet({
    title: isNew ? '歩数・活動を記録' : '歩数・活動の修正',
    subtitle: fmtDateLong(d.date),
    html: `<form class="form" onsubmit="return false">${healthNote(d)}
      <div class="field"><span class="field-label">歩数</span>
        ${stepper('steps', d.steps, { step: 500, min: 0, max: 100000, unit: '歩', placeholder: '0' })}
        ${chips('steps', [3000, 5000, 8000, 10000], d.steps, { labels: ['3千', '5千', '8千', '1万'] })}</div>
      <div class="field"><span class="field-label">アクティブカロリー <em>任意</em></span>
        ${stepper('activeKcal', d.activeKcal, { step: 10, min: 0, max: 5000, unit: 'kcal', placeholder: '' })}
        <p class="hint">歩いたり動いたりして使ったカロリーです。Apple Watchの「ムーブ」の数字と同じものです。空欄にすると、記録した運動から計算します。</p></div>
      ${isNew ? `<div class="field"><span class="field-label">日付</span>${dateField('date', d.date)}</div>` : ''}
      <div class="sheet-actions">${isNew ? '<span></span>' : deleteButton()}<button type="button" class="btn btn-primary" data-save>${isNew ? '記録する' : '保存する'}</button></div>
    </form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        if (e.target.closest('[data-save]')) {
          const steps = num(body, 'steps'); const kcal = num(body, 'activeKcal');
          if (!steps && !kcal) { toast('歩数かカロリーを入力してください'); return; }
          const dt = isNew ? (val(body, 'date') || d.date) : d.date;
          const ex = (S.daily || []).find((x) => x.date === dt);
          await store.saveRecord('daily', {
            ...(ex || d), id: `d-${dt}`, date: dt, steps: steps || null, activeKcal: kcal || null,
            source: (ex || d).source || 'manual', edited: true,
          });
          close();
          await notify({ message: isNew ? '歩数・活動を記録しました' : '記録を更新しました', silentXP: !isNew });
        } else if (e.target.closest('[data-del]')) {
          close();
          await removeWithUndo('daily', d, '歩数・活動の記録を削除しました');
        }
      };
    },
  });
}

export function dailyRow(dl) {
  return row({
    ic: 'walk', title: dl.steps ? `${fmtNum(dl.steps)}歩` : '歩数なし',
    sub: `${dl.source === 'health' ? '<span class="src-tag">ヘルスケア</span>' : '手入力'}${dl.edited && dl.source === 'health' ? ' ・ 修正済み' : ''}`,
    right: dl.activeKcal ? `${fmtNum(dl.activeKcal)}<small>kcal</small>` : '',
    attrs: `data-edit="daily" data-id="${dl.id}"`, edit: { store: 'daily', id: dl.id }, color: 'var(--blue)',
  });
}

/* ---------- 食事 ---------- */
function recentMeals(slot) {
  const seen = new Map();
  const list = S.meals.filter((m) => m.slot !== 'protein' && m.content).sort(byDateDesc);
  // 同じ枠の食事を優先
  for (const m of [...list.filter((x) => x.slot === slot), ...list]) {
    const key = m.content.trim();
    if (!seen.has(key)) seen.set(key, m);
    if (seen.size >= 8) break;
  }
  return [...seen.values()];
}

export function mealEditor({ rec = null, slot = 'breakfast', date = today() } = {}) {
  const isNew = !rec;
  const m = rec || { slot, date, content: '', protein: null, fat: null, kcal: null };
  const isShake = m.slot === 'protein';
  const recents = isNew ? recentMeals(m.slot) : [];
  openSheet({
    title: isNew ? `${SLOT_LABEL[m.slot]}を記録` : (isShake ? 'プロテイン' : `${SLOT_LABEL[m.slot]}の記録`),
    html: `<form class="form" onsubmit="return false">
      ${recents.length ? `<div class="field"><span class="field-label">最近の食事からワンタップ</span>
        <div class="suggest">${recents.map((r) => `<button type="button" class="suggest-chip" data-fill="${r.id}"><span>${esc(r.content)}</span><small>P${fmtNum(r.protein || 0, 1)}${r.fat ? ` F${fmtNum(r.fat, 1)}` : ''}</small></button>`).join('')}</div></div>` : ''}
      ${!isShake ? `<div class="field"><span class="field-label">食事内容 <em>任意</em></span>
        <input class="input" type="text" name="content" value="${esc(m.content || '')}" placeholder="例：鶏むね肉の定食" maxlength="80" enterkeyhint="done"></div>` : ''}
      <div class="field"><span class="field-label">タンパク質</span>
        ${stepper('protein', m.protein, { step: isShake ? 1 : 5, min: 0, max: 300, unit: 'g', decimals: 0, placeholder: '0' })}
        ${chips('protein', isShake ? [10, 15, 20, 25, 30] : [5, 10, 15, 20, 25, 30, 40], m.protein)}
        ${!isShake ? '<p class="hint">目安：卵1個 6g ・ 鶏むね肉100g 23g ・ 納豆1パック 7g ・ 牛乳200ml 7g ・ 魚の切り身 18g</p>' : ''}</div>
      ${!isShake ? `<div class="field"><span class="field-label">脂質 <em>任意</em></span>
        ${stepper('fat', m.fat, { step: 5, min: 0, max: 300, unit: 'g', decimals: 0, placeholder: '0' })}
        ${chips('fat', [5, 10, 15, 20, 30, 40], m.fat)}
        <p class="hint">目安：卵1個 5g ・ 鶏むね肉(皮なし)100g 2g ・ 鮭の切り身 4g ・ から揚げ3個 15g ・ ラーメン1杯 20g ・ とんかつ 35g</p></div>` : ''}
      ${!isShake ? `<div class="field"><span class="field-label">摂取カロリー <em>任意</em></span>
        ${stepper('kcal', m.kcal, { step: 50, min: 0, max: 5000, unit: 'kcal', placeholder: '0' })}</div>` : ''}
      <div class="field"><span class="field-label">日付</span>${dateField('date', m.date)}</div>
      <div class="sheet-actions">${isNew ? '<span></span>' : deleteButton()}<button type="button" class="btn btn-primary" data-save>${isNew ? '記録する' : '保存する'}</button></div>
    </form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        const fill = e.target.closest('[data-fill]');
        if (fill) {
          const r = S.meals.find((x) => x.id === fill.dataset.fill);
          if (!r) return;
          body.querySelector('[name=content]').value = r.content || '';
          const p = body.querySelector('[name=protein]'); p.value = r.protein ?? ''; p.dispatchEvent(new Event('input', { bubbles: true }));
          const k = body.querySelector('[name=kcal]'); if (k) k.value = r.kcal ?? '';
          const f = body.querySelector('[name=fat]'); if (f) { f.value = r.fat ?? ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
          body.querySelectorAll('[data-fill]').forEach((b) => b.classList.toggle('on', b === fill));
          return;
        }
        if (e.target.closest('[data-save]')) {
          const content = (val(body, 'content') || '').trim();
          const protein = num(body, 'protein');
          const kcal = num(body, 'kcal');
          const fat = num(body, 'fat');
          if (!content && !protein && !kcal && !fat) { toast('内容かタンパク質を入力してください'); return; }
          await store.saveRecord('meals', { ...m, date: val(body, 'date') || m.date, content, protein: protein || 0, fat: fat || null, kcal: kcal || null });
          close();
          await notify({ message: isNew ? `${SLOT_LABEL[m.slot]}を記録しました` : '記録を更新しました', silentXP: !isNew });
        } else if (e.target.closest('[data-del]')) {
          close();
          await removeWithUndo('meals', m, '食事の記録を削除しました');
        }
      };
    },
  });
}

/* ---------- 身体測定 ---------- */
export function lastBody(field) {
  const sorted = [...S.body].sort(byDateDesc);
  const r = sorted.find((b) => b[field]);
  return r ? r[field] : null;
}

export function bodyEditor({ rec = null, date = today() } = {}) {
  // 同じ日の記録があれば、それを修正する（1日1件にまとめる）
  if (!rec) rec = S.body.filter((x) => x.date === date).sort(byDateDesc)[0] || null;
  const isNew = !rec;
  const b = rec || { date, weight: lastBody('weight') || (S.profile && S.profile.weight), bodyFat: lastBody('bodyFat'), muscle: lastBody('muscle'), waist: lastBody('waist') };
  openSheet({
    title: isNew ? '身体測定を記録' : '身体測定の記録',
    html: `<form class="form" onsubmit="return false">
      ${isNew ? '<p class="hint top">前回の値が入っています。変わったところだけ調整してください。測っていない項目は空欄でOK。</p>' : healthNote(b)}
      <div class="field"><span class="field-label">体重</span>${stepper('weight', b.weight, { step: 0.1, min: 20, max: 250, unit: 'kg', decimals: 1, placeholder: '65.0' })}</div>
      <div class="field"><span class="field-label">体脂肪率 <em>任意</em></span>${stepper('bodyFat', b.bodyFat, { step: 0.1, min: 2, max: 60, unit: '%', decimals: 1, placeholder: '' })}</div>
      <div class="field"><span class="field-label">筋肉量 <em>任意</em></span>${stepper('muscle', b.muscle, { step: 0.1, min: 5, max: 120, unit: 'kg', decimals: 1, placeholder: '' })}</div>
      <div class="field"><span class="field-label">ウエスト <em>任意</em></span>${stepper('waist', b.waist, { step: 0.5, min: 40, max: 200, unit: 'cm', decimals: 1, placeholder: '' })}</div>
      <div class="field"><span class="field-label">日付</span>${dateField('date', b.date)}</div>
      <div class="sheet-actions">${isNew ? '<span></span>' : deleteButton()}<button type="button" class="btn btn-primary" data-save>${isNew ? '記録する' : '保存する'}</button></div>
    </form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        if (e.target.closest('[data-save]')) {
          const rec2 = { ...b, date: val(body, 'date') || b.date, weight: num(body, 'weight'), bodyFat: num(body, 'bodyFat'), muscle: num(body, 'muscle'), waist: num(body, 'waist'), ...(b.source === 'health' ? { edited: true, note: 'ヘルスケアから（修正済み）' } : {}) };
          if (!rec2.weight && !rec2.bodyFat && !rec2.muscle && !rec2.waist) { toast('どれか1つ入力してください'); return; }
          await store.saveRecord('body', rec2);
          close();
          await notify({ message: isNew ? '身体測定を記録しました' : '記録を更新しました', silentXP: !isNew });
        } else if (e.target.closest('[data-del]')) {
          close();
          await removeWithUndo('body', b, '身体測定の記録を削除しました');
        }
      };
    },
  });
}

/* ---------- 1日の記録まとめ ---------- */
export function dayRecordsHTML(date) {
  const ws = S.workouts.filter((w) => w.date === date).sort(byDateDesc);
  const cs = S.cardio.filter((c) => c.date === date).sort(byDateDesc);
  const ms = S.meals.filter((m) => m.date === date).sort(byDateDesc);
  const bs = S.body.filter((b) => b.date === date).sort(byDateDesc);
  const ps = S.photos.filter((p) => p.date === date);
  const dl = (S.daily || []).find((x) => x.date === date);
  const parts = [];
  if (dl && (dl.steps || dl.activeKcal)) parts.push(`<h3 class="mini-h">歩数・活動</h3><div class="rec-list">${dailyRow(dl)}</div>`);
  if (ws.length) parts.push(`<h3 class="mini-h">筋トレ</h3><div class="rec-list">${ws.map(workoutRow).join('')}</div>`);
  if (cs.length) parts.push(`<h3 class="mini-h">有酸素運動</h3><div class="rec-list">${cs.map(cardioRow).join('')}</div>`);
  if (ms.length) parts.push(`<h3 class="mini-h">食事</h3><div class="rec-list">${ms.map(mealRow).join('')}</div>`);
  if (bs.length) parts.push(`<h3 class="mini-h">身体測定</h3><div class="rec-list">${bs.map(bodyRow).join('')}</div>`);
  if (ps.length) parts.push(`<h3 class="mini-h">写真</h3><p class="muted small">${ps.length}枚の写真（GROWTH → 写真 で確認できます）</p>`);
  return parts.join('');
}

export function openDaySheet(date, game) {
  const xp = game ? (game.dayInfo.get(date)?.total || 0) : 0;
  const inner = dayRecordsHTML(date);
  openSheet({
    title: fmtDateLong(date),
    html: `
      ${xp ? `<p class="day-xp"><span class="xp-pill">+${xp} XP</span> この日の積み重ね</p>` : ''}
      ${inner || '<div class="empty-soft">この日の記録はありません。<br>休んだ日も、身体が回復して成長している大切な日です。</div>'}
      <h3 class="mini-h">この日に記録する</h3>
      <div class="quick-grid">
        <a class="quick" href="#training?date=${date}&mode=strength" data-close>${icon('dumbbell', 20)}<span>筋トレ</span></a>
        <a class="quick" href="#training?date=${date}&mode=cardio" data-close>${icon('run', 20)}<span>有酸素</span></a>
        <a class="quick" href="#nutrition?date=${date}" data-close>${icon('meal', 20)}<span>食事</span></a>
        <button type="button" class="quick" data-body>${icon('scale', 20)}<span>測定</span></button>
      </div>
      <button type="button" class="text-btn" data-daily>${icon('walk', 15)}この日の歩数・活動を${(S.daily || []).some((x) => x.date === date) ? '修正する' : '入力する'}</button>`,
    onMount(body, close) {
      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-body]')) { close(); bodyEditor({ date }); return; }
        if (e.target.closest('[data-daily]')) { close(); dailyEditor({ date }); return; }
        if (e.target.closest('[data-edit]')) { close(); handleEditClick(e); }
      });
    },
  });
}

export async function confirmDelete(message) {
  return confirmDialog(message, { ok: '削除する', danger: true });
}

/** 記録がないときの表示 */
export function emptyState(ic, title, sub = '') {
  return `<div class="empty"><span class="empty-ic">${icon(ic, 24)}</span><strong>${title}</strong>${sub ? `<p>${sub}</p>` : ''}</div>`;
}
