export const CONFIG = Object.freeze({
  schemaVersion: 1,
  appVersion: '2.0.0',
  dbName: 'word-hero-db',
  dbVersion: 1,
  packSize: 5,
  lightPackModeVersion: 2,
  reviewIntervalsDays: [1, 2, 4, 7, 15, 30, 60],
  longTermReviewDays: 90,
  masteryCorrectStreak: 1,
  requeueGap: 3,
  defaultNewWordsByGrade: { grade5: 5, grade9: 5 },
  newWordsPerSessionMin: 1,
  newWordsPerSessionMax: 50,
  questionWeights: {
    meaningToEnglish: 0.5,
    audioToEnglish: 0.3,
    englishToMeaning: 0.2,
  },
});

export const QUESTION_TYPES = Object.freeze({
  MEANING_TO_ENGLISH: 'meaningToEnglish',
  AUDIO_TO_ENGLISH: 'audioToEnglish',
  ENGLISH_TO_MEANING: 'englishToMeaning',
});
