// 画面部品（ボトムシート・トースト・確認ダイアログ・ステッパー・チップ）
import { icon, logoMark } from './icons.js';
import { esc, today, fmtDate, relDay } from './util.js';

const overlayRoot = () => document.getElementById('overlay-root');

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

let openCount = 0;
function lockScroll(on) {
  openCount = Math.max(0, openCount + (on ? 1 : -1));
  document.body.classList.toggle('no-scroll', openCount > 0);
}

/** 下から出てくるシート */
export function openSheet({ title = '', html = '', onMount, wide = false, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet ${wide ? 'sheet-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-handle" aria-hidden="true"></div>
      <header class="sheet-head">
        <h2>${title}</h2>
        <button type="button" class="icon-btn" data-close aria-label="閉じる">${icon('x', 20)}</button>
      </header>
      <div class="sheet-body">${html}</div>
    </div>`;
  overlayRoot().appendChild(wrap);
  lockScroll(true);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    lockScroll(false);
    setTimeout(() => wrap.remove(), 260);
    if (onClose) onClose();
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  const body = wrap.querySelector('.sheet-body');
  if (onMount) onMount(body, close);
  return { el: body, close };
}

/** 確認ダイアログ */
export function confirmDialog(message, { ok = 'OK', cancel = 'キャンセル', danger = false } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true">
        <p>${message}</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-ghost" data-v="0">${cancel}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1">${ok}</button>
        </div>
      </div>`;
    overlayRoot().appendChild(wrap);
    lockScroll(true);
    requestAnimationFrame(() => wrap.classList.add('open'));
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      wrap.classList.remove('open');
      lockScroll(false);
      setTimeout(() => wrap.remove(), 200);
      resolve(b.dataset.v === '1');
    });
  });
}

/** 画面下に短いメッセージを表示 */
export function toast(message, { xp = 0, action = null, duration = 2600 } = {}) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    ${xp > 0 ? `<span class="xp-pill">+${xp} XP</span>` : ''}
    <span class="toast-msg">${message}</span>
    ${action ? `<button type="button" class="toast-act">${esc(action.label)}</button>` : ''}`;
  host.appendChild(t);
  // 同時に表示するのは最大2つまで
  const shown = host.querySelectorAll('.toast:not(.leaving)');
  if (shown.length > 2) { const old = shown[0]; old.classList.add('leaving'); old.classList.remove('show'); setTimeout(() => old.remove(), 300); }
  requestAnimationFrame(() => t.classList.add('show'));
  const remove = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  if (action) t.querySelector('.toast-act').addEventListener('click', () => { action.onClick(); remove(); });
  setTimeout(remove, action ? Math.max(duration, 4500) : duration);
}

/** レベルアップ演出 */
export function celebrateLevelUp(level, title, stage) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'levelup-wrap';
    const sparks = Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * 20}deg;--d:${(i % 3) * 0.08}s"></i>`).join('');
    wrap.innerHTML = `
      <div class="levelup">
        <div class="lu-burst">${sparks}</div>
        <div class="lu-mark">${logoMark(88, stage.index)}</div>
        <p class="lu-kicker">LEVEL UP</p>
        <p class="lu-level">Lv <strong>${level}</strong></p>
        <p class="lu-title">称号「${esc(title)}」</p>
        <p class="lu-msg">昨日の自分を、またひとつ超えました。</p>
        <button type="button" class="btn btn-primary btn-block">つづける</button>
      </div>`;
    overlayRoot().appendChild(wrap);
    lockScroll(true);
    if (navigator.vibrate) try { navigator.vibrate([30, 40, 30]); } catch { /* ignore */ }
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => {
      wrap.classList.remove('open');
      lockScroll(false);
      setTimeout(() => { wrap.remove(); resolve(); }, 300);
    };
    wrap.querySelector('button').addEventListener('click', close);
  });
}

/** 実績達成の演出（控えめ） */
export function celebrateAchievement(ach) {
  toast(`実績「${esc(ach.name)}」を達成${ach.xp ? `（+${ach.xp}XP）` : ''}`, { duration: 3400 });
}

/* ---------- 入力部品 ---------- */

/** −/＋ボタン付き数値入力 */
export function stepper(name, value, { step = 1, min = 0, max = 9999, unit = '', decimals = 0, placeholder = '' } = {}) {
  const v = value === null || value === undefined || value === '' ? '' : Number(value).toFixed(decimals);
  return `
    <div class="stepper" data-step="${step}" data-min="${min}" data-max="${max}" data-decimals="${decimals}">
      <button type="button" class="st-btn" data-dir="-1" aria-label="減らす">${icon('minus', 18)}</button>
      <label class="st-field">
        <input type="number" name="${name}" value="${v}" inputmode="decimal" step="any" min="${min}" max="${max}" placeholder="${esc(placeholder)}">
        ${unit ? `<span class="st-unit">${unit}</span>` : ''}
      </label>
      <button type="button" class="st-btn" data-dir="1" aria-label="増やす">${icon('plus', 18)}</button>
    </div>`;
}

/** ワンタップで値を選べるチップ */
export function chips(forName, values, current, { labels = null, cls = '' } = {}) {
  return `<div class="chips ${cls}" data-chips-for="${forName}">${values.map((v, i) => `
    <button type="button" class="chip ${String(v) === String(current) ? 'on' : ''}" data-v="${v}">${labels ? labels[i] : v}</button>`).join('')}</div>`;
}

/** 単一選択（ラジオ風チップ）。hidden input に値が入る */
export function choice(name, options, current, cls = '') {
  return `<div class="choice ${cls}" data-choice="${name}">
    <input type="hidden" name="${name}" value="${esc(current ?? '')}">
    ${options.map((o) => `<button type="button" class="chip ${String(o.value) === String(current) ? 'on' : ''}" data-v="${esc(o.value)}">${o.icon ? icon(o.icon, 18) : ''}<span>${o.label}</span></button>`).join('')}
  </div>`;
}

export function segmented(name, options, current) {
  return `<div class="segmented" role="tablist" data-seg="${name}">${options.map((o) => `
    <button type="button" role="tab" class="${o.value === current ? 'on' : ''}" data-v="${o.value}" aria-selected="${o.value === current}">${o.label}</button>`).join('')}</div>`;
}

/** 日付選択（ネイティブのカレンダーを使う） */
export function dateField(name, value) {
  return `<label class="date-pill">
    ${icon('calendar', 16)}<span class="date-text">${value === today() ? `今日 ${fmtDate(value)}` : `${relDay(value)}${relDay(value) === fmtDate(value) ? '' : ' ' + fmtDate(value)}`}</span>${icon('down', 14)}
    <input type="date" name="${name}" value="${value}" max="${today()}" aria-label="日付">
  </label>`;
}

export function setDateFieldText(label, value) {
  const t = label.querySelector('.date-text');
  if (t) t.textContent = value === today() ? `今日 ${fmtDate(value)}` : `${relDay(value)}${relDay(value) === fmtDate(value) ? '' : ' ' + fmtDate(value)}`;
}

export function num(root, name) {
  const el = root.querySelector(`[name="${name}"]`);
  if (!el || el.value === '') return null;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : null;
}

export function val(root, name) {
  const el = root.querySelector(`[name="${name}"]`);
  return el ? el.value : '';
}

function syncChips(input) {
  const scope = input.closest('form, .sheet-body, .scope, #view') || document;
  scope.querySelectorAll(`[data-chips-for="${input.name}"] .chip`).forEach((c) => {
    c.classList.toggle('on', input.value !== '' && Number(c.dataset.v) === Number(input.value));
  });
}

/** アプリ全体で一度だけ登録するイベント */
export function installGlobalHandlers() {
  document.addEventListener('click', (e) => {
    const st = e.target.closest('.st-btn');
    if (st) {
      const box = st.closest('.stepper');
      const input = box.querySelector('input');
      const step = Number(box.dataset.step) || 1;
      const min = Number(box.dataset.min);
      const max = Number(box.dataset.max);
      const dec = Number(box.dataset.decimals) || 0;
      const base = input.value === '' ? (Number(input.placeholder) || 0) : Number(input.value);
      let v = base + step * Number(st.dataset.dir);
      v = Math.min(max, Math.max(min, Math.round(v / step) * step));
      input.value = v.toFixed(dec);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const chip = e.target.closest('[data-chips-for] .chip');
    if (chip) {
      const group = chip.closest('[data-chips-for]');
      const scope = group.closest('form, .sheet-body, .scope, #view') || document;
      const input = scope.querySelector(`input[name="${group.dataset.chipsFor}"]`);
      if (input) {
        input.value = chip.dataset.v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
    const ch = e.target.closest('[data-choice] .chip');
    if (ch) {
      const group = ch.closest('[data-choice]');
      group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === ch));
      const input = group.querySelector('input[type=hidden]');
      input.value = ch.dataset.v;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches('input[type=number]')) syncChips(e.target);
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('.date-pill input[type=date]')) {
      if (!e.target.value) e.target.value = today();
      setDateFieldText(e.target.closest('.date-pill'), e.target.value);
    }
  });
}
