import { CONFIG } from './config.js';
import { addLocalDays } from './dates.js';

export function createProgress(profileId, wordKey, now = new Date().toISOString()) {
  return {
    profileId, wordKey, introduced: false, currentlyMastered: false,
    longTermMastered: false, consecutiveCorrect: 0,
    hasEnglishInputSuccess: false, reviewStage: null, nextReviewDate: null,
    firstSeenAt: null, lastReviewedAt: null, correctCount: 0,
    fuzzyCount: 0, wrongCount: 0, updatedAt: now,
  };
}

export function markIntroduced(progress, timestamp) {
  return { ...progress, introduced: true, firstSeenAt: progress.firstSeenAt || timestamp, updatedAt: timestamp };
}

export function applyAnswer(progress, { result, isEnglishInput, isScheduledReview, today, timestamp }) {
  const next = { ...progress, lastReviewedAt: timestamp, updatedAt: timestamp };
  let becameMastered = false;
  if (result === 'correct') {
    next.correctCount += 1;
    next.consecutiveCorrect += 1;
    if (isEnglishInput) next.hasEnglishInputSuccess = true;
    if (!next.currentlyMastered && next.consecutiveCorrect >= CONFIG.masteryCorrectStreak && next.hasEnglishInputSuccess) {
      next.currentlyMastered = true;
      next.longTermMastered = false;
      next.reviewStage = 0;
      next.nextReviewDate = addLocalDays(today, CONFIG.reviewIntervalsDays[0]);
      becameMastered = true;
    } else if (next.currentlyMastered && isScheduledReview) {
      if (next.reviewStage === 6) {
        next.longTermMastered = true;
        next.nextReviewDate = addLocalDays(today, CONFIG.longTermReviewDays);
      } else {
        next.reviewStage = Math.min((next.reviewStage ?? 0) + 1, 6);
        next.nextReviewDate = addLocalDays(today, CONFIG.reviewIntervalsDays[next.reviewStage]);
      }
    }
  } else if (result === 'fuzzy') {
    next.fuzzyCount += 1;
    next.consecutiveCorrect = 0;
    if (next.currentlyMastered) {
      next.reviewStage = Math.max((next.reviewStage ?? 0) - 1, 0);
      next.nextReviewDate = addLocalDays(today, CONFIG.reviewIntervalsDays[next.reviewStage]);
    }
  } else {
    next.wrongCount += 1;
    next.currentlyMastered = false;
    next.longTermMastered = false;
    next.consecutiveCorrect = 0;
    next.hasEnglishInputSuccess = false;
    next.reviewStage = null;
    next.nextReviewDate = null;
  }
  return { progress: next, becameMastered, needsRemediation: result !== 'correct' || !next.currentlyMastered };
}
