import test from 'node:test';
import assert from 'node:assert/strict';
import { putOne } from '../src/data/db.js';
import {
  canDeleteUnstartedPack,
  deleteUnstartedPack,
  ensureDefaultProfiles,
  importPack,
  listPacks,
  listProgress,
  markPackStarted,
  switchActivePack,
  updatePack,
  wordsForPack,
} from '../src/data/repositories.js';

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
