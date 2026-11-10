// 体の写真（上半身）の保存・読み込み・変遷ビューア
import * as store from './store.js';
import { S } from './store.js';
import { icon } from './icons.js';
import { haptic, toast } from './ui.js';
import { uid, today, fmtDate, fmtDateLong, diffDays, esc } from './util.js';

export const POSES = [
  { value: 'front', label: '正面' },
  { value: 'side', label: '横向き' },
  { value: 'back', label: '後ろ向き' },
];
export const poseName = (p) => (POSES.find((x) => x.value === p) || POSES[0]).label;

/** 保存サイズ（縦長 3:4） */
export const PHOTO_W = 960;
export const PHOTO_H = 1280;

const urlCache = new Map();

export function photosOf(pose) {
  return S.photos
    .filter((x) => !pose || x.pose === pose)
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : (a.date < b.date ? -1 : 1)));
}

export async function fullUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await store.getPhotoBlob(id);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urlCache.set(id, u);
  return u;
}

export function forgetUrl(id) {
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('画像を読み込めませんでした'));
    img.src = src;
  });
}

/**
 * 画像（または動画のフレーム）を中央で 3:4 に切り抜いてキャンバスに描く
 * @param {CanvasImageSource} src
 * @param {number} sw 元の幅  @param {number} sh 元の高さ
 */
export function cropToCanvas(src, sw, sh, { mirror = false, w = PHOTO_W, h = PHOTO_H } = {}) {
  const target = w / h;
  let cx = 0; let cy = 0; let cw = sw; let ch = sh;
  if (sw / sh > target) { cw = sh * target; cx = (sw - cw) / 2; } else { ch = sw / target; cy = (sh - ch) / 2; }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, w, h);
  return c;
}

function canvasToBlob(c, q) {
  return new Promise((r) => c.toBlob(r, 'image/jpeg', q));
}

/** キャンバスの写真を保存（サムネイルも作成） */
export async function savePhotoCanvas(canvas, { pose = 'front', date = today(), cam = null, guided = false } = {}) {
  const blob = await canvasToBlob(canvas, 0.85);
  const t = document.createElement('canvas');
  t.width = 240; t.height = 320;
  t.getContext('2d').drawImage(canvas, 0, 0, 240, 320);
  const thumb = t.toDataURL('image/jpeg', 0.74);
  const id = uid();
  await store.savePhotoBlob(id, await blob.arrayBuffer(), 'image/jpeg');
  return store.saveRecord('photos', {
    id, date, pose, thumb, w: canvas.width, h: canvas.height, size: blob.size, cam, guided,
  }, { silent: true });
}

/** ファイル（アルバムの写真）を 3:4 に切り抜いて保存 */
export async function savePhotoFile(file, opts) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const c = cropToCanvas(img, img.naturalWidth, img.naturalHeight);
    return await savePhotoCanvas(c, opts);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 指定日の体重（前後14日以内でいちばん近い記録） */
export function weightNear(date) {
  let best = null; let bestD = Infinity;
  for (const b of S.body) {
    if (!b.weight) continue;
    const d = Math.abs(diffDays(b.date, date));
    if (d < bestD || (d === bestD && b.date <= date)) { best = b; bestD = d; }
  }
  return best && bestD <= 14 ? Number(best.weight) : null;
}

/** 期間 [from, to] の写真、なければ近い日の写真 */
export function photoForRange(from, to, { tolerance = 7, pose = null } = {}) {
  const list = photosOf(null);
  const prefer = (arr) => arr.find((p) => p.pose === (pose || 'front')) || arr[arr.length - 1];
  const inRange = list.filter((p) => p.date >= from && p.date <= to);
  if (inRange.length) return { photo: prefer(inRange), exact: true };
  let best = null; let bestD = Infinity;
  for (const p of list) {
    const d = Math.min(Math.abs(diffDays(p.date, from)), Math.abs(diffDays(p.date, to)));
    if (d < bestD) { best = p; bestD = d; }
  }
  if (best && bestD <= tolerance) return { photo: best, exact: false };
  return { photo: null, exact: false };
}

/* =========================================================
   変遷ビューア（コマ送り再生）
   ========================================================= */
export function openPhotoViewer({ pose = null, startId = null, onEdit = null } = {}) {
  const startMeta = startId ? S.photos.find((p) => p.id === startId) : null;
  let curPose = pose || (startMeta && startMeta.pose) || 'front';
  let list = photosOf(curPose);
  if (!list.length) { toast('まだ写真がありません', { icon: 'camera' }); return; }
  let idx = startMeta ? Math.max(0, list.findIndex((p) => p.id === startMeta.id)) : list.length - 1;
  let playing = false;
  let timer = null;
  let speed = 1;
  let front = 0; // 2枚の画像を交互に使ってなめらかに切り替える

  const wrap = document.createElement('div');
  wrap.className = 'viewer';
  wrap.innerHTML = `
    <div class="vw-top">
      <button type="button" class="vw-btn" data-vw="close" aria-label="閉じる">${icon('x', 20)}</button>
      <div class="vw-poses">${POSES.map((p) => `<button type="button" data-vw-pose="${p.value}" class="${p.value === curPose ? 'on' : ''}">${p.label}</button>`).join('')}</div>
      <button type="button" class="vw-btn" data-vw="more" aria-label="この写真の操作">${icon('edit', 18)}</button>
    </div>
    <div class="vw-stage" data-vw-stage>
      <img class="vw-img on" alt="">
      <img class="vw-img" alt="">
      <div class="vw-badge"><strong data-vw-date></strong><span data-vw-day></span></div>
      <div class="vw-count" data-vw-count></div>
      <div class="vw-progress"><i data-vw-bar></i></div>
    </div>
    <div class="vw-info">
      <div class="vw-stat"><span>体重</span><b data-vw-weight>—</b></div>
      <div class="vw-stat"><span>はじめから</span><b data-vw-diff>—</b></div>
      <div class="vw-stat"><span>経過</span><b data-vw-elapsed>—</b></div>
    </div>
    <div class="vw-strip" data-vw-strip></div>
    <div class="vw-controls">
      <button type="button" class="vw-speed" data-vw="speed">1x</button>
      <button type="button" class="vw-ctl" data-vw="prev" aria-label="前の写真">${icon('left', 26)}</button>
      <button type="button" class="vw-play" data-vw="play" aria-label="再生">${playIcon()}</button>
      <button type="button" class="vw-ctl" data-vw="next" aria-label="次の写真">${icon('right', 26)}</button>
      <button type="button" class="vw-speed" data-vw="first" aria-label="最初へ">最初</button>
    </div>`;
  document.getElementById('overlay-root').appendChild(wrap);
  document.body.classList.add('viewer-open');
  requestAnimationFrame(() => wrap.classList.add('open'));

  const imgs = wrap.querySelectorAll('.vw-img');
  const $ = (s) => wrap.querySelector(s);

  function playIcon() { return '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>'; }
  function pauseIcon() { return '<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>'; }

  function renderStrip() {
    $('[data-vw-strip]').innerHTML = list.map((p, i) => `<button type="button" class="vw-thumb ${i === idx ? 'on' : ''}" data-vw-i="${i}"><img src="${p.thumb}" alt=""><span>${fmtDate(p.date, { weekday: false })}</span></button>`).join('');
  }

  async function show(i, { instant = false } = {}) {
    idx = Math.max(0, Math.min(list.length - 1, i));
    const p = list[idx];
    const next = imgs[1 - front];
    const cur = imgs[front];
    next.src = p.thumb;
    if (instant) { next.classList.add('instant'); cur.classList.add('instant'); }
    next.classList.add('on'); cur.classList.remove('on');
    front = 1 - front;
    requestAnimationFrame(() => { next.classList.remove('instant'); cur.classList.remove('instant'); });
    fullUrl(p.id).then((u) => { if (u && list[idx] === p) next.src = u; });
    const first = list[0];
    const days = diffDays(p.date, first.date);
    $('[data-vw-date]').textContent = fmtDateLong(p.date);
    $('[data-vw-day]').textContent = `DAY ${days + 1}`;
    $('[data-vw-count]').textContent = `${idx + 1} / ${list.length}`;
    $('[data-vw-bar]').style.width = `${list.length > 1 ? (idx / (list.length - 1)) * 100 : 100}%`;
    const w = weightNear(p.date); const w0 = weightNear(first.date);
    $('[data-vw-weight]').textContent = w ? `${w.toFixed(1)}kg` : '—';
    $('[data-vw-diff]').textContent = w && w0 && idx > 0 ? `${w - w0 > 0 ? '+' : w - w0 < 0 ? '−' : '±'}${Math.abs(w - w0).toFixed(1)}kg` : '—';
    $('[data-vw-elapsed]').textContent = days === 0 ? 'はじめ' : days < 60 ? `${days}日` : `${Math.round(days / 30)}か月`;
    wrap.querySelectorAll('.vw-thumb').forEach((t, k) => t.classList.toggle('on', k === idx));
    const on = wrap.querySelector('.vw-thumb.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: instant ? 'auto' : 'smooth' });
  }

  function setPlaying(v) {
    playing = v;
    clearInterval(timer);
    $('[data-vw="play"]').innerHTML = playing ? pauseIcon() : playIcon();
    wrap.classList.toggle('playing', playing);
    if (!playing) return;
    if (idx >= list.length - 1) show(0, { instant: true });
    timer = setInterval(() => {
      if (idx >= list.length - 1) { setPlaying(false); return; }
      show(idx + 1);
    }, 800 / speed);
  }

  function setPose(p) {
    const l = photosOf(p);
    if (!l.length) { toast(`${poseName(p)}の写真はまだありません`, { icon: 'camera' }); return; }
    setPlaying(false);
    curPose = p; list = l; idx = list.length - 1;
    wrap.querySelectorAll('[data-vw-pose]').forEach((b) => b.classList.toggle('on', b.dataset.vwPose === p));
    renderStrip();
    show(idx, { instant: true });
  }

  function close() {
    setPlaying(false);
    wrap.classList.remove('open');
    document.body.classList.remove('viewer-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => wrap.remove(), 300);
  }

  const onKey = (e) => {
    if (e.key === 'ArrowLeft') show(idx - 1);
    else if (e.key === 'ArrowRight') show(idx + 1);
    else if (e.key === 'Escape') close();
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  };
  document.addEventListener('keydown', onKey);

  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vw]');
    const th = e.target.closest('[data-vw-i]');
    const ps = e.target.closest('[data-vw-pose]');
    if (th) { setPlaying(false); show(Number(th.dataset.vwI)); haptic(4); return; }
    if (ps) { setPose(ps.dataset.vwPose); return; }
    if (!b) return;
    const a = b.dataset.vw;
    if (a === 'close') close();
    else if (a === 'prev') { setPlaying(false); show(idx - 1); haptic(4); }
    else if (a === 'next') { setPlaying(false); show(idx + 1); haptic(4); }
    else if (a === 'first') { setPlaying(false); show(0); }
    else if (a === 'play') setPlaying(!playing);
    else if (a === 'speed') {
      speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1;
      b.textContent = `${speed}x`;
      if (playing) setPlaying(true);
    } else if (a === 'more' && onEdit) {
      const id = list[idx].id;
      close();
      setTimeout(() => onEdit(id), 250);
    }
  });

  // 左右にスワイプでコマ送り
  const stage = $('[data-vw-stage]');
  let sx = null; let sy = null;
  stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  stage.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { setPlaying(false); show(idx + (dx < 0 ? 1 : -1)); haptic(4); }
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) setPlaying(!playing);
  });

  renderStrip();
  show(idx, { instant: true });
  // 全ての写真を先読み
  list.forEach((p) => fullUrl(p.id));
  return { close };
}

/** 変遷のプレビュー（写真タブ・グラフ下で使う小さなフィルム） */
export function filmstripHTML(list, max = 6) {
  const step = Math.max(1, Math.ceil(list.length / max));
  const pick = list.filter((_, i) => i % step === 0 || i === list.length - 1).slice(-max);
  return pick.map((p) => `<span class="film-frame"><img src="${p.thumb}" alt=""><small>${fmtDate(p.date, { weekday: false })}</small></span>`).join('');
}

export { esc };
