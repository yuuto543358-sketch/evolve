// バックアップ（書き出し）と復元（読み込み）
import * as db from './db.js';
import { S, APP_VERSION, SCHEMA_VERSION, setMeta } from './store.js';
import { ymd, isYmd } from './util.js';

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBuf(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function buildBackup({ includePhotos = true } = {}) {
  const data = {
    profile: S.profile, settings: S.settings, meta: S.meta, achievements: S.achievements,
  };
  for (const s of db.RECORD_STORES) data[s] = await db.getAll(s);
  const photoBlobs = {};
  if (includePhotos) {
    const keys = await db.getAllKeys('photoBlobs');
    for (const k of keys) {
      const v = await db.get('photoBlobs', k);
      if (v && v.data) photoBlobs[k] = { type: v.type, base64: bufToBase64(v.data) };
    }
  } else {
    data.photos = []; // 写真を含めない場合は写真情報も除外
  }
  return {
    app: 'EVOLVE', schema: SCHEMA_VERSION, version: APP_VERSION,
    exportedAt: new Date().toISOString(), includesPhotos: includePhotos,
    data, photoBlobs,
  };
}

export async function exportBackup({ includePhotos = true } = {}) {
  const backup = await buildBackup({ includePhotos });
  const json = JSON.stringify(backup);
  const name = `evolve-backup-${ymd().replace(/-/g, '')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  let shared = false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: 'EVOLVE バックアップ' });
      shared = true;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return { cancelled: true };
  }
  if (!shared) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  await setMeta({ lastBackupAt: Date.now() });
  return { size: json.length, name };
}

export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'EVOLVE' || !obj.data || typeof obj.data !== 'object') throw new Error('EVOLVEのバックアップファイルではないようです');
  if (obj.schema > SCHEMA_VERSION) throw new Error('新しいバージョンのアプリで作られたバックアップです。アプリを更新してください');
  return true;
}

/* ---------- 読み込むファイルの検査 ----------
 * バックアップのファイルは「外から来る文字」です。だれかに細工されたファイルや、こわれたファイルを読み込んでも、
 * アプリが壊れたり、画面に危ない文字が出たりしないよう、保存する前に、形を確かめて整えます。
 * （画面に出すときにも、文字はすべて安全な形に直して出します。これは、その前の、もう1つの守りです）
 */
const KEY_RE = /^[A-Za-z0-9_.:-]{1,80}$/;        // 項目の名前
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;         // 記録のID
const TOKEN_RE = /^[A-Za-z0-9_.:-]{0,80}$/;      // 「breakfast」「run」のような、決まった言葉の項目
const TOKEN_FIELDS = new Set(['slot', 'kind', 'unit', 'part', 'pose', 'source', 'exerciseId', 'goal', 'sex', 'aiModel']);
const DATE_FIELDS = new Set(['date', 'startDate', 'planAsked']);
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_STR = 20000;
const MAX_THUMB = 600000;
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanValue(v, key = '', depth = 0) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    if (key === 'thumb') return v.length <= MAX_THUMB && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : undefined;
    if (TOKEN_FIELDS.has(key) && !TOKEN_RE.test(v)) return undefined;
    if (DATE_FIELDS.has(key) && !isYmd(v)) return undefined;
    return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  }
  if (depth >= 6) return undefined;
  if (Array.isArray(v)) return v.slice(0, 20000).map((x) => cleanValue(x, key, depth + 1)).filter((x) => x !== undefined);
  if (isPlain(v)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (!KEY_RE.test(k) || BAD_KEYS.has(k)) continue;
      const c = cleanValue(x, k, depth + 1);
      if (c !== undefined) o[k] = c;
    }
    return o;
  }
  return undefined;
}

function cleanRecord(store, r) {
  if (!isPlain(r) || typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  if (store !== 'exercises' && !isYmd(r.date)) return null;
  const c = cleanValue(r);
  return isPlain(c) && typeof c.id === 'string' ? c : null;
}

/** バックアップの中身を検査して、保存してよい形に整える（問題のある記録は取りのぞく） */
export function sanitizeBackup(obj) {
  const d = obj.data;
  let dropped = 0;
  const records = {};
  for (const s of db.RECORD_STORES) {
    const list = Array.isArray(d[s]) ? d[s] : [];
    records[s] = [];
    for (const r of list.slice(0, 100000)) {
      const c = cleanRecord(s, r);
      if (c) records[s].push(c); else dropped++;
    }
  }
  const achievements = {};
  if (isPlain(d.achievements)) {
    for (const [k, v] of Object.entries(d.achievements)) if (KEY_RE.test(k) && !BAD_KEYS.has(k) && isYmd(v)) achievements[k] = v;
  }
  const photoBlobs = {};
  const blobs = isPlain(obj.photoBlobs) ? obj.photoBlobs : {};
  for (const [id, v] of Object.entries(blobs)) {
    if (!ID_RE.test(id) || BAD_KEYS.has(id) || !isPlain(v) || typeof v.base64 !== 'string' || v.base64.length > 60 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(v.base64)) { dropped++; continue; }
    photoBlobs[id] = { type: /^image\/(jpeg|png|webp|heic|heif)$/.test(v.type) ? v.type : 'image/jpeg', base64: v.base64 };
  }
  const profile = isPlain(d.profile) ? cleanValue(d.profile) : null;
  const settings = isPlain(d.settings) ? cleanValue(d.settings) : null;
  const meta = isPlain(d.meta) ? cleanValue(d.meta) : {};
  // 数・オンオフの項目は、その型のものだけ残す（文字が入っていたら取りのぞく）
  const only = (o, keys, type) => { if (o) for (const k of keys) if (k in o && typeof o[k] !== type) delete o[k]; };
  only(profile, ['age', 'height', 'weight', 'proteinGoal', 'fatLimit', 'updatedAt'], 'number');
  only(profile, ['onboarded'], 'boolean');
  only(settings, ['proteinPerShake', 'stepGoal', 'yenRate'], 'number');
  only(settings, ['kcalWeightAdjust', 'useSpeedMets'], 'boolean');
  return { profile, settings, meta, achievements, records, photoBlobs, dropped };
}

/** バックアップから復元（今のデータは置き換えられます）。先に検査して、問題があれば今のデータには手をつけません */
export async function restoreBackup(obj) {
  validateBackup(obj);
  const c = sanitizeBackup(obj);
  // 写真の中身は、先に変換できるか確かめる（途中で失敗して、半端な状態にならないように）
  const blobs = [];
  for (const [id, v] of Object.entries(c.photoBlobs)) {
    try { blobs.push([id, { type: v.type, data: base64ToBuf(v.base64) }]); } catch { c.dropped++; }
  }
  await db.clearAll();
  if (c.profile) await db.kvSet('profile', c.profile);
  if (c.settings) await db.kvSet('settings', c.settings);
  await db.kvSet('meta', { ...c.meta, restoredAt: Date.now() });
  await db.kvSet('achievements', c.achievements);
  for (const s of db.RECORD_STORES) {
    if (c.records[s].length) await db.bulkPut(s, c.records[s]);
  }
  for (const [id, v] of blobs) await db.put('photoBlobs', v, id);
  return { dropped: c.dropped };
}

export async function storageInfo() {
  const out = { usage: null, quota: null, persisted: null };
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage; out.quota = e.quota;
    }
    if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
  } catch { /* ignore */ }
  return out;
}
