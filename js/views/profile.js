// PROFILE：プロフィール・実績・設定・データ管理
import * as store from '../store.js';
import { S, GOALS, APP_VERSION } from '../store.js';
import { ACHIEVEMENTS, TITLES, XP_RULES, xpForLevel, STAT_DEFS } from '../game.js';
import { icon, logoMark } from '../icons.js';
import { openSheet, stepper, chips, choice, num, val, toast, confirmDialog } from '../ui.js';
import { exportBackup, restoreBackup, validateBackup, storageInfo } from '../backup.js';
import { isDemo, setDemo, clearAll, deleteDatabase } from '../db.js';
import { today, esc, fmtNum, diffDays, fmtDateLong, ymd } from '../util.js';
import { notify } from '../app.js';

export function render(root, app) {
  const g = app.game;
  const p = S.profile || {};
  const goal = GOALS.find((x) => x.id === p.goal) || GOALS[0];
  const days = p.startDate ? diffDays(today(), p.startDate) + 1 : 1;
  const unlockedCount = ACHIEVEMENTS.filter((a) => g.unlocked[a.id]).length;
  const nextTitle = TITLES.find(([lv]) => lv > g.level);
  const lastBackup = S.meta.lastBackupAt ? Math.floor((Date.now() - S.meta.lastBackupAt) / 86400000) : null;

  root.innerHTML = `
  <div class="page profile">
    <header class="page-head"><h1>PROFILE</h1></header>

    <section class="card hero-card">
      <div class="hero-mark">${logoMark(64, g.stage.index)}</div>
      <div class="hero-info">
        <p class="hero-lv">Lv ${g.level} ・ ${esc(g.title)}</p>
        <p class="hero-goal">目標：<strong>${esc(goal.name)}</strong></p>
        <p class="muted small">EVOLVE ${days}日目 ・ 記録した日 ${g.activeDays}日</p>
      </div>
    </section>
    ${p.goalNote ? `<p class="goal-note">${icon('target', 16)}<span>${esc(p.goalNote)}</span></p>` : ''}

    <section class="card">
      <h2 class="card-h">${icon('crown', 18)}称号</h2>
      <div class="titles">${TITLES.map(([lv, name]) => `<span class="title-chip ${g.level >= lv ? 'on' : ''} ${g.title === name ? 'cur' : ''}">${name}<small>Lv${lv}</small></span>`).join('')}</div>
      ${nextTitle ? `<p class="muted small">次の称号「${nextTitle[1]}」は Lv${nextTitle[0]} で獲得できます。</p>` : '<p class="muted small">すべての称号を獲得しました。</p>'}
    </section>

    <section class="card">
      <h2 class="card-h">${icon('star', 18)}実績<span class="card-h-note">${unlockedCount} / ${ACHIEVEMENTS.length}</span></h2>
      <div class="ach-grid">
        ${ACHIEVEMENTS.map((a) => {
          const d = g.unlocked[a.id];
          return `<div class="ach ${d ? 'on' : ''}">
            <span class="ach-ic">${icon(a.icon, 20)}</span>
            <strong>${esc(a.name)}</strong>
            <small>${d ? `${fmtDateLong(d).replace(/（.）/, '')} 達成` : esc(a.desc)}</small>
            ${a.xp ? `<em>+${a.xp}XP</em>` : ''}
          </div>`;
        }).join('')}
      </div>
      <p class="fine">連続記録が途切れても、達成した実績や経験値が減ることはありません。</p>
    </section>

    <section class="card settings">
      <h2 class="card-h">${icon('user', 18)}プロフィール</h2>
      <div class="set-list">
        <div class="set-row"><span>年齢</span><b>${p.age ?? '—'}歳</b></div>
        <div class="set-row"><span>身長</span><b>${p.height ?? '—'}cm</b></div>
        <div class="set-row"><span>体重（最新）</span><b>${Number(store.bodyWeightAt()).toFixed(1)}kg</b></div>
        <div class="set-row"><span>タンパク質目標</span><b>${p.proteinGoal || 100}g / 日</b></div>
        <div class="set-row"><span>目指す身体</span><b>${esc(goal.name)}</b></div>
      </div>
      <button type="button" class="btn btn-soft btn-block" data-act="profile">${icon('edit', 16)}プロフィールを編集</button>
    </section>

    <section class="card settings">
      <h2 class="card-h">${icon('settings', 18)}設定</h2>
      <div class="set-list">
        <button type="button" class="set-row link-row" data-act="shake"><span>${icon('cup', 18)}プロテイン1杯の量</span><b>${S.settings.proteinPerShake}g ${icon('right', 16)}</b></button>
        <button type="button" class="set-row link-row" data-act="kcal"><span>${icon('flame', 18)}消費カロリーの計算</span><b>${icon('right', 16)}</b></button>
        <a class="set-row link-row" href="#training?mode=strength&manage=1"><span>${icon('dumbbell', 18)}種目の追加・編集</span><b>${icon('right', 16)}</b></a>
        <button type="button" class="set-row link-row" data-act="xp"><span>${icon('bolt', 18)}経験値のしくみ</span><b>${icon('right', 16)}</b></button>
        <button type="button" class="set-row link-row" data-act="install"><span>${icon('share', 18)}ホーム画面に追加する方法</span><b>${icon('right', 16)}</b></button>
      </div>
    </section>

    <section class="card settings">
      <h2 class="card-h">${icon('download', 18)}データの保存・引っ越し</h2>
      <p class="muted small">記録はこの端末の中に保存されています。機種変更やもしもの時のために、ときどきバックアップしておくと安心です。</p>
      ${lastBackup === null ? '<p class="soft-alert">まだバックアップしたことがありません</p>' : lastBackup >= 30 ? `<p class="soft-alert">最後のバックアップから${lastBackup}日たちました</p>` : `<p class="muted small">最後のバックアップ：${lastBackup === 0 ? '今日' : lastBackup + '日前'}</p>`}
      <div class="btn-row">
        <button type="button" class="btn btn-primary" data-act="export">${icon('download', 16)}バックアップ</button>
        <label class="btn btn-soft file-btn">${icon('upload', 16)}復元する<input type="file" name="restore" accept="application/json,.json"></label>
      </div>
      <p class="muted small" data-storage>保存容量を確認中…</p>
    </section>

    <section class="card settings">
      <h2 class="card-h">${icon('info', 18)}その他</h2>
      <div class="set-list">
        ${isDemo()
          ? '<button type="button" class="set-row link-row" data-act="demo-off"><span>デモを終了する</span><b>' + icon('right', 16) + '</b></button>'
          : '<button type="button" class="set-row link-row" data-act="demo-on"><span>デモデータで試してみる</span><b>' + icon('right', 16) + '</b></button>'}
        <button type="button" class="set-row link-row danger" data-act="wipe"><span>${icon('trash', 18)}すべてのデータを削除</span><b>${icon('right', 16)}</b></button>
      </div>
      <p class="fine">EVOLVE v${APP_VERSION}<br>消費カロリー・ステータスなどの数値はすべて目安・ゲーム内の指標であり、医学的な測定値ではありません。体調に不安がある場合は無理をせず、専門家にご相談ください。</p>
    </section>
  </div>`;

  showStorage(root);

  root.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'profile') editProfile(app);
    else if (act === 'shake') editShake(app);
    else if (act === 'kcal') editKcal(app);
    else if (act === 'xp') showXP();
    else if (act === 'install') showInstall();
    else if (act === 'export') doExport(app);
    else if (act === 'demo-on') startDemo();
    else if (act === 'demo-off') endDemo();
    else if (act === 'wipe') wipe();
  };
  root.onchange = async (e) => {
    if (e.target.name === 'restore') {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) doRestore(f);
    }
  };
}

async function showStorage(root) {
  const info = await storageInfo();
  const el = root.querySelector('[data-storage]');
  if (!el) return;
  const mb = (n) => `${(n / 1024 / 1024).toFixed(n > 1024 * 1024 * 10 ? 0 : 1)}MB`;
  const counts = `記録 ${S.workouts.length + S.cardio.length + S.meals.length + S.body.length}件 ・ 写真 ${S.photos.length}枚`;
  el.innerHTML = `${counts}${info.usage !== null ? ` ・ 使用量 約${mb(info.usage)}` : ''}${info.persisted ? ' ・ 保護設定 ON' : ''}`;
}

function editProfile(app) {
  const p = S.profile || {};
  openSheet({
    title: 'プロフィールを編集',
    html: `<form class="form" onsubmit="return false">
      <div class="field"><span class="field-label">年齢</span>${stepper('age', p.age, { step: 1, min: 10, max: 100, unit: '歳' })}</div>
      <div class="field"><span class="field-label">身長</span>${stepper('height', p.height, { step: 1, min: 100, max: 230, unit: 'cm' })}</div>
      <div class="field"><span class="field-label">性別 <em>任意・基礎代謝の目安に使用</em></span>${choice('sex', [{ value: '', label: '未設定' }, { value: 'male', label: '男性' }, { value: 'female', label: '女性' }], p.sex || '')}</div>
      <div class="field"><span class="field-label">タンパク質の目標</span>${stepper('proteinGoal', p.proteinGoal || 100, { step: 5, min: 30, max: 300, unit: 'g' })}
        ${chips('proteinGoal', [60, 80, 100, 120, 140], p.proteinGoal || 100)}</div>
      <div class="field"><span class="field-label">目指す身体</span>${choice('goal', GOALS.map((x) => ({ value: x.id, label: x.name })), p.goal || 'hosomacho')}</div>
      <div class="field"><span class="field-label">目標のイメージ・ひとこと <em>任意</em></span><input class="input" type="text" name="goalNote" value="${esc(p.goalNote || '')}" maxlength="60" placeholder="例：夏までに腹筋のラインを出す"></div>
      <p class="hint">体重・体脂肪率は GROWTH の「身体測定」から記録すると、自動でここにも反映されます。</p>
      <div class="sheet-actions"><span></span><button type="button" class="btn btn-primary" data-save>保存する</button></div>
    </form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        if (!e.target.closest('[data-save]')) return;
        await store.setProfile({
          ...p, age: num(body, 'age'), height: num(body, 'height'), sex: val(body, 'sex'),
          proteinGoal: num(body, 'proteinGoal') || 100, goal: val(body, 'goal'), goalNote: val(body, 'goalNote').trim(),
        });
        close();
        await notify({ message: 'プロフィールを保存しました', silentXP: true });
      };
    },
  });
}

function editShake(app) {
  openSheet({
    title: 'プロテイン1杯の量',
    html: `<form class="form" onsubmit="return false">
      <div class="field"><span class="field-label">1杯あたりのタンパク質</span>${stepper('per', S.settings.proteinPerShake, { step: 1, min: 1, max: 100, unit: 'g' })}
        ${chips('per', [15, 20, 25, 30], S.settings.proteinPerShake)}</div>
      <p class="hint">お使いのプロテインのパッケージに書かれている「1食あたりのたんぱく質」を入れてください。</p>
      <div class="sheet-actions"><span></span><button type="button" class="btn btn-primary" data-save>保存する</button></div></form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        if (!e.target.closest('[data-save]')) return;
        await store.setSettings({ proteinPerShake: num(body, 'per') || 20 });
        close();
        await notify({ message: '保存しました', silentXP: true });
      };
    },
  });
}

function editKcal(app) {
  const s = S.settings;
  openSheet({
    title: '消費カロリーの計算',
    html: `<form class="form" onsubmit="return false">
      <p class="hint top">消費カロリーは推定値（目安）です。実際は体重・強度・動作の速さなどで変わります。</p>
      <div class="field"><span class="field-label">体重で補正する（筋トレ）</span>${choice('adj', [{ value: '1', label: 'する' }, { value: '0', label: 'しない' }], s.kcalWeightAdjust ? '1' : '0')}
        <p class="hint">種目ごとの値は体重65kgの人を基準にしています。「する」にすると最新の体重に合わせて調整します。</p></div>
      <div class="field"><span class="field-label">距離と時間から強度を推定（有酸素）</span>${choice('speed', [{ value: '1', label: 'する' }, { value: '0', label: 'しない' }], s.useSpeedMets ? '1' : '0')}</div>
      <p class="list-label">運動強度（METs）※速度が分からないときに使用</p>
      <div class="field"><span class="field-label">ランニング</span>${stepper('run', s.mets.run, { step: 0.1, min: 1, max: 20, decimals: 1, unit: 'METs' })}</div>
      <div class="field"><span class="field-label">ウォーキング</span>${stepper('walk', s.mets.walk, { step: 0.1, min: 1, max: 20, decimals: 1, unit: 'METs' })}</div>
      <div class="field"><span class="field-label">サイクリング</span>${stepper('cycle', s.mets.cycle, { step: 0.1, min: 1, max: 20, decimals: 1, unit: 'METs' })}</div>
      <div class="field"><span class="field-label">その他</span>${stepper('other', s.mets.other, { step: 0.1, min: 1, max: 20, decimals: 1, unit: 'METs' })}</div>
      <p class="hint">計算式：METs × 体重(kg) × 時間(h) × 1.05。筋トレ種目ごとの値は TRAINING →「種目を管理」で変更できます。</p>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-reset>初期値に戻す</button><button type="button" class="btn btn-primary" data-save>保存する</button></div></form>`,
    onMount(body, close) {
      body.onclick = async (e) => {
        if (e.target.closest('[data-reset]')) {
          await store.setSettings({ kcalWeightAdjust: true, useSpeedMets: true, mets: { ...store.DEFAULT_SETTINGS.mets } });
          close();
          await notify({ message: '初期値に戻しました', silentXP: true });
          return;
        }
        if (!e.target.closest('[data-save]')) return;
        await store.setSettings({
          kcalWeightAdjust: val(body, 'adj') === '1',
          useSpeedMets: val(body, 'speed') === '1',
          mets: { run: num(body, 'run') || 8.3, walk: num(body, 'walk') || 3.5, cycle: num(body, 'cycle') || 6.8, other: num(body, 'other') || 4 },
        });
        close();
        await notify({ message: '保存しました', silentXP: true });
      };
    },
  });
}

function showXP() {
  const levels = [2, 3, 5, 10, 20, 30];
  let cum = 0; const table = [];
  for (let L = 1; L < 31; L++) { cum += xpForLevel(L); if (levels.includes(L + 1)) table.push([L + 1, cum]); }
  openSheet({
    title: '経験値のしくみ',
    html: `
      <p class="hint top">経験値は記録から自動で計算されます。同じ記録を何度も入れても、1日あたりの上限があるので大丈夫。記録を修正・削除すると経験値も自動で正しく直ります。</p>
      <div class="rule-list">${XP_RULES.map((r) => `<div class="rule"><strong>${r.label}</strong><span>${r.detail}</span></div>`).join('')}</div>
      <h3 class="mini-h">レベルに必要な累計経験値</h3>
      <div class="rule-list">${table.map(([L, x]) => `<div class="rule"><strong>Lv${L}</strong><span>${fmtNum(x)} XP</span></div>`).join('')}</div>
      <h3 class="mini-h">ステータス</h3>
      <div class="rule-list">${STAT_DEFS.map((s) => `<div class="rule"><strong style="color:${s.color}">${s.name}</strong><span>${s.desc}</span></div>`).join('')}</div>
      <p class="fine">ステータスは積み重ねで伸び続け、休んでも下がりません。ゲーム内の成長指標であり、医学的な測定値ではありません。</p>`,
  });
}

function showInstall() {
  openSheet({
    title: 'ホーム画面に追加する方法',
    html: `
      <h3 class="mini-h">iPhone（Safari）</h3>
      <ol class="steps">
        <li>SafariでEVOLVEのページを開きます</li>
        <li>画面下の <b>共有ボタン</b>（四角から上向き矢印が出ているマーク）をタップ</li>
        <li>メニューを下へスクロールして <b>「ホーム画面に追加」</b> をタップ</li>
        <li>名前が「EVOLVE」になっていることを確認して、右上の <b>「追加」</b> をタップ</li>
        <li>ホーム画面に EVOLVE のアイコンが出たら完成！ アイコンから開くとアプリのように使えます</li>
      </ol>
      <h3 class="mini-h">Android（Chrome）</h3>
      <ol class="steps">
        <li>ChromeでEVOLVEのページを開きます</li>
        <li>右上の <b>︙</b> メニューから <b>「ホーム画面に追加」</b> または <b>「アプリをインストール」</b> をタップ</li>
      </ol>
      <p class="fine">ホーム画面から開いた場合とSafariで開いた場合では、保存場所が別になることがあります。いつも同じ方法（ホーム画面のアイコン）で開くのがおすすめです。</p>`,
  });
}

async function doExport() {
  const hasPhotos = S.photos.length > 0;
  let includePhotos = true;
  if (hasPhotos) {
    includePhotos = await confirmDialog(`写真（${S.photos.length}枚）もバックアップに含めますか？<br><small>含めるとファイルが大きくなります。</small>`, { ok: '含める', cancel: '記録だけ' });
  }
  try {
    const r = await exportBackup({ includePhotos });
    if (r.cancelled) return;
    toast('バックアップを作成しました');
  } catch (err) {
    console.error(err);
    toast('バックアップに失敗しました');
  }
}

async function doRestore(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    validateBackup(obj);
    const when = obj.exportedAt ? new Date(obj.exportedAt) : null;
    const ok = await confirmDialog(`${when ? `${ymd(when)} に作成された` : ''}バックアップから復元しますか？<br><small>今この端末にある記録は、バックアップの内容に置き換わります。</small>`, { ok: '復元する', danger: true });
    if (!ok) return;
    await restoreBackup(obj);
    toast('復元しました。再読み込みします…');
    setTimeout(() => { location.hash = '#home'; location.reload(); }, 800);
  } catch (err) {
    console.error(err);
    toast(err.message && err.message.includes('EVOLVE') ? err.message : 'ファイルを読み込めませんでした');
  }
}

async function startDemo() {
  const ok = await confirmDialog('デモデータで試しますか？<br><small>デモは別の場所に保存されるので、あなたの記録はそのまま残ります。いつでも終了できます。</small>', { ok: 'デモを見る' });
  if (!ok) return;
  setDemo(true);
  location.hash = '#home';
  location.reload();
}

async function endDemo() {
  const ok = await confirmDialog('デモを終了して、あなたの記録に戻りますか？');
  if (!ok) return;
  await deleteDatabase('evolve-demo');
  setDemo(false);
  location.hash = '#home';
  location.reload();
}

async function wipe() {
  const ok = await confirmDialog('すべての記録・写真・設定を削除しますか？<br><small>この操作は元に戻せません。必要なら先にバックアップしてください。</small>', { ok: '削除する', danger: true });
  if (!ok) return;
  const ok2 = await confirmDialog('本当に削除しますか？', { ok: 'すべて削除', danger: true });
  if (!ok2) return;
  await clearAll();
  toast('削除しました');
  setTimeout(() => { location.hash = '#home'; location.reload(); }, 600);
}
