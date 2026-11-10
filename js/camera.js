// ガイド付き撮影：上半身のシルエットに合わせて、いつも同じ画角で撮れるようにする
import { S } from './store.js';
import { icon } from './icons.js';
import { haptic, toast } from './ui.js';
import { POSES, poseName, photosOf, fullUrl, cropToCanvas, savePhotoCanvas, loadImage } from './photos.js';
import { notify } from './app.js';

/* 上半身のシルエット（3:4 の枠 300×400 に合わせた線画） */
const SIL_FRONT = `
  <ellipse cx="150" cy="92" rx="37" ry="47"/>
  <path d="M133 136 C133 150 131 158 121 164 C101 172 73 174 59 186 C45 198 41 216 41 238 L35 330 C33 360 35 388 36 400"/>
  <path d="M167 136 C167 150 169 158 179 164 C199 172 227 174 241 186 C255 198 259 216 259 238 L265 330 C267 360 265 388 264 400"/>
  <path d="M79 244 C83 300 90 350 95 400"/>
  <path d="M221 244 C217 300 210 350 205 400"/>`;
const SIL_SIDE = `
  <path d="M150 45 C176 45 190 66 190 92 C190 112 182 126 170 134 L170 140 C172 154 176 162 186 170"/>
  <path d="M150 45 C126 45 112 62 110 84 L104 98 C102 101 104 104 108 104 L110 104 L110 116 C110 126 118 132 128 132 L134 132 L134 160"/>
  <path d="M186 170 C200 182 204 210 202 248 C200 300 196 350 194 400"/>
  <path d="M134 160 C118 172 108 192 108 216 C108 244 118 258 122 280 C124 320 118 360 120 400"/>
  <path d="M148 182 C162 196 168 250 166 310 C165 345 163 375 162 400" stroke-dasharray="3 7"/>`;

function silhouette(pose) {
  const body = pose === 'side' ? SIL_SIDE : SIL_FRONT;
  return `<svg class="cam-sil" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <g class="sil-guides">
      <line x1="0" x2="300" y1="186" y2="186"/><text x="8" y="181">肩</text>
      <line x1="0" x2="300" y1="345" y2="345"/><text x="8" y="340">おへそ</text>
      <line x1="150" x2="150" y1="0" y2="400" class="center"/>
    </g>
    <g class="sil-body">${body}</g>
  </svg>`;
}

export async function openCamera({ pose = 'front', onSaved = null } = {}) {
  // iPhoneで傾きセンサーを使うには、タップの直後に許可を求める必要があります
  let orientReady = Promise.resolve('granted');
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      orientReady = DeviceOrientationEvent.requestPermission().catch(() => 'denied');
    }
  } catch { orientReady = Promise.resolve('denied'); }

  let curPose = pose;
  let facing = 'user';
  let stream = null;
  let timerSec = 0;
  let ghostOn = true;
  let captured = null; // { canvas, url }
  let counting = false;

  const wrap = document.createElement('div');
  wrap.className = 'cam';
  wrap.innerHTML = `
    <div class="cam-top">
      <button type="button" class="cam-icon" data-c="close" aria-label="閉じる">${icon('x', 22)}</button>
      <div class="cam-poses">${POSES.map((p) => `<button type="button" data-c-pose="${p.value}" class="${p.value === curPose ? 'on' : ''}">${p.label}</button>`).join('')}</div>
      <button type="button" class="cam-icon" data-c="flip" aria-label="カメラ切り替え">${flipIcon()}</button>
    </div>
    <div class="cam-view" data-view>
      <video playsinline muted autoplay></video>
      <img class="cam-ghost" alt="" hidden>
      <div data-sil>${silhouette(curPose)}</div>
      <div class="cam-level" data-level hidden><span class="lv-ring"><i data-bubble></i></span><b data-level-text>傾きを確認中</b></div>
      <div class="cam-count" data-count></div>
      <div class="cam-flash" data-flash></div>
      <img class="cam-shot" data-shot alt="" hidden>
      <div class="cam-msg" data-msg hidden></div>
    </div>
    <p class="cam-tip" data-tip>上半身を撮影します。頭・肩・おへその位置をシルエットに合わせてください</p>
    <div class="cam-bottom" data-bar>
      <button type="button" class="cam-opt" data-c="ghost">${icon('image', 20)}<span>前回を重ねる</span></button>
      <button type="button" class="shutter" data-c="shoot" aria-label="撮影"><i></i></button>
      <button type="button" class="cam-opt" data-c="timer">${icon('clock', 20)}<span data-timer-label>タイマー なし</span></button>
    </div>
    <div class="cam-bottom review" data-review hidden>
      <button type="button" class="cam-pill" data-c="retake">撮り直す</button>
      <button type="button" class="cam-pill primary" data-c="save">${icon('check', 18)}この写真を保存</button>
    </div>
    <label class="cam-file" data-file>${icon('image', 16)}アルバムから選ぶ<input type="file" accept="image/*"></label>`;
  document.getElementById('overlay-root').appendChild(wrap);
  document.body.classList.add('viewer-open');
  requestAnimationFrame(() => wrap.classList.add('open'));

  const $ = (s) => wrap.querySelector(s);
  const video = $('video');

  function flipIcon() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a8 8 0 0 1 14.5-3.5L20 7"/><path d="M20 3v4h-4"/><path d="M20 15a8 8 0 0 1-14.5 3.5L4 17"/><path d="M4 21v-4h4"/></svg>';
  }

  /* --- 前回の写真を重ねる --- */
  async function updateGhost() {
    const ghost = $('.cam-ghost');
    const last = photosOf(curPose).slice(-1)[0];
    $('[data-c="ghost"]').classList.toggle('on', ghostOn && !!last);
    $('[data-c="ghost"]').disabled = !last;
    if (!last || !ghostOn) { ghost.hidden = true; return; }
    ghost.src = last.thumb;
    ghost.hidden = false;
    const u = await fullUrl(last.id);
    if (u) ghost.src = u;
  }

  /* --- カメラ --- */
  function stopStream() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }
  async function startStream() {
    stopStream();
    const msg = $('[data-msg]');
    msg.hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMsg('このブラウザではカメラを直接使えません。<br>下の「アルバムから選ぶ」から写真を選んでください。');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false,
      });
      video.srcObject = stream;
      video.classList.toggle('mirror', facing === 'user');
      await video.play().catch(() => {});
    } catch (err) {
      console.warn(err);
      showMsg('カメラを使えませんでした。<br><small>iPhoneの「設定 → Safari → カメラ」で許可するか、<br>下の「アルバムから選ぶ」から写真を選んでください。</small>');
    }
  }
  function showMsg(html) {
    const msg = $('[data-msg]');
    msg.innerHTML = `${icon('camera', 30)}<p>${html}</p>`;
    msg.hidden = false;
  }

  /* --- 傾き（水平器） --- */
  let lastOrient = 0;
  function onOrient(e) {
    if (e.beta === null || e.gamma === null) return;
    const now = performance.now();
    if (now - lastOrient < 60) return;
    lastOrient = now;
    const level = $('[data-level]');
    level.hidden = false;
    const tiltX = Math.max(-15, Math.min(15, e.gamma || 0));
    const tiltY = Math.max(-15, Math.min(15, (e.beta || 0) - 90));
    $('[data-bubble]').style.transform = `translate(${tiltX * 0.9}px, ${tiltY * 0.9}px)`;
    const ok = Math.abs(tiltX) < 3 && Math.abs(tiltY) < 4;
    level.classList.toggle('ok', ok);
    $('[data-level-text]').textContent = ok ? 'まっすぐ' : Math.abs(tiltY) >= Math.abs(tiltX) ? (tiltY > 0 ? '上に傾いています' : '下に傾いています') : (tiltX > 0 ? '右に傾いています' : '左に傾いています');
  }
  orientReady.then((r) => { if (r === 'granted') window.addEventListener('deviceorientation', onOrient); });

  /* --- 撮影 --- */
  function setReview(canvas) {
    captured = { canvas };
    const shot = $('[data-shot]');
    shot.src = canvas.toDataURL('image/jpeg', 0.85);
    shot.hidden = false;
    $('[data-bar]').hidden = true;
    $('[data-review]').hidden = false;
    $('[data-file]').hidden = true;
    $('[data-tip]').textContent = 'シルエットと位置がそろっているか確認してください';
    wrap.classList.add('reviewing');
  }
  function clearReview() {
    captured = null;
    $('[data-shot]').hidden = true;
    $('[data-bar]').hidden = false;
    $('[data-review]').hidden = true;
    $('[data-file]').hidden = false;
    $('[data-tip]').textContent = '上半身を撮影します。頭・肩・おへその位置をシルエットに合わせてください';
    wrap.classList.remove('reviewing');
  }
  function capture() {
    if (!stream || !video.videoWidth) { toast('カメラの準備ができていません'); return; }
    const c = cropToCanvas(video, video.videoWidth, video.videoHeight, { mirror: facing === 'user' });
    const flash = $('[data-flash]');
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    haptic(15);
    setReview(c);
  }
  async function shoot() {
    if (counting) return;
    if (!timerSec) { capture(); return; }
    counting = true;
    const el = $('[data-count]');
    for (let s = timerSec; s > 0; s--) {
      el.textContent = s;
      el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
      haptic(5);
      await new Promise((r) => setTimeout(r, 1000));
      if (!wrap.isConnected) return;
    }
    el.textContent = '';
    counting = false;
    capture();
  }

  async function save() {
    if (!captured) return;
    const btn = $('[data-c="save"]');
    btn.disabled = true;
    try {
      const rec = await savePhotoCanvas(captured.canvas, { pose: curPose, cam: facing === 'user' ? 'front' : 'back', guided: true });
      close();
      await notify({ message: `${poseName(curPose)}の写真を保存しました` });
      if (onSaved) onSaved(rec);
    } catch (err) {
      console.error(err);
      toast('保存できませんでした（容量不足の可能性があります）');
      btn.disabled = false;
    }
  }

  function close() {
    stopStream();
    window.removeEventListener('deviceorientation', onOrient);
    wrap.classList.remove('open');
    document.body.classList.remove('viewer-open');
    setTimeout(() => wrap.remove(), 300);
  }

  wrap.addEventListener('click', (e) => {
    const ps = e.target.closest('[data-c-pose]');
    if (ps) {
      curPose = ps.dataset.cPose;
      wrap.querySelectorAll('[data-c-pose]').forEach((b) => b.classList.toggle('on', b === ps));
      $('[data-sil]').innerHTML = silhouette(curPose);
      updateGhost();
      haptic(4);
      return;
    }
    const b = e.target.closest('[data-c]');
    if (!b) return;
    const a = b.dataset.c;
    if (a === 'close') close();
    else if (a === 'flip') { facing = facing === 'user' ? 'environment' : 'user'; startStream(); }
    else if (a === 'ghost') { ghostOn = !ghostOn; updateGhost(); }
    else if (a === 'timer') {
      timerSec = timerSec === 0 ? 3 : timerSec === 3 ? 10 : 0;
      $('[data-timer-label]').textContent = timerSec ? `タイマー ${timerSec}秒` : 'タイマー なし';
      b.classList.toggle('on', timerSec > 0);
    } else if (a === 'shoot') shoot();
    else if (a === 'retake') clearReview();
    else if (a === 'save') save();
  });
  $('[data-file] input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImage(url);
      setReview(cropToCanvas(img, img.naturalWidth, img.naturalHeight));
    } catch { toast('写真を読み込めませんでした'); } finally { URL.revokeObjectURL(url); }
  });

  updateGhost();
  await startStream();
  return { close };
}

export { S };
