import { CONFIG } from '../core/config.js';
import { createProgress } from '../core/review-engine.js';
import { getOne, putOne, readAll, requestAsPromise, runTransaction } from './db.js';
import { mergeMeanings } from '../core/normalize.js';

const id = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const isoNow = () => new Date().toISOString();

export async function ensureDefaultProfiles() {
  const profiles = await readAll('profiles');
  if (profiles.length) return profiles;
  const now = isoNow();
  const defaults = [
    { id: 'grade5-child', name: '五年级小勇士', grade: 'grade5', avatarColor: 'coral' },
    { id: 'grade9-child', name: '初三大勇士', grade: 'grade9', avatarColor: 'blue' },
  ].map((profile) => ({
    ...profile,
    settings: {
      newWordsPerSession: CONFIG.defaultNewWordsByGrade[profile.grade],
      speechRate: 0.85,
      autoSpeak: true,
      voiceURI: '',
    },
    createdAt: now,
    updatedAt: now,
  }));
  await runTransaction(['profiles', 'meta'], (tx) => {
    defaults.forEach((profile) => tx.objectStore('profiles').put(profile));
    tx.objectStore('meta').put({ key: 'schemaVersion', value: CONFIG.schemaVersion });
  });
  return defaults;
}

export async function migrateToLightPackMode({ force = false } = {}) {
  const marker = await getOne('meta', 'lightPackModeVersion');
  if (!force && marker?.value >= CONFIG.lightPackModeVersion) return false;

  const [profiles, packs, links, progress, attempts, sessions] = await Promise.all([
    readAll('profiles'), readAll('packs'), readAll('packWords'), readAll('progress'),
    readAll('attempts'), readAll('sessions'),
  ]);
  const targetIds = new Set(profiles.filter((profile) => profile.grade === 'grade5').map((profile) => profile.id));
  const now = isoNow();
  const replacementPacks = [];
  const replacementLinks = [];

  for (const profileId of targetIds) {
    const sourcePacks = packs.filter((pack) => pack.profileId === profileId).sort((a, b) => a.order - b.order);
    for (const sourcePack of sourcePacks) {
      const sourceLinks = links.filter((link) => link.profileId === profileId && link.packId === sourcePack.id && !link.archived)
        .sort((a, b) => a.position - b.position);
      const chunks = [];
      for (let index = 0; index < sourceLinks.length; index += CONFIG.packSize) chunks.push(sourceLinks.slice(index, index + CONFIG.packSize));
      if (!chunks.length) chunks.push([]);
      chunks.forEach((chunk, index) => {
        const packId = index === 0 ? sourcePack.id : id('pack');
        const name = chunks.length === 1 ? sourcePack.name : `${sourcePack.name} · 第${index + 1}包`;
        replacementPacks.push({
          ...sourcePack, id: packId, name, order: replacementPacks.filter((item) => item.profileId === profileId).length,
          wordCount: chunk.length, status: sourcePack.status === 'archived' ? 'archived' : 'available',
          startedAt: null, completedAt: null, updatedAt: now,
        });
        chunk.forEach((link, position) => replacementLinks.push({ ...link, packId, position, archived: false }));
      });
    }
    const first = replacementPacks.find((pack) => pack.profileId === profileId && pack.status !== 'archived');
    if (first) first.status = 'active';
  }

  await runTransaction(['meta', 'profiles', 'packs', 'packWords', 'progress', 'attempts', 'sessions'], async (tx) => {
    const profileStore = tx.objectStore('profiles');
    const packStore = tx.objectStore('packs');
    const linkStore = tx.objectStore('packWords');
    const progressStore = tx.objectStore('progress');
    const attemptStore = tx.objectStore('attempts');
    const sessionStore = tx.objectStore('sessions');

    for (const profile of profiles.filter((item) => targetIds.has(item.id))) {
      await requestAsPromise(profileStore.put({
        ...profile, settings: { ...profile.settings, newWordsPerSession: CONFIG.packSize }, updatedAt: now,
      }));
    }
    for (const pack of packs.filter((item) => targetIds.has(item.profileId))) await requestAsPromise(packStore.delete(pack.id));
    for (const link of links.filter((item) => targetIds.has(item.profileId))) await requestAsPromise(linkStore.delete([link.packId, link.wordKey]));
    for (const pack of replacementPacks) await requestAsPromise(packStore.put(pack));
    for (const link of replacementLinks) await requestAsPromise(linkStore.put(link));
    for (const item of progress.filter((entry) => targetIds.has(entry.profileId))) {
      await requestAsPromise(progressStore.put(createProgress(item.profileId, item.wordKey, now)));
    }
    for (const attempt of attempts.filter((item) => targetIds.has(item.profileId))) await requestAsPromise(attemptStore.delete(attempt.id));
    for (const session of sessions.filter((item) => targetIds.has(item.profileId))) await requestAsPromise(sessionStore.delete(session.id));
    await requestAsPromise(tx.objectStore('meta').put({ key: 'lightPackModeVersion', value: CONFIG.lightPackModeVersion }));
  });
  return true;
}

export const listProfiles = () => readAll('profiles');
export const getProfile = (profileId) => getOne('profiles', profileId);
export const saveProfile = (profile) => putOne('profiles', { ...profile, updatedAt: isoNow() });

export async function listPacks(profileId) {
  return (await readAll('packs')).filter((item) => item.profileId === profileId).sort((a, b) => a.order - b.order);
}

export async function listWords(profileId) {
  return (await readAll('words')).filter((item) => item.profileId === profileId);
}

export async function listProgress(profileId) {
  return (await readAll('progress')).filter((item) => item.profileId === profileId);
}

export async function listAttempts(profileId) {
  return (await readAll('attempts')).filter((item) => item.profileId === profileId);
}

export async function wordsForPack(profileId, packId) {
  const [links, words, progress] = await Promise.all([readAll('packWords'), listWords(profileId), listProgress(profileId)]);
  const wordMap = new Map(words.map((item) => [item.wordKey, item]));
  const progressMap = new Map(progress.map((item) => [item.wordKey, item]));
  return links.filter((item) => item.profileId === profileId && item.packId === packId && !item.archived)
    .sort((a, b) => a.position - b.position)
    .map((link) => ({ ...wordMap.get(link.wordKey), progress: progressMap.get(link.wordKey), position: link.position }));
}

export async function importPack(profileId, parsedPack, { seed = false } = {}) {
  const profile = await getProfile(profileId);
  if (!profile) throw new Error('找不到目标孩子档案');
  const packs = await listPacks(profileId);
  const now = isoNow();
  const pack = {
    id: id('pack'), profileId, name: parsedPack.proposedPackName,
    sourceFileName: parsedPack.fileName, status: packs.some((item) => item.status === 'active') ? 'available' : 'active',
    sourceType: parsedPack.sourceType || (seed ? 'builtin' : 'csv'),
    order: packs.length, wordCount: parsedPack.validRows.length,
    startedAt: null, completedAt: null, createdAt: now, updatedAt: now, isTestData: seed,
  };
  await runTransaction(['packs', 'words', 'packWords', 'progress'], async (tx) => {
    const wordStore = tx.objectStore('words');
    const progressStore = tx.objectStore('progress');
    tx.objectStore('packs').put(pack);
    for (const [position, incoming] of parsedPack.validRows.entries()) {
      const key = [profileId, incoming.wordKey];
      const existing = await requestAsPromise(wordStore.get(key));
      const meaningParts = mergeMeanings(existing?.meaning || '', incoming.meaning);
      wordStore.put({
        profileId, wordKey: incoming.wordKey, word: existing?.word || incoming.word,
        meaning: meaningParts.join('；'), meaningParts,
        createdAt: existing?.createdAt || now, updatedAt: now,
      });
      if (!await requestAsPromise(progressStore.get(key))) progressStore.put(createProgress(profileId, incoming.wordKey, now));
      tx.objectStore('packWords').put({ packId: pack.id, profileId, wordKey: incoming.wordKey, position, archived: false });
    }
  });
  return pack;
}

export async function updatePack(profileId, packId, parsedPack) {
  const pack = await getOne('packs', packId);
  if (!pack || pack.profileId !== profileId) throw new Error('找不到要更新的词包');
  if (pack.status === 'completed') throw new Error('已通关词包不能覆盖更新，请作为新词包导入');
  const links = (await readAll('packWords')).filter((item) => item.profileId === profileId && item.packId === packId);
  const linkMap = new Map(links.map((item) => [item.wordKey, item]));
  const incomingKeys = new Set(parsedPack.validRows.map((item) => item.wordKey));
  const sessions = (await readAll('sessions')).filter((item) => item.profileId === profileId && item.status === 'active');
  const now = isoNow();

  await runTransaction(['packs', 'words', 'packWords', 'progress', 'sessions'], async (tx) => {
    const wordStore = tx.objectStore('words');
    const progressStore = tx.objectStore('progress');
    const linkStore = tx.objectStore('packWords');
    tx.objectStore('packs').put({
      ...pack,
      name: parsedPack.proposedPackName,
      sourceFileName: parsedPack.fileName,
      sourceType: parsedPack.sourceType || pack.sourceType || 'csv',
      wordCount: parsedPack.validRows.length,
      updatedAt: now,
    });

    for (const [position, incoming] of parsedPack.validRows.entries()) {
      const key = [profileId, incoming.wordKey];
      const existing = await requestAsPromise(wordStore.get(key));
      const meaningParts = mergeMeanings(existing?.meaning || '', incoming.meaning);
      wordStore.put({
        profileId, wordKey: incoming.wordKey, word: existing?.word || incoming.word,
        meaning: meaningParts.join('；'), meaningParts,
        createdAt: existing?.createdAt || now, updatedAt: now,
      });
      // Existing progress is deliberately left untouched, including nextReviewDate.
      if (!await requestAsPromise(progressStore.get(key))) progressStore.put(createProgress(profileId, incoming.wordKey, now));
      linkStore.put({ ...(linkMap.get(incoming.wordKey) || {}), packId, profileId, wordKey: incoming.wordKey, position, archived: false });
    }

    links.filter((link) => !incomingKeys.has(link.wordKey)).forEach((link) => linkStore.put({ ...link, archived: true }));
    sessions.filter((session) => session.taskQueue?.some((task) => task.packId === packId))
      .forEach((session) => tx.objectStore('sessions').put({ ...session, status: 'abandoned', endedAt: now, abandonedReason: 'pack-updated' }));
  });
  return getOne('packs', packId);
}

export async function markPackStarted(profileId, packId) {
  const pack = await getOne('packs', packId);
  if (!pack || pack.profileId !== profileId || pack.startedAt) return pack;
  const now = isoNow();
  const updated = { ...pack, startedAt: now, updatedAt: now };
  await putOne('packs', updated);
  return updated;
}

export async function canDeleteUnstartedPack(profileId, packId) {
  const pack = await getOne('packs', packId);
  if (!pack || pack.profileId !== profileId || pack.status === 'completed' || pack.status === 'archived') return false;
  if (Object.prototype.hasOwnProperty.call(pack, 'startedAt')) return !pack.startedAt;
  // Compatibility for packs created before startedAt existed.
  if (pack.status !== 'active') return true;
  const words = await wordsForPack(profileId, packId);
  return !words.some((item) => item.progress?.introduced);
}

export async function deleteUnstartedPack(profileId, packId) {
  const pack = await getOne('packs', packId);
  if (!pack || pack.profileId !== profileId) throw new Error('找不到要删除的词包');
  if (!await canDeleteUnstartedPack(profileId, packId)) throw new Error('这个词包已经开始学习，不能删除');

  const [packs, links, sessions] = await Promise.all([
    listPacks(profileId),
    readAll('packWords'),
    readAll('sessions'),
  ]);
  const remaining = packs.filter((item) => item.id !== packId);
  const wasActive = pack.status === 'active';
  let replacement = null;
  if (wasActive) {
    replacement = remaining.find((item) => item.order > pack.order && !['completed', 'archived'].includes(item.status))
      || remaining.find((item) => !['completed', 'archived'].includes(item.status));
  }
  const now = isoNow();

  await runTransaction(['packs', 'packWords', 'sessions'], (tx) => {
    const packStore = tx.objectStore('packs');
    packStore.delete(packId);
    remaining.forEach((item, order) => {
      const status = replacement?.id === item.id ? 'active' : item.status;
      packStore.put({ ...item, order, status, updatedAt: status !== item.status || order !== item.order ? now : item.updatedAt });
    });
    links.filter((item) => item.profileId === profileId && item.packId === packId)
      .forEach((item) => tx.objectStore('packWords').delete([item.packId, item.wordKey]));
    sessions.filter((item) => item.profileId === profileId && item.status === 'active' && item.taskQueue?.some((task) => task.packId === packId))
      .forEach((session) => tx.objectStore('sessions').put({ ...session, status: 'abandoned', endedAt: now, abandonedReason: 'pack-deleted' }));
  });
}

export async function switchActivePack(profileId, packId) {
  const [packs, sessions] = await Promise.all([listPacks(profileId), readAll('sessions')]);
  const target = packs.find((item) => item.id === packId);
  if (!target || ['completed', 'archived'].includes(target.status)) throw new Error('这个词包不能设为当前词包');
  if (target.status === 'active') return target;
  const now = isoNow();
  await runTransaction(['packs', 'sessions'], (tx) => {
    packs.forEach((pack) => {
      const status = pack.id === packId ? 'active' : pack.status === 'active' ? 'available' : pack.status;
      if (status !== pack.status) tx.objectStore('packs').put({ ...pack, status, updatedAt: now });
    });
    sessions.filter((item) => item.profileId === profileId && item.status === 'active')
      .forEach((session) => tx.objectStore('sessions').put({ ...session, status: 'abandoned', endedAt: now, abandonedReason: 'pack-switched' }));
  });
  return { ...target, status: 'active', updatedAt: now };
}

export async function saveStudyStep({ attempt, progress, session }) {
  await runTransaction(['attempts', 'progress', 'sessions'], (tx) => {
    tx.objectStore('attempts').add(attempt);
    tx.objectStore('progress').put(progress);
    tx.objectStore('sessions').put(session);
  });
}

export async function saveSession(session) { return putOne('sessions', session); }

export async function getActiveSession(profileId) {
  return (await readAll('sessions')).filter((item) => item.profileId === profileId && item.status === 'active')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] || null;
}

export async function completePackIfReady(profileId, packId) {
  const pack = await getOne('packs', packId);
  if (!pack || pack.status !== 'active') return false;
  const words = await wordsForPack(profileId, packId);
  if (!words.length || words.some((item) => !item.progress.currentlyMastered)) return false;
  const packs = await listPacks(profileId);
  const next = packs.find((item) => item.order > pack.order && item.status === 'locked');
  const now = isoNow();
  await runTransaction(['packs'], (tx) => {
    tx.objectStore('packs').put({ ...pack, status: 'completed', completedAt: pack.completedAt || now, updatedAt: now });
    if (next) tx.objectStore('packs').put({ ...next, status: 'available', updatedAt: now });
  });
  return true;
}

export async function completePack(profileId, packId) {
  const pack = await getOne('packs', packId);
  if (!pack || pack.profileId !== profileId || pack.status === 'completed') return false;
  const now = isoNow();
  await putOne('packs', { ...pack, status: 'completed', completedAt: pack.completedAt || now, updatedAt: now });
  return true;
}

export async function activateNextPack(profileId) {
  const packs = await listPacks(profileId);
  const available = packs.find((item) => item.status === 'available');
  if (!available) return null;
  await putOne('packs', { ...available, status: 'active', updatedAt: isoNow() });
  return available;
}

export async function clearProfileProgress(profileId) {
  const [progress, packs] = await Promise.all([listProgress(profileId), listPacks(profileId)]);
  const now = isoNow();
  const first = packs.find((item) => item.status !== 'archived');
  await runTransaction(['packs', 'progress', 'attempts', 'sessions'], async (tx) => {
    for (const pack of packs) {
      const status = pack.status === 'archived' ? 'archived' : pack.id === first?.id ? 'active' : 'available';
      await requestAsPromise(tx.objectStore('packs').put({ ...pack, status, startedAt: null, completedAt: null, updatedAt: now }));
    }
    for (const item of progress) await requestAsPromise(tx.objectStore('progress').put(createProgress(profileId, item.wordKey, now)));
    for (const attempt of await requestAsPromise(tx.objectStore('attempts').getAll())) {
      if (attempt.profileId === profileId) await requestAsPromise(tx.objectStore('attempts').delete(attempt.id));
    }
    for (const session of await requestAsPromise(tx.objectStore('sessions').getAll())) {
      if (session.profileId === profileId) await requestAsPromise(tx.objectStore('sessions').delete(session.id));
    }
  });
}
