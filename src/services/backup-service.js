import { CONFIG } from '../core/config.js';
import { exportSnapshot, replaceSnapshot } from '../data/db.js';

const collections = ['profiles', 'packs', 'words', 'packWords', 'progress', 'attempts', 'sessions'];

export async function createBackup() {
  return { format: 'word-hero-backup', schemaVersion: CONFIG.schemaVersion, exportedAt: new Date().toISOString(), appVersion: CONFIG.appVersion, data: await exportSnapshot() };
}

export function validateBackup(backup) {
  if (!backup || backup.format !== 'word-hero-backup') throw new Error('这不是“单词小勇士”的备份文件');
  if (backup.schemaVersion !== CONFIG.schemaVersion) throw new Error('备份版本与当前应用不兼容');
  if (!backup.data || collections.some((key) => !Array.isArray(backup.data[key]))) throw new Error('备份数据不完整');
  const profileIds = new Set(backup.data.profiles.map((item) => item.id));
  if (profileIds.size !== 2) throw new Error('备份必须包含两个有效的孩子档案');
  if (backup.data.packs.some((item) => !profileIds.has(item.profileId))) throw new Error('备份中存在无效的词包归属');
  return backup;
}

export async function restoreBackup(backup) { validateBackup(backup); await replaceSnapshot(backup.data); }
