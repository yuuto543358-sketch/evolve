// アプリの更新（Service Worker）：新しい版を探して、見つかったら「更新」をすすめる
//
// ・アプリを開くたびと、ほかのアプリからもどってきたときに、新しい版がないか探す
// ・見つかったら「新しいバージョンがあります［更新］」を出す（更新を押すと、新しい版で開き直す）
// ・PROFILE の「アプリの更新を確認」から、自分で探すこともできる
import { toast } from './ui.js';

let shownAt = 0; // 同じお知らせを、何度も続けて出さない

function promptUpdate(worker) {
  if (Date.now() - shownAt < 15000) return;
  shownAt = Date.now();
  toast('新しいバージョンがあります', {
    icon: 'download',
    duration: 20000,
    action: { label: '更新', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
  });
}

/** 新しい版を保存し終えるまで待つ（20秒で切りあげる） */
function waitInstalled(worker) {
  const done = new Promise((resolve) => {
    if (worker.state === 'installed' || worker.state === 'activated') { resolve(true); return; }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'activated') resolve(true);
      else if (worker.state === 'redundant') resolve(false);
    });
  });
  return Promise.race([done, new Promise((resolve) => setTimeout(() => resolve(false), 20000))]);
}

/**
 * 新しい版を探す
 * @returns {Promise<'ready'|'latest'|'offline'|'unsupported'>} ready＝見つかった（更新のお知らせを出した）／latest＝いまが最新／offline＝確認できなかった
 */
export async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  let reg = null;
  try { reg = await navigator.serviceWorker.getRegistration(); } catch { /* ignore */ }
  if (!reg) return 'unsupported';
  try { await reg.update(); } catch { return 'offline'; }
  if (reg.installing) await waitInstalled(reg.installing);
  if (reg.waiting && navigator.serviceWorker.controller) { promptUpdate(reg.waiting); return 'ready'; }
  return 'latest';
}

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw);
      });
    });
    // アプリを開いたときと、アプリにもどってきたときに、新しい版を探す
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW登録に失敗', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
