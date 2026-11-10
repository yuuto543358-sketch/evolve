// 画面部品（ボトムシート・トースト・確認ダイアログ・ステッパー・チップ・スワイプ削除など）
import { icon, logoMark } from './icons.js';
import { esc, today, fmtDate, relDay } from './util.js';

const overlayRoot = () => document.getElementById('overlay-root');

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let openCount = 0;
let savedScrollY = 0;
function lockScroll(on) {
  const before = openCount;
  openCount = Math.max(0, openCount + (on ? 1 : -1));
  if (before === 0 && openCount > 0) {
    // iOSでも背景がスクロールしないよう固定する
    savedScrollY = window.scrollY;
    document.body.style.top = `-${savedScrollY}px`;
    document.body.classList.add('no-scroll');
  } else if (before > 0 && openCount === 0) {
    document.body.classList.remove('no-scroll');
    document.body.style.top = '';
    window.scrollTo(0, savedScrollY);
  }
}

/** 軽い振動（対応端末のみ） */
export function haptic(ms = 8) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* 非対応 */ }
}

/* ---------- ボトムシート ---------- */

/** 下から出てくるシート。上部をつかんで下に引くと閉じられます */
export function openSheet({ title = '', html = '', onMount, wide = false, onClose, subtitle = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet ${wide ? 'sheet-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title.replace(/<[^>]+>/g, ''))}">
      <div class="sheet-grab">
        <div class="sheet-handle" aria-hidden="true"></div>
        <header class="sheet-head">
          <div class="sheet-titles"><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>
          <button type="button" class="sheet-close" data-close aria-label="閉じる">${icon('x', 16)}</button>
        </header>
      </div>
      <div class="sheet-body">${html}</div>
    </div>`;
  overlayRoot().appendChild(wrap);
  lockScroll(true);
  const sheet = wrap.querySelector('.sheet');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    sheet.style.transform = '';
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    lockScroll(false);
    setTimeout(() => wrap.remove(), 320);
    if (onClose) onClose();
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });

  // 下に引いて閉じる
  const grab = wrap.querySelector('.sheet-grab');
  let startY = 0; let dy = 0; let t0 = 0; let dragging = false;
  grab.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true; startY = e.clientY; dy = 0; t0 = performance.now();
    sheet.classList.add('dragging');
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = e.clientY - startY;
    const y = dy > 0 ? dy : dy / 6; // 上方向は少しだけ
    sheet.style.transform = `translateY(${y}px)`;
    wrap.style.setProperty('--fade', String(Math.max(0, 1 - dy / 500)));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 140 || (dy > 40 && v > 0.6)) close();
    else { sheet.style.transform = ''; wrap.style.removeProperty('--fade'); }
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);

  const body = wrap.querySelector('.sheet-body');
  if (onMount) onMount(body, close);
  animateUI(body);
  return { el: body, close };
}

/* ---------- 確認ダイアログ（iOSのアラート風） ---------- */
export function confirmDialog(message, { ok = 'OK', cancel = 'キャンセル', danger = false, title = '' } = {}) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'alert-wrap';
    wrap.innerHTML = `
      <div class="alert" role="alertdialog" aria-modal="true">
        <div class="alert-body">${title ? `<h3>${title}</h3>` : ''}<p>${message}</p></div>
        <div class="alert-actions">
          <button type="button" data-v="0">${cancel}</button>
          <button type="button" class="${danger ? 'danger' : 'strong'}" data-v="1">${ok}</button>
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
      setTimeout(() => wrap.remove(), 220);
      resolve(b.dataset.v === '1');
    });
  });
}

/* ---------- トースト（画面上部に出る通知） ---------- */
export function toast(message, { xp = 0, action = null, duration = 2600, icon: ic = null } = {}) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `
    ${xp > 0 ? `<span class="xp-pill">+${xp}<small>XP</small></span>` : `<span class="toast-ic">${icon(ic || 'check', 16)}</span>`}
    <span class="toast-msg">${message}</span>
    ${action ? `<button type="button" class="toast-act">${esc(action.label)}</button>` : ''}`;
  host.prepend(t);
  const shown = host.querySelectorAll('.toast:not(.leaving)');
  for (let i = 2; i < shown.length; i++) { const old = shown[i]; old.classList.add('leaving'); old.classList.remove('show'); setTimeout(() => old.remove(), 300); }
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  let timer;
  const remove = () => { clearTimeout(timer); t.classList.add('leaving'); t.classList.remove('show'); setTimeout(() => t.remove(), 320); };
  if (action) t.querySelector('.toast-act').addEventListener('click', () => { action.onClick(); remove(); });
  // 上にスワイプで消す
  let sy = null;
  t.addEventListener('pointerdown', (e) => { sy = e.clientY; });
  t.addEventListener('pointerup', (e) => { if (sy !== null && sy - e.clientY > 20) remove(); sy = null; });
  timer = setTimeout(remove, action ? Math.max(duration, 4500) : duration);
}

/* ---------- 演出 ---------- */
export function celebrateLevelUp(level, title, stage) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'levelup-wrap';
    const sparks = Array.from({ length: 24 }, (_, i) => `<i style="--a:${i * 15}deg;--d:${(i % 4) * 0.06}s;--r:${100 + (i % 3) * 30}px"></i>`).join('');
    wrap.innerHTML = `
      <div class="levelup">
        <div class="lu-glow"></div>
        <div class="lu-burst">${sparks}</div>
        <div class="lu-mark">${logoMark(92, stage.index)}</div>
        <p class="lu-kicker">LEVEL UP</p>
        <p class="lu-level"><span>Lv</span><strong class="num">${level}</strong></p>
        <p class="lu-title">称号「${esc(title)}」</p>
        <p class="lu-msg">昨日の自分を、またひとつ超えました。</p>
        <button type="button" class="btn btn-light btn-block btn-lg">つづける</button>
      </div>`;
    overlayRoot().appendChild(wrap);
    lockScroll(true);
    haptic([20, 40, 30]);
    requestAnimationFrame(() => wrap.classList.add('open'));
    const close = () => {
      wrap.classList.remove('open');
      lockScroll(false);
      setTimeout(() => { wrap.remove(); resolve(); }, 300);
    };
    wrap.querySelector('button').addEventListener('click', close);
  });
}

export function celebrateAchievement(ach) {
  toast(`実績「${esc(ach.name)}」を達成${ach.xp ? `<b class="toast-xp">+${ach.xp}XP</b>` : ''}`, { duration: 3600, icon: 'star' });
}

/* ---------- 入力部品 ---------- */

/** −/＋ボタン付き数値入力（長押しで連続変更） */
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

export function chips(forName, values, current, { labels = null, cls = '' } = {}) {
  return `<div class="chips ${cls}" data-chips-for="${forName}">${values.map((v, i) => `
    <button type="button" class="chip ${String(v) === String(current) ? 'on' : ''}" data-v="${v}">${labels ? labels[i] : v}</button>`).join('')}</div>`;
}

export function choice(name, options, current, cls = '') {
  return `<div class="choice ${cls}" data-choice="${name}">
    <input type="hidden" name="${name}" value="${esc(current ?? '')}">
    ${options.map((o) => `<button type="button" class="chip ${String(o.value) === String(current) ? 'on' : ''}" data-v="${esc(o.value)}">${o.icon ? icon(o.icon, 18) : ''}<span>${o.label}</span></button>`).join('')}
  </div>`;
}

/** セグメント（選択中の背景がスライドして動く） */
const segPrev = new Map();
export function segmented(name, options, current, cls = '') {
  const idx = Math.max(0, options.findIndex((o) => o.value === current));
  const from = segPrev.has(name) ? segPrev.get(name) : idx;
  return `<div class="segmented ${cls}" role="tablist" data-seg="${name}" style="--n:${options.length}">
    <span class="seg-thumb" data-seg-name="${name}" data-to="${idx}" style="--i:${from}"></span>
    ${options.map((o) => `
    <button type="button" role="tab" class="${o.value === current ? 'on' : ''}" data-v="${o.value}" aria-selected="${o.value === current}">${o.label}</button>`).join('')}</div>`;
}

/** 数字のカウントアップ用 */
const countPrev = new Map();
export function countAttr(key, value) {
  return `data-count="${value}" data-count-key="${key}"`;
}

/** 描画後に呼ぶ：セグメントのスライド・数字のカウントアップ */
export function animateUI(root = document) {
  const thumbs = root.querySelectorAll('.seg-thumb');
  if (thumbs.length) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      thumbs.forEach((t) => {
        t.style.setProperty('--i', t.dataset.to);
        segPrev.set(t.dataset.segName, Number(t.dataset.to));
      });
    }));
  }
  root.querySelectorAll('[data-count]').forEach((el) => {
    const key = el.dataset.countKey;
    const to = Number(el.dataset.count);
    const from = countPrev.has(key) ? countPrev.get(key) : 0;
    countPrev.set(key, to);
    const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
    if (from === to || reduceMotion()) { el.textContent = fmt(to); return; }
    const dur = Math.min(1100, 400 + Math.abs(to - from) * 2);
    const t0 = performance.now();
    el.textContent = fmt(from);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** 日付選択（ネイティブのカレンダーを使う） */
function dateText(value) {
  return value === today() ? `今日 ${fmtDate(value)}` : `${relDay(value)}${relDay(value) === fmtDate(value) ? '' : ' ' + fmtDate(value)}`;
}
export function dateField(name, value) {
  return `<label class="date-pill">
    ${icon('calendar', 15)}<span class="date-text">${dateText(value)}</span>${icon('down', 13)}
    <input type="date" name="${name}" value="${value}" max="${today()}" aria-label="日付">
  </label>`;
}

export function setDateFieldText(label, value) {
  const t = label.querySelector('.date-text');
  if (t) t.textContent = dateText(value);
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

function stepOnce(btn) {
  const box = btn.closest('.stepper');
  const input = box.querySelector('input');
  const step = Number(box.dataset.step) || 1;
  const min = Number(box.dataset.min);
  const max = Number(box.dataset.max);
  const dec = Number(box.dataset.decimals) || 0;
  const base = input.value === '' ? (Number(input.placeholder) || 0) : Number(input.value);
  let v = base + step * Number(btn.dataset.dir);
  v = Math.min(max, Math.max(min, Math.round(v / step) * step));
  input.value = v.toFixed(dec);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const field = box.querySelector('.st-field');
  field.classList.remove('bump'); void field.offsetWidth; field.classList.add('bump');
}

/* ---------- スワイプで削除 ---------- */
let swipeDeleteHandler = null;
export function onSwipeDelete(fn) { swipeDeleteHandler = fn; }

function closeSwipes(except) {
  document.querySelectorAll('.swipe.open').forEach((s) => {
    if (s !== except) { s.classList.remove('open'); s.querySelector('.swipe-front').style.transform = ''; }
  });
}

function installSwipe() {
  let st = null;
  let suppressClick = false;
  document.addEventListener('pointerdown', (e) => {
    const front = e.target.closest('.swipe-front');
    const swipe = front && front.closest('.swipe');
    if (!e.target.closest('.swipe')) closeSwipes(null);
    if (!front || e.pointerType === 'mouse' && e.button !== 0) return;
    closeSwipes(swipe);
    st = { front, swipe, x: e.clientX, y: e.clientY, base: swipe.classList.contains('open') ? -84 : 0, dir: null, dx: 0, id: e.pointerId };
  }, { passive: true });
  document.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x; const dy = e.clientY - st.y;
    if (!st.dir) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { st.dir = 'h'; st.front.classList.add('dragging'); }
      else if (Math.abs(dy) > 8) { st = null; return; }
      else return;
    }
    st.dx = dx;
    let x = st.base + dx;
    if (x > 0) x = x / 5;
    if (x < -84) x = -84 + (x + 84) / 3;
    st.front.style.transform = `translateX(${x}px)`;
  }, { passive: true });
  const end = () => {
    if (!st) return;
    if (st.dir === 'h') {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
      st.front.classList.remove('dragging');
      const x = st.base + st.dx;
      const open = x < -42;
      st.swipe.classList.toggle('open', open);
      st.front.style.transform = open ? 'translateX(-84px)' : '';
      if (open) haptic(6);
    }
    st = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  document.addEventListener('click', (e) => {
    if (suppressClick && e.target.closest('.swipe')) { e.stopPropagation(); e.preventDefault(); suppressClick = false; return; }
    const del = e.target.closest('.swipe-del');
    if (del) {
      e.stopPropagation();
      const sw = del.closest('.swipe');
      sw.classList.add('removing');
      setTimeout(() => { if (swipeDeleteHandler) swipeDeleteHandler(del.dataset.store, del.dataset.id); }, 180);
      return;
    }
    // 開いている行をタップしたら閉じるだけ
    const openFront = e.target.closest('.swipe.open .swipe-front');
    if (openFront) { e.stopPropagation(); e.preventDefault(); closeSwipes(null); }
  }, true);
}

/** アプリ全体で一度だけ登録するイベント */
export function installGlobalHandlers() {
  // ステッパーの長押しで連続変更
  let holdTimer = null; let repeatTimer = null; let held = false;
  const stopHold = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); holdTimer = repeatTimer = null; };
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.st-btn');
    if (!btn) return;
    held = false;
    holdTimer = setTimeout(() => {
      held = true;
      repeatTimer = setInterval(() => stepOnce(btn), 70);
    }, 420);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => document.addEventListener(t, stopHold, true));

  document.addEventListener('click', (e) => {
    const st = e.target.closest('.st-btn');
    if (st) {
      if (held) { held = false; return; }
      stepOnce(st);
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
      haptic(5);
      return;
    }
    const ch = e.target.closest('[data-choice] .chip');
    if (ch) {
      const group = ch.closest('[data-choice]');
      group.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === ch));
      const input = group.querySelector('input[type=hidden]');
      input.value = ch.dataset.v;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      haptic(5);
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
  installSwipe();
}

/* ---------- 画面の見出し ---------- */

/** iOS風の大きなタイトル */
export function largeTitle({ kicker = '', title = '', short = '', right = '' }) {
  return `<header class="large-title">
    <div class="lt-text">${kicker ? `<p class="lt-kicker">${kicker}</p>` : ''}<h1 data-short="${esc(short || title)}">${title}</h1></div>
    ${right ? `<div class="lt-right">${right}</div>` : ''}
  </header>`;
}

/** セクションの見出し（カードの外側） */
export function secH(title, right = '') {
  return `<div class="sec-h"><h2>${title}</h2>${right}</div>`;
}
