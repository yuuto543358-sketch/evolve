// EVOLVE メイン：起動・画面切り替え・経験値の反映
import * as store from './store.js';
import { S } from './store.js';
import { isDemo, setDemo, deleteDatabase } from './db.js';
import { computeGame, ACHIEVEMENTS } from './game.js';
import { icon } from './icons.js';
import { installGlobalHandlers, toast, celebrateLevelUp, celebrateAchievement, confirmDialog, animateUI } from './ui.js';
import { openQuickAdd } from './quick.js';
import { maybeAskPlan } from './plan.js';
import { today } from './util.js';
import * as home from './views/home.js';
import * as training from './views/training.js';
import * as nutrition from './views/nutrition.js';
import * as growth from './views/growth.js';
import * as profile from './views/profile.js';
import { renderOnboarding } from './views/onboarding.js';

const TABS = [
  { id: 'home', label: 'HOME', icon: 'home', view: home },
  { id: 'training', label: 'TRAINING', icon: 'dumbbell', view: training },
  { id: 'nutrition', label: 'NUTRITION', icon: 'leaf', view: nutrition },
  { id: 'growth', label: 'GROWTH', icon: 'growth', view: growth },
  { id: 'profile', label: 'PROFILE', icon: 'user', view: profile },
];

const viewEl = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const navbar = document.getElementById('navbar');
let current = 'home';
let params = {};
let lastGame = null;

export const app = {
  game: null,
  go,
  refresh,
  params: () => params,
  clearParams() {
    if (!Object.keys(params).length) return;
    params = {};
    history.replaceState(null, '', `#${current}`);
  },
};

function parseHash() {
  const h = (location.hash || '#home').slice(1);
  const [id, q] = h.split('?');
  const p = {};
  if (q) for (const kv of q.split('&')) { const [k, v] = kv.split('='); p[k] = decodeURIComponent(v || ''); }
  return { id: TABS.some((t) => t.id === id) ? id : 'home', p };
}

function go(id, p = {}) {
  const q = Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const target = `#${id}${q ? '?' + q : ''}`;
  if (location.hash === target) { params = p; render(true); } else location.hash = target;
}

function renderTabbar() {
  const idx = TABS.findIndex((t) => t.id === current);
  tabbar.innerHTML = `
    <div class="tabs" style="--n:${TABS.length};--i:${idx}">
      <span class="tab-thumb" aria-hidden="true"></span>
      ${TABS.map((t) => `
      <a href="#${t.id}" class="tab ${t.id === current ? 'on' : ''}" data-tab="${t.id}" aria-current="${t.id === current ? 'page' : 'false'}">
        ${icon(t.icon, 22)}<span>${t.label}</span>
      </a>`).join('')}
    </div>
    <button type="button" class="fab" data-quick aria-label="記録する">${icon('plus', 26)}</button>`;
}

/** 大きなタイトルが隠れたら、上部に小さなタイトルを表示（iOS風） */
let titleEl = null;
function updateNavbar() {
  if (!titleEl) { navbar.classList.remove('show'); return; }
  const r = titleEl.getBoundingClientRect();
  navbar.classList.toggle('show', r.bottom < navbar.offsetHeight - 4);
}
let navTick = false;
window.addEventListener('scroll', () => {
  if (navTick) return;
  navTick = true;
  requestAnimationFrame(() => { navTick = false; updateNavbar(); });
}, { passive: true });

let lastTab = null;
function render(scrollTop = true) {
  const tab = TABS.find((t) => t.id === current);
  app.game = computeGame();
  try {
    tab.view.render(viewEl, app);
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="page"><div class="card"><h2>表示中に問題が発生しました</h2><p class="muted">${String(err.message || err)}</p><button class="btn btn-primary" onclick="location.reload()">再読み込み</button></div></div>`;
  }
  if (lastTab !== current) {
    viewEl.classList.remove('view-enter');
    void viewEl.offsetWidth;
    viewEl.classList.add('view-enter');
    lastTab = current;
  }
  renderTabbar();
  titleEl = viewEl.querySelector('.large-title h1');
  navbar.querySelector('.nav-title').textContent = titleEl ? (titleEl.dataset.short || titleEl.textContent) : '';
  animateUI(viewEl);
  if (scrollTop) window.scrollTo(0, 0);
  updateNavbar();
}

function refresh() {
  const y = window.scrollY;
  render(false);
  window.scrollTo(0, y);
}

/** データ変更後：経験値の差分表示・実績・レベルアップ */
async function afterChange(info) {
  const g = computeGame();
  if (g.newly.length) {
    await store.setAchievements(g.unlocked);
  }
  const before = lastGame;
  lastGame = g;
  app.game = g;
  const diff = before ? g.totalXP - before.totalXP : 0;
  const xp = info && !info.silentXP && diff > 0 ? diff : 0;
  if (info && (info.message || xp)) {
    toast(info.message || '記録しました', { xp, action: info.undo || null });
  }
  for (const a of g.newly) celebrateAchievement(a);
  const seen = S.meta.lastSeenLevel || 1;
  if (g.level > seen) {
    await store.setMeta({ lastSeenLevel: g.level });
    setTimeout(() => celebrateLevelUp(g.level, g.title, g.stage), g.newly.length ? 600 : 250);
  } else if (g.level < seen) {
    await store.setMeta({ lastSeenLevel: g.level });
  }
}

/** 各画面から保存後に呼ぶ */
export async function notify(info = {}) {
  await afterChange({ type: 'save', ...info });
  refresh();
}

async function startApp() {
  await store.ensureDefaultExercises();
  const g = computeGame();
  if (g.newly.length) await store.setAchievements(g.unlocked);
  lastGame = computeGame();
  if (!S.meta.lastSeenLevel) await store.setMeta({ lastSeenLevel: lastGame.level });
  tabbar.hidden = false;
  navbar.hidden = false;
  tabbar.addEventListener('click', (e) => {
    if (e.target.closest('[data-quick]')) { openQuickAdd(app); return; }
    const t = e.target.closest('[data-tab]');
    // 選択中のタブをもう一度押すと一番上へ
    if (t && t.dataset.tab === current && !location.hash.includes('?')) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  const { id, p } = parseHash();
  current = id; params = p;
  render();
  // 毎日はじめて開いたときに、今日の予定を聞く
  let shownDate = today();
  setTimeout(() => maybeAskPlan({ onPicked: () => refresh() }), 700);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (shownDate !== today()) { shownDate = today(); refresh(); }
    setTimeout(() => maybeAskPlan({ onPicked: () => refresh() }), 400);
  });
  window.addEventListener('hashchange', () => {
    const r = parseHash();
    current = r.id; params = r.p;
    render();
  });
}

async function boot() {
  installGlobalHandlers();
  document.getElementById('demo-banner').hidden = !isDemo();
  document.body.classList.toggle('demo', isDemo());
  document.getElementById('demo-exit').addEventListener('click', async () => {
    if (!(await confirmDialog('デモを終了して、あなたの記録に戻りますか？'))) return;
    await deleteDatabase('evolve-demo');
    setDemo(false);
    location.hash = '#home';
    location.reload();
  });
  try {
    await store.loadAll();
  } catch (err) {
    viewEl.innerHTML = `<div class="page"><div class="card"><h2>データを読み込めませんでした</h2><p class="muted">${String(err.message || err)}</p><p class="muted small">プライベートブラウズでは保存できない場合があります。</p></div></div>`;
    hideSplash();
    return;
  }
  if (isDemo() && !S.profile) {
    const { seedDemo } = await import('./demo.js');
    await seedDemo();
  }
  hideSplash();
  if (!S.profile || !S.profile.onboarded) {
    tabbar.hidden = true;
    renderOnboarding(viewEl, async () => { await startApp(); });
  } else {
    await startApp();
  }
  registerSW();
  requestPersist();
}

function hideSplash() {
  const sp = document.getElementById('splash');
  if (!sp) return;
  sp.classList.add('hide');
  setTimeout(() => sp.remove(), 500);
}

/** ブラウザに「データを消さないで」とお願いする */
async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* 対応していないブラウザは何もしない */ }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const promptUpdate = (worker) => {
      toast('新しいバージョンがあります', {
        duration: 8000,
        action: { label: '更新', onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }) },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw);
      });
    });
    // アプリを開き直したときに更新を確認
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW登録に失敗', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

export { ACHIEVEMENTS };
boot();
