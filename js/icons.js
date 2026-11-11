// アプリ内で使う線画アイコン（SVG）
const P = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  dumbbell: '<path d="M6.5 7v10M4 9.5v5M17.5 7v10M20 9.5v5M6.5 12h11"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  growth: '<path d="M4 19c1.5-6.5 6-11 15-13"/><path d="M4 19c2-3.8 5-6.4 9-8"/><path d="M4 19c1.6-1.6 3.4-2.8 5.5-3.4"/>',
  user: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  run: '<circle cx="14.5" cy="4.8" r="1.8"/><path d="m7 21 3.2-5.6 3 2.3V22M8 10.5l3-2.5 3.5 1 2 3.5 3 .8M10.2 15.4 11.6 9"/>',
  walk: '<circle cx="12.5" cy="4.6" r="1.8"/><path d="M9 21l2-6 2.6 2.4V21M8.5 12.5l2-4.3 3 .6 1.6 3.2 2.2 1M11 15l1.2-6.2"/>',
  cycle: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16 9.5 9h5l3.5 7M9.5 9 12 16h-6M13 6h2.5l-1 3"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  meal: '<path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6M16.5 21V3c-2 1-3 4-3 7 0 1.6 1.3 2.5 3 2.5"/>',
  cup: '<path d="M7 4h10l-1.3 15.2A2 2 0 0 1 13.7 21h-3.4a2 2 0 0 1-2-1.8z"/><path d="M7.4 9h9.2"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4.5 4.5 0 0 1 6 0M12 9.8 13.2 8"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.4"/>',
  flame: '<path d="M12 21c-3.6 0-6-2.4-6-5.6 0-3.4 2.8-5 3.5-8.4 1.8 1.2 2.6 3 2.6 4.6 1-.6 1.8-1.8 2-3.2 2 1.8 3.9 4 3.9 7 0 3.2-2.4 5.6-6 5.6z"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  bolt: '<path d="M13 3 6 13.5h5.5L10.5 21 18 10h-5.5z"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
  crown: '<path d="M4 8l4 3.5L12 5l4 6.5L20 8l-1.5 10h-13z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5"/>',
  edit: '<path d="M5 19h3.5L19 8.5 15.5 5 5 15.5z"/><path d="m13.5 7 3.5 3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 5-4.5 3.5 3 2.5-2 4 3.5"/>',
  compare: '<rect x="3.5" y="5" width="7.5" height="14" rx="1.5"/><rect x="13" y="5" width="7.5" height="14" rx="1.5"/>',
  share: '<path d="M12 4v11M8 7.5 12 4l4 3.5M6 11v7.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V11"/>',
  heart: '<path d="M12 19.5s-7-4.3-7-9.4A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z"/>',
  moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>',
  laptop: '<rect x="5" y="5.5" width="14" height="9.5" rx="1.5"/><path d="M3 18.5h18"/>',
  briefcase: '<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2M4 13h16"/>',
  glass: '<path d="M7 4h10l-1 6a4 4 0 0 1-8 0zM12 14v6M8.5 20h7"/>',
  drop: '<path d="M12 4c3 3.6 5.5 6.6 5.5 9.8a5.5 5.5 0 0 1-11 0C6.5 10.6 9 7.600 12 4z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
};

export function icon(name, size = 22, cls = '') {
  const body = P[name] || P.spark;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** EVOLVEのロゴマーク。stage(1〜5)に応じて弧が点灯する */
export function logoMark(size = 32, stage = 5, opts = {}) {
  const c = opts.color || '#22806F';
  const op = [0.4, 0.7, 1];
  const gid = 'g' + Math.random().toString(36).slice(2, 7);
  return `<svg class="logo-mark ${stage >= 5 ? 'glow' : ''}" width="${size}" height="${size}" viewBox="120 110 300 300" aria-hidden="true">
  <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6E2A8"/><stop offset="1" stop-color="#C99B47"/></linearGradient></defs>
  <g transform="translate(-6 -10)" fill="none" stroke-linecap="round" stroke="${c}" stroke-width="30">
    <path d="M146 382 A 84 84 0 0 1 230 298" opacity="${op[0]}"/>
    <path d="M146 382 A 158 158 0 0 1 304 224" opacity="${stage >= 2 ? op[1] : 0.12}"/>
    <path d="M146 382 A 232 232 0 0 1 362 152" opacity="${stage >= 3 ? op[2] : 0.12}"/>
    <circle cx="384" cy="146" r="25" fill="url(#${gid})" stroke="none" opacity="${stage >= 4 ? 1 : 0.18}"/>
  </g></svg>`;
}
