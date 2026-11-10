// HOME：現在の成長状況
import * as store from '../store.js';
import { S } from '../store.js';
import { computeGame, STAT_DEFS, rankFor, levelTimeline, ACHIEVEMENTS, proteinOf, xpOnDate } from '../game.js';
import { workoutKcal, cardioRecordKcal } from '../calc.js';
import { icon, logoMark } from '../icons.js';
import { ring, radar, miniBars } from '../charts.js';
import { largeTitle, secH, countAttr } from '../ui.js';
import { openDaySheet, unitLabel } from '../records.js';
import { notify } from '../app.js';
import { openHealthImport } from '../health.js';
import { today, addDays, fmtNum, fmtDate, greeting, esc, parseYmd, ymd, pad, diffDays, relDay, byDateDesc } from '../util.js';

let calMonth = null;

export function render(root, app) {
  const g = app.game;
  const t = today();
  if (!calMonth) calMonth = t.slice(0, 7);
  const prevWeek = computeGame({ asOf: addDays(t, -7) });
  const p = S.profile || {};

  const d = parseYmd(t);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  root.innerHTML = `
  <div class="page home">
    ${largeTitle({
      kicker: `${d.getMonth() + 1}月${d.getDate()}日 ${wd}曜日`,
      title: greeting(),
      short: 'EVOLVE',
      right: `<a class="avatar" href="#profile" aria-label="プロフィール">${logoMark(26, g.stage.index)}<span class="avatar-lv num">${g.level}</span></a>`,
    })}
    ${levelCard(g)}
    ${activityCard()}
    ${secH('今日のおすすめ')}
    ${recommendCard(g, p)}
    ${secH('ステータス', '<span class="sec-note">今週の伸び</span>')}
    ${statusCard(g, prevWeek)}
    ${secH(`${Number(t.slice(5, 7))}月の積み重ね`)}
    ${monthCard(g)}
    ${calendarCard(g)}
    ${secH('最近の成長記録')}
    ${feedCard(g)}
    <p class="tagline">${logoMark(16, 5)}昨日の自分を、少しずつ超えていく。</p>
  </div>`;

  root.onclick = async (e) => {
    const nav = e.target.closest('[data-go]');
    if (nav) { app.go(nav.dataset.go, nav.dataset.params ? JSON.parse(nav.dataset.params) : {}); return; }
    if (e.target.closest('[data-shake]')) { await addShake(); return; }
    if (e.target.closest('[data-health]')) { openHealthImport(); return; }
    const cm = e.target.closest('[data-cal]');
    if (cm) {
      const d = parseYmd(calMonth + '-01');
      d.setMonth(d.getMonth() + Number(cm.dataset.cal));
      calMonth = ymd(d).slice(0, 7);
      root.querySelector('[data-calendar]').outerHTML = calendarCard(g);
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) openDaySheet(day.dataset.day, g);
  };
}

async function addShake() {
  const amount = S.settings.proteinPerShake || 20;
  const rec = await store.saveRecord('meals', { date: today(), slot: 'protein', content: 'プロテイン', protein: amount });
  await notify({
    message: `プロテイン ${amount}g を記録しました`,
    undo: { label: '取り消す', onClick: async () => { await store.deleteRecord('meals', rec.id); await notify({ message: '取り消しました', silentXP: true }); } },
  });
}

function levelCard(g) {
  const progress = g.into / g.next;
  const todayXP = xpOnDate(g, today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  const vals = days.map((d) => xpOnDate(g, d));
  const labels = days.map((d) => ['日', '月', '火', '水', '木', '金', '土'][parseYmd(d).getDay()]);
  return `
  <section class="hero" aria-label="レベル">
    <div class="hero-water" aria-hidden="true">${logoMark(260, 5, { color: '#ffffff' })}</div>
    <div class="hero-top">
      <div class="hero-ring">
        ${ring(progress, { size: 118, stroke: 8, track: 'rgba(255,255,255,.14)', grad: ['#F6E2A8', '#D9B86A', '#C99B47'] })}
        <div class="hero-ring-c"><span>LEVEL</span><strong class="num" ${countAttr('lv', g.level)}>${g.level}</strong></div>
      </div>
      <div class="hero-meta">
        <span class="stage-chip">${logoMark(14, g.stage.index, { color: '#ffffff' })}${g.stage.name}・${g.stage.label}</span>
        <h2 class="hero-title">${esc(g.title)}</h2>
        <p class="hero-total"><strong class="num" ${countAttr('xp', g.totalXP)}>${fmtNum(g.totalXP)}</strong><span>XP</span></p>
      </div>
    </div>
    <div class="hero-progress">
      <div class="hero-bar" role="progressbar" aria-valuenow="${Math.round(progress * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${(progress * 100).toFixed(1)}%"></i></div>
      <div class="hero-bar-l"><span>Lv${g.level + 1} まで <b class="num">${fmtNum(g.toNext)}</b> XP</span><span class="num">${fmtNum(g.into)} / ${fmtNum(g.next)}</span></div>
    </div>
    <div class="hero-week">
      <div class="hero-week-h"><span>この7日間</span><span class="today-xp ${todayXP ? 'on' : ''}">今日 <b class="num">+${todayXP}</b> XP</span></div>
      ${miniBars(vals, { labels, color: 'rgba(255,255,255,.55)', empty: 'rgba(255,255,255,.14)', highlight: 6, hiColor: '#E7C77E', labelColor: 'rgba(255,255,255,.6)', height: 50 })}
    </div>
  </section>`;
}

/** Apple Watch（ヘルスケア）から取り込んだ今日の活動 */
function activityCard() {
  const daily = S.daily || [];
  if (!daily.length) return '';
  const t = today();
  const latest = [...daily].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const cur = daily.find((x) => x.date === t) || latest;
  const goal = S.settings.stepGoal || 8000;
  const steps = Number(cur.steps) || 0;
  const days = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6));
  const vals = days.map((d) => Number((daily.find((x) => x.date === d) || {}).steps) || 0);
  const labels = days.map((d) => ['日', '月', '火', '水', '木', '金', '土'][parseYmd(d).getDay()]);
  return `
  ${secH(cur.date === t ? '今日の活動' : '最近の活動', '<button type="button" class="sec-link" data-health>' + icon('download', 14) + '取り込む</button>')}
  <section class="card activity">
    <div class="act-top">
      <div class="act-ring">
        ${ring(steps / goal, { size: 104, stroke: 10, grad: ['#5AA9D6', '#3B7FA8'], track: 'rgba(59,127,168,.12)' })}
        <div class="act-ring-c"><strong class="num" ${countAttr('steps', steps)}>${fmtNum(steps)}</strong><span>歩</span></div>
      </div>
      <div class="act-side">
        <p class="act-date">${cur.date === t ? '今日' : `${fmtDate(cur.date)}の記録`}・目標 ${fmtNum(goal)}歩</p>
        <div class="act-stat"><span class="act-ic" style="--c:#D9774B">${icon('flame', 15)}</span><b class="num">${cur.activeKcal ? fmtNum(cur.activeKcal) : '—'}</b><small>kcal アクティブ</small></div>
        <div class="act-stat"><span class="act-ic" style="--c:#3B7FA8">${icon('target', 15)}</span><b class="num">${Math.min(999, Math.round((steps / goal) * 100))}</b><small>% 目標達成</small></div>
      </div>
    </div>
    ${miniBars(vals, { labels, color: '#3B7FA8', highlight: vals.length - 1, hiColor: '#5AA9D6', height: 54, goal })}
    <p class="fine">Apple Watch・iPhoneの「ヘルスケア」から取り込んだ記録です${S.meta.lastHealthImport ? `（最後の取り込み：${new Date(S.meta.lastHealthImport).getMonth() + 1}/${new Date(S.meta.lastHealthImport).getDate()}）` : ''}。</p>
  </section>`;
}

function lastDateOf(arr, fn = () => true) {
  let d = null;
  for (const r of arr) if (fn(r) && (!d || r.date > d)) d = r.date;
  return d;
}

function recommendCard(g, p) {
  const t = today();
  const recs = [];
  const exercisedToday = S.workouts.some((w) => w.date === t) || S.cardio.some((c) => c.date === t);
  const lastStr = lastDateOf(S.workouts);
  const lastCar = lastDateOf(S.cardio);

  if (exercisedToday) {
    recs.push({ ic: 'dumbbell', tone: 'green', done: true, title: '今日の運動、おつかれさまでした', sub: 'ストレッチとしっかりした睡眠で、身体の回復も成長のうち。' });
  } else if (!lastStr || diffDays(t, lastStr) >= 2) {
    // しばらく鍛えていない部位から提案
    const parts = { upper: '上半身', lower: '下半身', core: '体幹' };
    const lastByPart = {};
    for (const w of S.workouts) {
      const ex = store.exerciseById(w.exerciseId);
      const part = ex ? ex.part : null;
      if (part && (!lastByPart[part] || w.date > lastByPart[part])) lastByPart[part] = w.date;
    }
    const order = Object.keys(parts).sort((a, b) => (lastByPart[a] || '0') < (lastByPart[b] || '0') ? -1 : 1);
    const part = order[0];
    const ex = S.exercises.find((e) => e.part === part && !e.useWeight) || S.exercises[0];
    if (ex) {
      const last = [...S.workouts].filter((w) => w.exerciseId === ex.id).sort(byDateDesc)[0];
      const reps = last ? last.reps : (ex.unit === 'sec' ? 30 : 10);
      const sets = last ? last.sets : 3;
      recs.push({
        ic: 'dumbbell', tone: 'green',
        title: `${ex.name} ${reps}${unitLabel(ex.unit)}×${sets}セット`,
        sub: lastStr ? `前回の筋トレは${relDay(lastStr)}。今日は${parts[part]}を少しだけ。` : '最初の一歩は、たった1セットからでOK。',
        btn: '記録する', go: 'training', params: { mode: 'strength', add: ex.id },
      });
    }
  } else {
    const walkMin = 20;
    recs.push({
      ic: 'walk', tone: 'blue', title: `ウォーキング ${walkMin}分`,
      sub: lastCar ? `前回の有酸素は${relDay(lastCar)}。軽く歩くだけで持久力が育ちます。` : '筋トレの翌日は、軽い有酸素で持久力アップ。',
      btn: '記録する', go: 'training', params: { mode: 'cardio', kind: 'walk' },
    });
  }

  const goal = p.proteinGoal || 100;
  const pr = proteinOf(S.meals.filter((m) => m.date === t));
  if (pr.total >= goal) {
    recs.push({ ic: 'cup', tone: 'gold', done: true, title: `タンパク質 ${fmtNum(pr.total)}g 目標達成`, sub: '食事を楽しみながら、しっかり摂れています。' });
  } else {
    const need = Math.ceil(goal - pr.total);
    recs.push({
      ic: 'cup', tone: 'gold', title: `タンパク質 あと ${need}g`,
      sub: pr.total ? `今日は ${fmtNum(pr.total)}g。プロテイン1杯で近づけます。` : '食事のついでに、タンパク質を少し意識してみよう。',
      shake: true,
    });
  }

  const lastBody = lastDateOf(S.body);
  const lastPhoto = lastDateOf(S.photos);
  if (!lastBody || diffDays(t, lastBody) >= 7) {
    recs.push({ ic: 'scale', tone: 'sage', title: '体重を測ってみよう', sub: '週に1回で十分。増えても減っても、すべて大切なデータです。', btn: '測定する', go: 'growth', params: { add: 'body' } });
  } else if (!lastPhoto || diffDays(t, lastPhoto) >= 30) {
    recs.push({ ic: 'camera', tone: 'slate', title: '今の身体を写真に残そう', sub: '体重だけでは見えない変化が、写真には残ります。', btn: '撮影する', go: 'growth', params: { tab: 'photo' } });
  }

  return `
  <section class="card list-card">
    ${recs.slice(0, 3).map((r) => `
      <div class="reco ${r.done ? 'done' : ''} tone-${r.tone || 'green'}">
        <span class="reco-ic">${icon(r.ic, 19)}</span>
        <div class="reco-main"><strong>${esc(r.title)}</strong><span>${esc(r.sub)}</span></div>
        ${r.shake ? `<button type="button" class="pill-btn gold" data-shake>${icon('plus', 13)}${S.settings.proteinPerShake}g</button>` : ''}
        ${r.btn ? `<button type="button" class="pill-btn" data-go="${r.go}" data-params='${JSON.stringify(r.params)}'>${r.btn}</button>` : ''}
        ${r.done ? `<span class="reco-done">${icon('check', 16)}</span>` : ''}
      </div>`).join('')}
  </section>`;
}

function statusCard(g, prev) {
  return `
  <section class="card">
    <div class="status-wrap">
      <div class="status-radar">${radar(g.stats, STAT_DEFS, { size: 200 })}</div>
      <ul class="stat-list">
        ${STAT_DEFS.map((s) => {
          const v = g.stats[s.id]; const gain = v - prev.stats[s.id];
          return `<li style="--c:${s.color}">
            <span class="stat-name">${s.name}</span>
            <span class="stat-rank">${rankFor(v)}</span>
            <span class="stat-val num" ${countAttr('st-' + s.id, v)}>${fmtNum(v)}</span>
            <span class="stat-meter"><i style="width:${Math.min(100, (v / Math.max(60, ...Object.values(g.stats)) / 1.15) * 100).toFixed(1)}%"></i></span>
            <span class="stat-gain ${gain > 0 ? 'up' : ''}">${gain > 0 ? '+' + gain : '±0'}</span>
          </li>`;
        }).join('')}
      </ul>
    </div>
    <p class="fine">ステータスは記録の積み重ねから算出するゲーム内の成長指標です。実際の身体能力を医学的に測定した数値ではありません。</p>
  </section>`;
}

function monthCard(g) {
  const m = today().slice(0, 7);
  const ws = S.workouts.filter((w) => w.date.startsWith(m));
  const cs = S.cardio.filter((c) => c.date.startsWith(m));
  const exDays = new Set([...ws.map((w) => w.date), ...cs.map((c) => c.date)]);
  const strengthDays = new Set(ws.map((w) => w.date)).size;
  const sessions = strengthDays + cs.length;
  const kcal = ws.reduce((t, w) => t + workoutKcal(w), 0) + cs.reduce((t, c) => t + cardioRecordKcal(c), 0);
  const km = cs.reduce((t, c) => t + (Number(c.distanceKm) || 0), 0);
    return `
  <div class="kpis">
    <div class="kpi tone-green"><span class="kpi-ic">${icon('calendar', 16)}</span><span class="kpi-v num">${exDays.size}<small>日</small></span><span class="kpi-l">運動日数</span></div>
    <div class="kpi tone-blue"><span class="kpi-ic">${icon('bolt', 16)}</span><span class="kpi-v num">${sessions}<small>回</small></span><span class="kpi-l">運動回数</span></div>
    <div class="kpi tone-amber"><span class="kpi-ic">${icon('flame', 16)}</span><span class="kpi-v num">${fmtNum(kcal)}<small>kcal</small></span><span class="kpi-l">消費カロリー目安</span></div>
    <div class="kpi tone-gold"><span class="kpi-ic">${icon('spark', 16)}</span><span class="kpi-v num">${g.currentStreak}<small>日</small></span><span class="kpi-l">連続記録（ベスト${g.bestStreak}日）</span></div>
  </div>
  ${km ? `<p class="foot-note">有酸素の距離 ${fmtNum(km, 1)}km ・ 休んだ日があっても大丈夫</p>` : ''}`;
}

function calendarCard(g) {
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, m, 0).getDate();
  const t = today();
  const marks = {};
  const add = (d, k) => { (marks[d] = marks[d] || new Set()).add(k); };
  for (const w of S.workouts) if (w.date.startsWith(calMonth)) add(w.date, 's');
  for (const c of S.cardio) if (c.date.startsWith(calMonth)) add(c.date, 'c');
  for (const x of S.meals) if (x.date.startsWith(calMonth)) add(x.date, 'm');
  for (const b of S.body) if (b.date.startsWith(calMonth)) add(b.date, 'b');
  for (const p of S.photos) if (p.date.startsWith(calMonth)) add(p.date, 'b');
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<span class="cal-cell empty"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${calMonth}-${pad(d)}`;
    const mk = marks[ds];
    const ex = mk && (mk.has('s') || mk.has('c'));
    const future = ds > t;
    cells += `<button type="button" class="cal-cell ${ds === t ? 'today' : ''} ${ex ? 'ex' : ''} ${future ? 'future' : ''}" ${future ? 'disabled' : `data-day="${ds}"`}>
      <span class="cal-d">${d}</span>
      <span class="cal-dots">${mk ? ['s', 'c', 'm', 'b'].filter((k) => mk.has(k)).map((k) => `<i class="dot-${k}"></i>`).join('') : ''}</span>
    </button>`;
  }
  const isCurrent = calMonth === t.slice(0, 7);
  return `
  <section class="card" data-calendar>
    <div class="cal-head">
      <button type="button" class="icon-btn" data-cal="-1" aria-label="前の月">${icon('left', 20)}</button>
      <h2>${y}年${m}月</h2>
      <button type="button" class="icon-btn" data-cal="1" aria-label="次の月" ${isCurrent ? 'disabled' : ''}>${icon('right', 20)}</button>
    </div>
    <div class="cal-grid cal-wd">${['月', '火', '水', '木', '金', '土', '日'].map((w) => `<span>${w}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend"><span><i class="dot-s"></i>筋トレ</span><span><i class="dot-c"></i>有酸素</span><span><i class="dot-m"></i>食事</span><span><i class="dot-b"></i>測定・写真</span></div>
  </section>`;
}

function feedCard(g) {
  const t = today();
  const since = addDays(t, -30);
  const events = [];
  for (const e of levelTimeline(g)) if (e.date >= since) events.push({ date: e.date, ic: 'crown', gold: true, text: `<strong>Lv ${e.level}</strong> に到達しました` });
  for (const a of ACHIEVEMENTS) {
    const d = g.unlocked[a.id];
    if (d && d >= since) events.push({ date: d, ic: a.icon, gold: true, text: `実績「<strong>${esc(a.name)}</strong>」を達成` });
  }
  for (const pb of g.pbs.events) {
    if (pb.date >= since) {
      events.push({ date: pb.date, ic: 'star', text: `${esc(pb.name)} で自己ベスト <strong>${pb.kind === 'weight' ? fmtNum(pb.value, 1) + 'kg' : pb.value + unitLabel(pb.unit)}</strong>` });
    }
  }
  // 日々の積み重ね
  const dates = [...g.dayInfo.keys()].filter((d) => d >= since).sort().reverse().slice(0, 10);
  for (const d of dates) {
    const info = g.dayInfo.get(d);
    const bits = [];
    if (info.str) bits.push('筋トレ');
    if (info.car) bits.push('有酸素');
    if (info.meal) bits.push('食事');
    if (info.body) bits.push('測定');
    if (info.photo) bits.push('写真');
    if (bits.length) events.push({ date: d, ic: 'bolt', text: `${bits.join('・')}を記録 <span class="xp-mini">+${info.total}XP</span>`, low: true });
  }
  const startDate = (S.profile && S.profile.startDate) || null;
  if (startDate) events.push({ date: startDate, ic: 'growth', text: 'EVOLVEをはじめました。ここからが成長の記録です', low: true, start: true });

  events.sort((a, b) => (a.date === b.date ? (a.low ? 1 : 0) - (b.low ? 1 : 0) : (a.date < b.date ? 1 : -1)));
  const list = events.slice(0, 7);
  return `
  <section class="card">
    <ol class="feed">
      ${list.map((e) => `<li class="${e.gold ? 'gold' : ''}"><span class="feed-ic">${icon(e.ic, 16)}</span><span class="feed-text">${e.text}</span><time>${relDay(e.date)}</time></li>`).join('')}
    </ol>
    ${list.length <= 2 ? '<p class="muted small">記録するたびに、ここに成長の足あとが増えていきます。</p>' : ''}
  </section>`;
}
