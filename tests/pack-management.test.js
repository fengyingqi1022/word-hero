import test from 'node:test';
import assert from 'node:assert/strict';
import { putOne, readAll } from '../src/data/db.js';
import {
  canDeleteUnstartedPack,
  completePack,
  deleteUnstartedPack,
  ensureDefaultProfiles,
  importPack,
  listPacks,
  listProgress,
  markPackStarted,
  migrateToLightPackMode,
  saveSession,
  switchActivePack,
  updatePack,
  wordsForPack,
} from '../src/data/repositories.js';
import { buildSession } from '../src/services/session-service.js';

const stored = new Map();
globalThis.localStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, String(value)),
  removeItem: (key) => stored.delete(key),
  clear: () => stored.clear(),
};

function parsedPack(name, rows) {
  return {
    fileName: `${name}.csv`,
    proposedPackName: name,
    validRows: rows.map(([word, meaning]) => ({ word, meaning, wordKey: word.toLowerCase(), meaningParts: [meaning] })),
  };
}

test('pack updates, switching and unstarted deletion preserve review dates and one active pack', async () => {
  stored.clear();
  const [profile] = await ensureDefaultProfiles();
  const first = await importPack(profile.id, parsedPack('第一包', [['apple', '苹果']]));
  const second = await importPack(profile.id, parsedPack('第二包', [['banana', '香蕉']]));

  const apple = (await listProgress(profile.id)).find((item) => item.wordKey === 'apple');
  const reviewDate = '2026-10-17';
  await putOne('progress', { ...apple, introduced: true, currentlyMastered: true, reviewStage: 2, nextReviewDate: reviewDate });
  await markPackStarted(profile.id, first.id);

  await updatePack(profile.id, first.id, parsedPack('第一包', [['apple', '苹果；果实'], ['cherry', '樱桃']]));
  let progress = (await listProgress(profile.id)).find((item) => item.wordKey === 'apple');
  assert.equal(progress.nextReviewDate, reviewDate);
  assert.deepEqual((await wordsForPack(profile.id, first.id)).map((item) => item.wordKey), ['apple', 'cherry']);

  await switchActivePack(profile.id, second.id);
  let packs = await listPacks(profile.id);
  assert.deepEqual(packs.filter((pack) => pack.status === 'active').map((pack) => pack.id), [second.id]);
  assert.equal(packs.find((pack) => pack.id === first.id).status, 'available');
  progress = (await listProgress(profile.id)).find((item) => item.wordKey === 'apple');
  assert.equal(progress.nextReviewDate, reviewDate);

  assert.equal(await canDeleteUnstartedPack(profile.id, second.id), true);
  await deleteUnstartedPack(profile.id, second.id);
  packs = await listPacks(profile.id);
  assert.equal(packs.some((pack) => pack.id === second.id), false);
  assert.deepEqual(packs.filter((pack) => pack.status === 'active').map((pack) => pack.id), [first.id]);
  progress = (await listProgress(profile.id)).find((item) => item.wordKey === 'apple');
  assert.equal(progress.nextReviewDate, reviewDate);

  assert.equal(await canDeleteUnstartedPack(profile.id, first.id), false);
  await assert.rejects(deleteUnstartedPack(profile.id, first.id), /已经开始学习/);
});

test('a study session contains only the selected five-word pack', async () => {
  stored.clear();
  const [profile] = await ensureDefaultProfiles();
  const oldPack = await importPack(profile.id, parsedPack('旧词包', [['apple', '苹果']]));
  const selected = await importPack(profile.id, parsedPack('今天的词包', [
    ['brave', '勇敢的'], ['family', '家庭'], ['library', '图书馆'], ['season', '季节'], ['travel', '旅行'],
  ]));
  const apple = (await listProgress(profile.id)).find((item) => item.wordKey === 'apple');
  await putOne('progress', { ...apple, introduced: true, currentlyMastered: true, nextReviewDate: '2020-01-01' });
  await switchActivePack(profile.id, selected.id);

  const session = await buildSession(profile, '2026-11-18', () => false, selected.id);
  assert.equal(session.packId, selected.id);
  assert.equal(session.taskQueue.some((task) => task.wordKey === 'apple'), false);
  assert.deepEqual([...new Set(session.taskQueue.map((task) => task.wordKey))], ['brave', 'family', 'library', 'season', 'travel']);
  assert.equal(session.taskQueue.filter((task) => task.kind === 'intro').length, 5);
  assert.equal(oldPack.status, 'active');
});

test('an exhausted active session is returned for completion instead of starting an endless loop', async () => {
  stored.clear();
  const [profile] = await ensureDefaultProfiles();
  const pack = await importPack(profile.id, parsedPack('五词小包', [
    ['apple', '苹果'], ['brave', '勇敢的'], ['family', '家庭'], ['library', '图书馆'], ['season', '季节'],
  ]));
  const session = await buildSession(profile, '2026-11-18', () => false, pack.id);
  session.currentIndex = session.taskQueue.length;
  await saveSession(session);

  const resumed = await buildSession(profile, '2026-11-18', () => false, pack.id);
  assert.equal(resumed.id, session.id);
  assert.equal(resumed.currentIndex, resumed.taskQueue.length);
  assert.equal((await readAll('sessions')).length, 1);
});

test('light mode migration splits old packs and resets grade-five progress', async () => {
  stored.clear();
  const [profile] = await ensureDefaultProfiles();
  const rows = Array.from({ length: 12 }, (_, index) => [`word${index + 1}`, `释义${index + 1}`]);
  await importPack(profile.id, parsedPack('旧大词包', rows));
  const firstProgress = (await listProgress(profile.id))[0];
  await putOne('progress', { ...firstProgress, introduced: true, currentlyMastered: true, nextReviewDate: '2026-12-01' });

  assert.equal(await migrateToLightPackMode({ force: true }), true);
  const packs = await listPacks(profile.id);
  assert.deepEqual(packs.map((pack) => pack.wordCount), [5, 5, 2]);
  assert.deepEqual(packs.map((pack) => pack.status), ['active', 'available', 'available']);
  assert.deepEqual((await Promise.all(packs.map((pack) => wordsForPack(profile.id, pack.id)))).map((words) => words.length), [5, 5, 2]);
  const reset = await listProgress(profile.id);
  assert.equal(reset.every((item) => !item.introduced && item.nextReviewDate === null), true);

  await completePack(profile.id, packs[0].id);
  assert.equal((await listPacks(profile.id))[0].status, 'completed');
});
