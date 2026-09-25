import { CONFIG, QUESTION_TYPES } from '../core/config.js';
import { daysBetween } from '../core/dates.js';
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

export async function buildSession(profile, today, canSpeak = () => true) {
  const existing = await getActiveSession(profile.id);
  if (existing && existing.currentIndex < existing.taskQueue.length) return existing;
  const [progressList, packs] = await Promise.all([listProgress(profile.id), listPacks(profile.id)]);
  const due = progressList.filter((item) => item.currentlyMastered && item.nextReviewDate && item.nextReviewDate <= today)
    .sort((a, b) => daysBetween(a.nextReviewDate, today) - daysBetween(b.nextReviewDate, today) || b.wrongCount - a.wrongCount).reverse();
  const tasks = due.map((progress) => ({
    id: makeId(), wordKey: progress.wordKey, source: 'review', kind: 'question',
    questionType: chooseQuestionType(progress, null, canSpeak(progress.wordKey)), attemptNumber: 1,
  }));
  const activePack = packs.find((item) => item.status === 'active');
  if (activePack && due.length <= profile.settings.newWordsPerSession * 2) {
    const words = await wordsForPack(profile.id, activePack.id);
    words.filter((item) => !item.progress.introduced).slice(0, profile.settings.newWordsPerSession).forEach((item) => {
      tasks.push({ id: makeId(), wordKey: item.wordKey, source: 'new', kind: 'intro', questionType: null, attemptNumber: 0, packId: activePack.id });
      tasks.push({ id: makeId(), wordKey: item.wordKey, source: 'new', kind: 'question', questionType: chooseQuestionType(item.progress, null, canSpeak(item.wordKey)), attemptNumber: 1, packId: activePack.id });
    });
  }
  const session = {
    id: makeId(), profileId: profile.id, status: tasks.length ? 'active' : 'completed',
    startedAt: new Date().toISOString(), endedAt: tasks.length ? null : new Date().toISOString(),
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
