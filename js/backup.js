// バックアップ（書き出し）と復元（読み込み）
import * as db from './db.js';
import { S, APP_VERSION, SCHEMA_VERSION, setMeta } from './store.js';
import { ymd } from './util.js';

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
  if (!obj || obj.app !== 'EVOLVE' || !obj.data) throw new Error('EVOLVEのバックアップファイルではないようです');
  if (obj.schema > SCHEMA_VERSION) throw new Error('新しいバージョンのアプリで作られたバックアップです。アプリを更新してください');
  return true;
}

/** バックアップから復元（今のデータは置き換えられます） */
export async function restoreBackup(obj) {
  validateBackup(obj);
  const d = obj.data;
  await db.clearAll();
  if (d.profile) await db.kvSet('profile', d.profile);
  if (d.settings) await db.kvSet('settings', d.settings);
  await db.kvSet('meta', { ...(d.meta || {}), restoredAt: Date.now() });
  await db.kvSet('achievements', d.achievements || {});
  for (const s of db.RECORD_STORES) {
    if (Array.isArray(d[s]) && d[s].length) await db.bulkPut(s, d[s].filter((r) => r && r.id));
  }
  const blobs = obj.photoBlobs || {};
  for (const [id, v] of Object.entries(blobs)) {
    await db.put('photoBlobs', { type: v.type, data: base64ToBuf(v.base64) }, id);
  }
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
