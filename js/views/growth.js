// GROWTH：身体の変化・グラフ・写真比較
import * as store from '../store.js';
import { S } from '../store.js';
import { icon } from '../icons.js';
import { lineChart, bindCharts, sparkline } from '../charts.js';
import { segmented, openSheet, toast, confirmDialog, choice, largeTitle, secH } from '../ui.js';
import { POSES, poseName, photosOf, fullUrl, forgetUrl, savePhotoFile, photoForRange, openPhotoViewer, filmstripHTML, weightNear } from '../photos.js';
import { openCamera } from '../camera.js';
import { bodyEditor, bodyRow, handleEditClick, removeWithUndo, emptyState } from '../records.js';
import { notify } from '../app.js';
import { today, esc, fmtNum, byDateDesc, addDays, weekStart, monthKey, fmtDate, fmtDateLong, relDay, groupBy, parseYmd, ymd } from '../util.js';

let tab = 'body';
let metric = 'weight';
let period = 'day';
let pose = 'front';
let cmpMode = 'side';
let pick = { a: null, b: null };
let bodyLimit = 10;
let chartRanges = [];   // グラフの各点がカバーする日付の範囲
let chartSel = null;    // グラフで選んでいる点

const METRICS = [
  { id: 'weight', name: '体重', unit: 'kg', color: '#22806F', dec: 1 },
  { id: 'bodyFat', name: '体脂肪率', unit: '%', color: '#B8914A', dec: 1 },
  { id: 'muscle', name: '筋肉量', unit: 'kg', color: '#3B7FA8', dec: 1 },
  { id: 'waist', name: 'ウエスト', unit: 'cm', color: '#6E9A63', dec: 1 },
];

export function render(root, app) {
  const p = app.params();
  if (p.tab) tab = p.tab;
  const openBody = p.add === 'body';
  app.clearParams();

  root.innerHTML = `
  <div class="page growth">
    ${largeTitle({
      kicker: 'GROWTH', title: 'からだの変化',
      right: tab === 'body'
        ? `<button type="button" class="round-btn" data-add-body aria-label="身体測定を記録">${icon('plus', 20)}</button>`
        : `<button type="button" class="round-btn" data-camera aria-label="写真を撮る">${icon('camera', 19)}</button>`,
    })}
    ${segmented('tab', [{ value: 'body', label: 'からだ' }, { value: 'photo', label: '写真' }], tab)}
    <div class="scope">${tab === 'body' ? bodyHTML() : photoHTML()}</div>
  </div>`;

  if (tab === 'photo') hydratePhotos(root);
  bindCharts(root);
  // グラフで選んだ日の写真を表示
  const svg = root.querySelector('svg.line-chart');
  if (svg && chartRanges.length) {
    svg.addEventListener('chartselect', (e) => {
      chartSel = e.detail.index;
      const panel = root.querySelector('[data-chart-photo]');
      if (panel) panel.innerHTML = chartPhotoHTML(chartSel);
    });
    const initial = chartSel !== null && chartSel < chartRanges.length ? chartSel : chartRanges.length - 1;
    if (chartSel !== null) svg.selectIndex(initial);
    const panel = root.querySelector('[data-chart-photo]');
    if (panel) panel.innerHTML = chartPhotoHTML(initial);
  }
  if (openBody) setTimeout(() => bodyEditor({}), 50);

  root.onclick = async (e) => {
    const seg = e.target.closest('[data-seg] [data-v]');
    if (seg) {
      if (seg.closest('[data-seg]').dataset.seg === 'pose') { pose = seg.dataset.v; pick = { a: null, b: null }; }
      else tab = seg.dataset.v;
      app.refresh();
      return;
    }
    if (handleEditClick(e)) return;
    if (e.target.closest('[data-add-body]')) { bodyEditor({}); return; }
    const m = e.target.closest('[data-metric]');
    if (m) { metric = m.dataset.metric; chartSel = null; app.refresh(); return; }
    const pr = e.target.closest('[data-period]');
    if (pr) { period = pr.dataset.period; chartSel = null; app.refresh(); return; }
    if (e.target.closest('[data-camera]')) { openCamera({ pose, onSaved: (rec) => { pose = rec.pose; pick = { a: null, b: null }; } }); return; }
    const vw = e.target.closest('[data-viewer]');
    if (vw) { openPhotoViewer({ pose: vw.dataset.pose || pose, startId: vw.dataset.viewer || null, onEdit: (id) => openPhoto(id, app) }); return; }
    if (e.target.closest('[data-more-body]')) { bodyLimit += 20; app.refresh(); return; }
    // 写真
    const ps = e.target.closest('[data-pose]');
    if (ps) { pose = ps.dataset.pose; pick = { a: null, b: null }; app.refresh(); return; }
    const cm = e.target.closest('[data-cmp]');
    if (cm) { cmpMode = cm.dataset.cmp; app.refresh(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const id = pk.dataset.pick;
      const which = pk.dataset.slot;
      pick[which] = id;
      app.refresh();
      return;
    }
    const sw = e.target.closest('[data-swap]');
    if (sw) { pick = { a: pick.b, b: pick.a }; app.refresh(); return; }
    const ph = e.target.closest('[data-photo]');
    if (ph) { openPhotoViewer({ startId: ph.dataset.photo, onEdit: (id) => openPhoto(id, app) }); }
  };
  root.onchange = async (e) => {
    if (e.target.matches('input[type=file][name=photo]')) {
      const files = [...e.target.files];
      e.target.value = '';
      if (!files.length) return;
      await addPhotos(files, pose, app);
    }
  };
  root.oninput = (e) => {
    if (e.target.matches('[data-slider]')) {
      const top = root.querySelector('.cmp-slider .top');
      const line = root.querySelector('.cmp-slider .divider');
      if (top) top.style.clipPath = `inset(0 ${100 - e.target.value}% 0 0)`;
      if (line) line.style.left = `${e.target.value}%`;
    }
  };
}

/* ---------- からだ ---------- */
function series(id) {
  const recs = S.body.filter((b) => b[id] !== null && b[id] !== undefined && b[id] !== '').sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : (a.date < b.date ? -1 : 1)));
  // 同じ日は最後の値
  const byDay = new Map();
  for (const r of recs) byDay.set(r.date, Number(r[id]));
  return [...byDay.entries()].map(([x, y]) => ({ x, y }));
}

function aggregate(pts, per) {
  if (per === 'day') {
    const since = addDays(today(), -60);
    const recent = pts.filter((p) => p.x >= since);
    return recent.length >= 2 ? recent : pts.slice(-30);
  }
  const keyFn = per === 'week' ? (p) => weekStart(p.x) : (p) => monthKey(p.x) + '-01';
  const g = groupBy(pts, keyFn);
  const out = [...g.entries()].map(([k, arr]) => ({
    x: k, y: arr.reduce((t, p) => t + p.y, 0) / arr.length,
    label: per === 'month' ? `${Number(k.slice(5, 7))}月` : fmtDate(k, { weekday: false }),
  })).sort((a, b) => (a.x < b.x ? -1 : 1));
  return out.slice(per === 'week' ? -26 : -24);
}

function bodyHTML() {
  const sorted = [...S.body].sort(byDateDesc);
  const md = METRICS.find((m) => m.id === metric);
  const pts = aggregate(series(metric), period);
  chartRanges = pts.map((p) => {
    if (period === 'day') return [p.x, p.x];
    if (period === 'week') return [p.x, addDays(p.x, 6)];
    const d = parseYmd(p.x); return [p.x, ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
  });
  const marks = new Set();
  chartRanges.forEach(([a, b], i) => { if (S.photos.some((ph) => ph.date >= a && ph.date <= b)) marks.add(i); });
  const cards = METRICS.map((m) => {
    const s = series(m.id);
    if (!s.length) return `<button type="button" class="metric empty-m ${m.id === metric ? 'on' : ''}" data-metric="${m.id}" style="--c:${m.color}"><span class="m-name"><i></i>${m.name}</span><b class="muted">—</b><small>未記録</small></button>`;
    const last = s[s.length - 1]; const first = s[0];
    const diff = last.y - first.y;
    return `<button type="button" class="metric ${m.id === metric ? 'on' : ''}" data-metric="${m.id}" style="--c:${m.color}">
      <span class="m-name"><i></i>${m.name}</span><b class="num">${last.y.toFixed(m.dec)}<small>${m.unit}</small></b>
      <small>${s.length > 1 ? `はじめから ${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff).toFixed(m.dec)}${m.unit}` : relDay(last.x)}</small>
      ${s.length > 1 ? `<span class="m-spark">${sparkline(s.slice(-12).map((x) => x.y), m.color)}</span>` : ''}
    </button>`;
  }).join('');
  return `
    <div class="metrics">${cards}</div>
    <button type="button" class="btn btn-primary btn-block btn-lg" data-add-body>${icon('scale', 20)}身体測定を記録</button>
    ${secH(`${md.name}の推移`, `<div class="mini-seg">${[['day', '日'], ['week', '週'], ['month', '月']].map(([v, l]) => `<button type="button" class="${period === v ? 'on' : ''}" data-period="${v}">${l}</button>`).join('')}</div>`)}
    <section class="card chart-card">
      ${lineChart(pts, { unit: md.unit, color: md.color, decimals: md.dec, marks, empty: `${md.name}を2回以上記録すると、ここにグラフが表示されます` })}
      <p class="fine">${period === 'day' ? '直近60日の記録' : period === 'week' ? '週ごとの平均（最大26週）' : '月ごとの平均（最大24か月）'}${pts.length ? '・グラフをタップすると、その日の値と写真が見られます' : ''}${marks.size ? '<span class="mark-legend"><i></i>写真あり</span>' : ''}</p>
      ${pts.length ? '<div class="chart-photo" data-chart-photo></div>' : ''}
    </section>
    <div class="note-card">${icon('info', 18)}<p>体重は水分や食事で日々上下します。増えても失敗ではありません。体重だけで判断せず、写真やウエスト、からだの感覚もあわせて成長を見ていきましょう。</p></div>
    ${secH('測定の記録', `<span class="sec-note">${sorted.length}件</span>`)}
    ${sorted.length ? `<div class="card list-card"><div class="rec-list">${sorted.slice(0, bodyLimit).map((b) => bodyRow({ ...b, note: `${fmtDateLong(b.date)}${b.note ? ' ・ ' + b.note : ''}` })).join('')}</div></div>
      ${sorted.length > bodyLimit ? '<button type="button" class="btn btn-ghost btn-block" data-more-body>もっと見る</button>' : ''}` : emptyState('scale', 'まだ記録がありません', '体重を記録すると、ここに一覧が表示されます。')}`;
}

/** グラフで選んだ点の写真パネル */
function chartPhotoHTML(i) {
  const range = chartRanges[i];
  if (!range) return '';
  const [from, to] = range;
  const tol = period === 'day' ? 7 : period === 'week' ? 14 : 31;
  const { photo, exact } = photoForRange(from, to, { tolerance: tol });
  const label = period === 'day' ? fmtDateLong(from) : period === 'week' ? `${fmtDate(from, { weekday: false })}〜${fmtDate(to, { weekday: false })}の週` : `${Number(from.slice(5, 7))}月`;
  if (!photo) {
    return `<div class="cp-empty">${icon('camera', 18)}<span><b>${label}</b>の写真はありません</span><button type="button" class="pill-btn" data-camera>撮影する</button></div>`;
  }
  const w = weightNear(photo.date);
  return `<button type="button" class="cp-card" data-viewer="${photo.id}" data-pose="${photo.pose}">
    <img src="${photo.thumb}" alt="">
    <span class="cp-text">
      <small>${exact ? (period === 'day' ? 'この日の写真' : 'この期間の写真') : '近い日の写真'}</small>
      <strong>${fmtDateLong(photo.date)}</strong>
      <span>${poseName(photo.pose)}${w ? ` ・ ${w.toFixed(1)}kg` : ''}</span>
    </span>
    <span class="cp-go">変遷を見る${icon('right', 14)}</span>
  </button>`;
}

/* ---------- 写真 ---------- */

function photoHTML() {
  const list = photosOf(pose);
  if (list.length >= 2) {
    if (!pick.a || !list.some((x) => x.id === pick.a)) pick.a = list[0].id;
    if (!pick.b || !list.some((x) => x.id === pick.b)) pick.b = list[list.length - 1].id;
  }
  const A = list.find((x) => x.id === pick.a);
  const B = list.find((x) => x.id === pick.b);
  const all = [...S.photos].sort(byDateDesc);
  return `
    <section class="cam-hero">
      <div class="cam-hero-art" aria-hidden="true">
        <svg viewBox="0 0 300 400"><g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-dasharray="14 12">
          <ellipse cx="150" cy="92" rx="37" ry="47"/>
          <path d="M133 136 C133 150 131 158 121 164 C101 172 73 174 59 186 C45 198 41 216 41 238 L35 330 C33 360 35 388 36 400"/>
          <path d="M167 136 C167 150 169 158 179 164 C199 172 227 174 241 186 C255 198 259 216 259 238 L265 330 C267 360 265 388 264 400"/>
        </g></svg>
      </div>
      <div class="cam-hero-text">
        <p class="lt-kicker">BODY PHOTO</p>
        <h3>上半身を、いつも同じ画角で</h3>
        <p>シルエットと水平器のガイドに合わせるだけ。前回の写真を重ねて位置もそろえられます。</p>
      </div>
      <button type="button" class="btn btn-light btn-block btn-lg" data-camera>${icon('camera', 20)}ガイド付きで撮影</button>
      <label class="cam-hero-file file-btn">${icon('image', 15)}アルバムから選ぶ<input type="file" name="photo" accept="image/*" multiple></label>
    </section>

    <div class="pose-row">${segmented('pose', POSES, pose)}</div>

    ${secH('これまでの変遷', list.length ? `<span class="sec-note">${list.length}枚</span>` : '')}
    ${list.length ? `<button type="button" class="card film-card" data-viewer="" data-pose="${pose}">
      <div class="film">${filmstripHTML(list)}</div>
      <div class="film-foot">
        <span class="film-play"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg></span>
        <span class="film-text"><strong>コマ送りで見る</strong><small>${fmtDate(list[0].date, { weekday: false })} 〜 ${fmtDate(list[list.length - 1].date, { weekday: false })}・左右スワイプで1枚ずつ</small></span>
        ${icon('right', 18)}
      </div>
    </button>` : emptyState('growth', `${poseName(pose)}の写真はまだありません`, '撮影を続けると、からだの変化をパラパラ漫画のように見返せます。')}

    ${secH('ビフォー・アフター')}
    <section class="card">
      ${list.length < 2 ? emptyState('compare', `${poseName(pose)}の写真が2枚以上で比較できます`, `過去と今を並べて、見た目の変化を確かめられます。${list.length ? 'あと1枚です。' : ''}`) : `
        <div class="mini-seg wide">${[['side', '並べて比較'], ['slider', 'スライダー']].map(([v, l]) => `<button type="button" class="${cmpMode === v ? 'on' : ''}" data-cmp="${v}">${l}</button>`).join('')}</div>
        ${cmpMode === 'side' ? `
          <div class="cmp-side">
            <figure><img data-full="${A.id}" alt="ビフォー"><figcaption>BEFORE<span>${fmtDateLong(A.date)}</span></figcaption></figure>
            <figure><img data-full="${B.id}" alt="アフター"><figcaption>AFTER<span>${fmtDateLong(B.date)}</span></figcaption></figure>
          </div>` : `
          <div class="cmp-slider">
            <img class="bottom" data-full="${B.id}" alt="アフター">
            <img class="top" data-full="${A.id}" alt="ビフォー" style="clip-path:inset(0 50% 0 0)">
            <span class="divider" style="left:50%"></span>
            <span class="tag l">BEFORE ${fmtDate(A.date, { weekday: false })}</span><span class="tag r">AFTER ${fmtDate(B.date, { weekday: false })}</span>
          </div>
          <input type="range" min="0" max="100" value="50" data-slider class="range" aria-label="比較スライダー">`}
        <p class="cmp-diff">${diffText(A.date, B.date)}</p>
        <p class="list-label">BEFORE を選ぶ</p>
        <div class="thumb-strip">${list.map((x) => thumbBtn(x, 'a', pick.a === x.id)).join('')}</div>
        <p class="list-label">AFTER を選ぶ</p>
        <div class="thumb-strip">${list.map((x) => thumbBtn(x, 'b', pick.b === x.id)).join('')}</div>
      `}
    </section>

    ${secH('すべての写真', `<span class="sec-note">${all.length}枚</span>`)}
    ${all.length ? `<div class="gallery">${all.map((x) => `<button type="button" class="g-item" data-photo="${x.id}"><img src="${x.thumb}" alt="" loading="lazy"><span>${fmtDate(x.date, { weekday: false })} ${poseName(x.pose)}</span></button>`).join('')}</div>` : emptyState('image', 'まだ写真がありません', '今の身体が、未来の自分にとっての「ビフォー」になります。')}`;
}

function diffText(a, b) {
  const days = Math.round((new Date(b) - new Date(a)) / 86400000);
  if (days <= 0) return '';
  if (days < 14) return `${days}日間の変化`;
  if (days < 60) return `約${Math.round(days / 7)}週間の変化`;
  return `約${Math.round(days / 30)}か月間の変化`;
}

function thumbBtn(x, slot, on) {
  return `<button type="button" class="thumb ${on ? 'on' : ''}" data-pick="${x.id}" data-slot="${slot}"><img src="${x.thumb}" alt=""><span>${fmtDate(x.date, { weekday: false })}</span></button>`;
}

async function hydratePhotos(root) {
  for (const img of root.querySelectorAll('img[data-full]')) {
    const meta = S.photos.find((p) => p.id === img.dataset.full);
    if (meta) img.src = meta.thumb; // まずは小さな画像
    const u = await fullUrl(img.dataset.full);
    if (u) img.src = u;
  }
}

async function addPhotos(files, p) {
  toast('写真を保存しています…', { duration: 1500, icon: 'image' });
  let count = 0;
  for (const file of files) {
    try {
      await savePhotoFile(file, { pose: p });
      count++;
    } catch (err) {
      console.error(err);
      toast('保存できない写真がありました（容量不足の可能性があります）');
    }
  }
  if (count) {
    pose = p;
    pick = { a: null, b: null };
    await notify({ message: `写真を${count}枚保存しました` });
  }
}

async function openPhoto(id, app) {
  const meta = S.photos.find((p) => p.id === id);
  if (!meta) return;
  openSheet({
    title: `${fmtDateLong(meta.date)} ・ ${poseName(meta.pose)}`,
    wide: true,
    html: `<div class="photo-view"><img src="${meta.thumb}" alt="" data-big></div>
      <div class="field"><span class="field-label">ポーズ</span>${choice('editPose', POSES, meta.pose)}</div>
      <div class="sheet-actions"><button type="button" class="btn btn-text-danger" data-del>${icon('trash', 16)}削除する</button><button type="button" class="btn btn-primary" data-close>閉じる</button></div>`,
    async onMount(body, close) {
      const u = await fullUrl(id);
      if (u) body.querySelector('[data-big]').src = u;
      body.addEventListener('change', async (e) => {
        if (e.target.name === 'editPose') {
          await store.saveRecord('photos', { ...meta, pose: e.target.value }, { silent: true });
          toast('ポーズを変更しました');
          app.refresh();
        }
      });
      body.addEventListener('click', async (e) => {
        if (e.target.closest('[data-del]')) {
          if (!(await confirmDialog('この写真を削除しますか？<br><small>削除すると元に戻せません。</small>', { ok: '削除する', danger: true }))) return;
          await store.deleteRecord('photos', id);
          forgetUrl(id);
          close();
          await notify({ message: '写真を削除しました', silentXP: true });
        }
      });
    },
  });
}

export { removeWithUndo };
