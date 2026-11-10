// SVGで描くグラフ（外部ライブラリなし・オフラインでも動作）
import { fmtNum, parseYmd } from './util.js';

/** 円形の進捗リング */
export function ring(progress, { size = 120, stroke = 10, color = 'var(--primary)', track = 'var(--line)', gold = false } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress || 0));
  const gid = 'rg' + Math.random().toString(36).slice(2, 7);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    ${gold ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2FA08D"/><stop offset=".75" stop-color="#22806F"/><stop offset="1" stop-color="#C9A55C"/></linearGradient></defs>` : ''}
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle class="ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${gold ? `url(#${gid})` : color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 ${size / 2} ${size / 2})"
      style="--c:${c};--o:${c * (1 - p)}"/>
  </svg>`;
}

/** 4つのステータスのレーダーチャート（ひし形） */
export function radar(stats, defs, { size = 200 } = {}) {
  const cx = size / 2; const cy = size / 2; const R = size / 2 - 26;
  const vals = defs.map((d) => stats[d.id]);
  const maxV = Math.max(60, ...vals) * 1.15;
  const angle = (i) => (-Math.PI / 2) + (i * 2 * Math.PI) / defs.length;
  const pt = (i, f) => [cx + Math.cos(angle(i)) * R * f, cy + Math.sin(angle(i)) * R * f];
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${defs.map((_, i) => pt(i, f).join(',')).join(' ')}" fill="none" stroke="var(--line)" stroke-width="1"/>`).join('');
  const axes = defs.map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}" stroke="var(--line)" stroke-width="1"/>`).join('');
  const poly = defs.map((d, i) => pt(i, Math.max(0.06, stats[d.id] / maxV)).join(',')).join(' ');
  const dots = defs.map((d, i) => { const [x, y] = pt(i, Math.max(0.06, stats[d.id] / maxV)); return `<circle cx="${x}" cy="${y}" r="3.5" fill="${d.color}" stroke="#fff" stroke-width="1.5"/>`; }).join('');
  const labels = defs.map((d, i) => {
    const [x, y] = pt(i, 1.1);
    const anchor = x < cx - 1 ? 'end' : x > cx + 1 ? 'start' : 'middle';
    const dy = y < cy - 1 ? -2 : y > cy + 1 ? 12 : 4;
    return `<text x="${x}" y="${y + dy}" text-anchor="${anchor}" font-size="11" fill="var(--ink-2)" font-weight="600">${d.name}</text>`;
  }).join('');
  return `<svg class="radar" viewBox="-64 0 ${size + 128} ${size}" width="100%" style="max-width:${size + 128}px" aria-hidden="true">
    ${grid}${axes}
    <polygon class="radar-area" points="${poly}" fill="rgba(34,128,111,.16)" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round"/>
    ${dots}${labels}
  </svg>`;
}

/**
 * 折れ線グラフ
 * @param {Array<{x:string(YYYY-MM-DD), y:number, label?:string}>} pts
 */
export function lineChart(pts, { unit = '', color = '#22806F', height = 190, decimals = 1, empty = 'まだデータがありません' } = {}) {
  const W = 340; const H = height;
  const padL = 36; const padR = 12; const padT = 18; const padB = 26;
  if (!pts.length) {
    return `<div class="chart-empty">${empty}</div>`;
  }
  const xs = pts.map((p) => parseYmd(p.x).getTime());
  const ys = pts.map((p) => p.y);
  let minX = Math.min(...xs); let maxX = Math.max(...xs);
  if (minX === maxX) { minX -= 86400000 * 3; maxX += 86400000 * 3; }
  let minY = Math.min(...ys); let maxY = Math.max(...ys);
  const span = Math.max(maxY - minY, Math.abs(maxY) * 0.02, 1);
  minY -= span * 0.25; maxY += span * 0.25;
  const X = (x) => padL + ((x - minX) / (maxX - minX)) * (W - padL - padR);
  const Y = (y) => padT + (1 - (y - minY) / (maxY - minY)) * (H - padT - padB);

  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = minY + ((maxY - minY) * i) / ticks;
    const y = Y(v);
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1" ${i === 0 ? '' : 'stroke-dasharray="2 4"'}/>`;
    grid += `<text x="${padL - 6}" y="${y + 3.5}" text-anchor="end" font-size="9.5" fill="var(--ink-3)">${fmtNum(v, decimals)}</text>`;
  }
  // X軸ラベル（最大4つ）
  let xl = '';
  const n = pts.length;
  const idxs = n <= 4 ? pts.map((_, i) => i) : [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1];
  for (const i of [...new Set(idxs)]) {
    const d = parseYmd(pts[i].x);
    xl += `<text x="${X(xs[i])}" y="${H - 8}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${pts[i].label || `${d.getMonth() + 1}/${d.getDate()}`}</text>`;
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area = `${line} L${X(xs[n - 1]).toFixed(1)},${H - padB} L${X(xs[0]).toFixed(1)},${H - padB} Z`;
  const gid = 'lg' + Math.random().toString(36).slice(2, 7);
  const dots = pts.map((p, i) => `<circle cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${n > 40 ? 0 : 3}" fill="#fff" stroke="${color}" stroke-width="2"/>`).join('');
  const last = pts[n - 1];
  const lx = X(xs[n - 1]); const ly = Y(last.y);
  return `<svg class="line-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="推移グラフ">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xl}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <circle cx="${lx}" cy="${ly}" r="5" fill="${color}" stroke="#fff" stroke-width="2"/>
    <g transform="translate(${Math.min(lx, W - 44)},${Math.max(ly - 12, 10)})"><text text-anchor="middle" font-size="10.5" font-weight="700" fill="${color}">${fmtNum(last.y, decimals)}${unit}</text></g>
  </svg>`;
}

/** 小さな棒グラフ（直近の日々のXPなど） */
export function miniBars(values, { height = 44, color = 'var(--primary)', labels = [] } = {}) {
  const W = 300; const H = height; const n = values.length;
  const max = Math.max(1, ...values);
  const bw = W / n;
  const bars = values.map((v, i) => {
    const h = v ? Math.max(3, (v / max) * (H - 14)) : 2;
    return `<rect x="${i * bw + bw * 0.2}" y="${H - 12 - h}" width="${bw * 0.6}" height="${h}" rx="2" fill="${v ? color : 'var(--line)'}"/>`;
  }).join('');
  const lbl = labels.map((l, i) => `<text x="${i * bw + bw / 2}" y="${H - 1}" text-anchor="middle" font-size="9" fill="var(--ink-3)">${l}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" aria-hidden="true">${bars}${lbl}</svg>`;
}
