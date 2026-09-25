import { normalizeAnswer } from './normalize.js';

export function levenshtein(a, b) {
  const rows = Array.from({ length: b.length + 1 }, (_, index) => [index]);
  rows[0] = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let row = 1; row <= b.length; row += 1) {
    for (let col = 1; col <= a.length; col += 1) {
      rows[row][col] = Math.min(
        rows[row - 1][col] + 1,
        rows[row][col - 1] + 1,
        rows[row - 1][col - 1] + (a[col - 1] === b[row - 1] ? 0 : 1),
      );
    }
  }
  return rows[b.length][a.length];
}

export function evaluateEnglishAnswer(rawAnswer, expected, hintLevel = 0) {
  const normalizedAnswer = normalizeAnswer(rawAnswer);
  const normalizedExpected = normalizeAnswer(expected);
  if (normalizedAnswer === normalizedExpected) {
    return { result: hintLevel > 0 ? 'fuzzy' : 'correct', normalizedAnswer, distance: 0 };
  }
  const distance = levenshtein(normalizedAnswer, normalizedExpected);
  return {
    result: normalizedExpected.length > 3 && distance === 1 ? 'fuzzy' : 'wrong',
    normalizedAnswer,
    distance,
  };
}
