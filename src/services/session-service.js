import { CONFIG, QUESTION_TYPES } from '../core/config.js';
import { getActiveSession, listPacks, listProgress, saveSession, wordsForPack } from '../data/repositories.js';

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export function chooseQuestionType(progress, lastType, speechAvailable = true, random = Math.random) {
  const englishInputs = [QUESTION_TYPES.MEANING_TO_ENGLISH, QUESTION_TYPES.AUDIO_TO_ENGLISH];
  let choices = progress.hasEnglishInputSuccess
    ? [QUESTION_TYPES.MEANING_TO_ENGLISH, QUESTION_TYPES.AUDIO_TO_ENGLISH, QUESTION_TYPES.ENGLISH_TO_MEANING]
    : englishInputs;
  if (!speechAvailable) choices = choices.filter((type) => type !== QUESTION_TYPES.AUDIO_TO_ENGLISH);
  if (choices.length > 1 && lastType) choices = choices.filter((type) => type !== lastType);
  if (!choices.length) return QUESTION_TYPES.MEANING_TO_ENGLISH;
  return choices[Math.floor(random() * choices.length)];
}

export async function buildSession(profile, today, canSpeak = () => true, requestedPackId = null) {
  const existing = await getActiveSession(profile.id);
  if (existing && (!requestedPackId || existing.packId === requestedPackId)) return existing;
  if (existing && requestedPackId && existing.packId !== requestedPackId) {
    existing.status = 'abandoned';
    existing.endedAt = new Date().toISOString();
    existing.abandonedReason = 'pack-switched';
    await saveSession(existing);
  }
  const [progressList, packs] = await Promise.all([listProgress(profile.id), listPacks(profile.id)]);
  const targetPack = packs.find((item) => item.id === requestedPackId)
    || packs.find((item) => item.status === 'active');
  const tasks = [];
  const replay = targetPack?.status === 'completed';
  if (targetPack) {
    const words = await wordsForPack(profile.id, targetPack.id);
    words.forEach((item) => {
      const progress = item.progress || progressList.find((entry) => entry.wordKey === item.wordKey);
      if (!progress.introduced) {
        tasks.push({ id: makeId(), wordKey: item.wordKey, source: 'new', kind: 'intro', questionType: null, attemptNumber: 0, packId: targetPack.id });
      }
      tasks.push({
        id: makeId(), wordKey: item.wordKey, source: replay ? 'replay' : 'new', kind: 'question',
        questionType: chooseQuestionType(progress, null, canSpeak(item.wordKey)), attemptNumber: 1, packId: targetPack.id,
      });
    });
  }
  const session = {
    id: makeId(), profileId: profile.id, status: tasks.length ? 'active' : 'completed',
    startedAt: new Date().toISOString(), endedAt: tasks.length ? null : new Date().toISOString(),
    packId: targetPack?.id || null, packName: targetPack?.name || '', replay,
    taskQueue: tasks, currentIndex: 0,
    summary: { total: 0, correct: 0, fuzzy: 0, wrong: 0, newlyMastered: 0, practicedWords: [] },
  };
  await saveSession(session);
  return session;
}

export function requeueTask(session, task, progress, speechAvailable = true) {
  const followUp = {
    ...task, id: makeId(), kind: 'question', source: 'remediation',
    questionType: chooseQuestionType(progress, task.questionType, speechAvailable),
    attemptNumber: task.attemptNumber + 1,
  };
  const target = Math.min(session.currentIndex + 1 + CONFIG.requeueGap, session.taskQueue.length);
  session.taskQueue.splice(target, 0, followUp);
}
