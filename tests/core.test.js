import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnswer, normalizeWordKey } from '../src/core/normalize.js';
import { evaluateEnglishAnswer } from '../src/core/answer-evaluator.js';
import { addLocalDays } from '../src/core/dates.js';
import { applyAnswer, createProgress } from '../src/core/review-engine.js';
import {
  buildCsvText, csvFileName, prepareCsvImport, preparePastedImport, splitParsedPack,
} from '../src/services/csv-service.js';
import { chooseQuestionType } from '../src/services/session-service.js';
import { speechAvailable } from '../src/services/speech-service.js';

test('normalization handles unicode, case, spaces and punctuation', () => {
  assert.equal(normalizeWordKey('  Good   Morning '), 'good morning');
  assert.equal(normalizeAnswer(' APPLE?! '), 'apple');
});

test('answer evaluator separates correct, fuzzy and wrong', () => {
  assert.equal(evaluateEnglishAnswer(' Apple ', 'apple').result, 'correct');
  assert.equal(evaluateEnglishAnswer('appl', 'apple').result, 'fuzzy');
  assert.equal(evaluateEnglishAnswer('at', 'an').result, 'wrong');
  assert.equal(evaluateEnglishAnswer('apple', 'apple', 1).result, 'fuzzy');
});

test('local date addition crosses month and leap day', () => {
  assert.equal(addLocalDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addLocalDays('2024-02-29', 1), '2024-03-01');
});

test('one clean English answer completes a word without scheduling review', () => {
  const progress = createProgress('p1', 'apple', '2026-01-01T00:00:00Z');
  const transition = applyAnswer(progress, { result: 'correct', isEnglishInput: true, isScheduledReview: false, today: '2026-01-01', timestamp: 'a' });
  assert.equal(transition.progress.currentlyMastered, true);
  assert.equal(transition.progress.nextReviewDate, null);
  assert.equal(transition.needsRemediation, false);
});

test('light pack answers never schedule mandatory reviews', () => {
  let progress = { ...createProgress('p1', 'apple'), currentlyMastered: true };
  progress = applyAnswer(progress, { result: 'correct', isEnglishInput: true, isScheduledReview: true, today: '2026-01-01', timestamp: 'a' }).progress;
  assert.equal(progress.reviewStage, null);
  assert.equal(progress.nextReviewDate, null);
  progress = applyAnswer(progress, { result: 'fuzzy', isEnglishInput: true, isScheduledReview: true, today: '2026-01-03', timestamp: 'b' }).progress;
  assert.equal(progress.currentlyMastered, true);
  assert.equal(progress.nextReviewDate, null);
  progress = applyAnswer(progress, { result: 'wrong', isEnglishInput: true, isScheduledReview: true, today: '2026-01-03', timestamp: 'c' }).progress;
  assert.equal(progress.currentlyMastered, false);
  assert.equal(progress.reviewStage, null);
});

test('imports split into packs of five without losing order', () => {
  const parsed = {
    proposedPackName: 'Unit 3',
    validRows: Array.from({ length: 12 }, (_, index) => ({ word: `word${index + 1}` })),
  };
  const parts = splitParsedPack(parsed);
  assert.deepEqual(parts.map((part) => part.validRows.length), [5, 5, 2]);
  assert.deepEqual(parts.map((part) => part.proposedPackName), ['Unit 3 · 第1包', 'Unit 3 · 第2包', 'Unit 3 · 第3包']);
  assert.equal(parts.flatMap((part) => part.validRows).at(-1).word, 'word12');
});

test('question selector requires English input and degrades without speech', () => {
  const progress = createProgress('p1', 'apple');
  assert.equal(chooseQuestionType(progress, null, false, () => 0.99), 'meaningToEnglish');
  progress.hasEnglishInputSuccess = true;
  assert.notEqual(chooseQuestionType(progress, 'meaningToEnglish', true, () => 0), 'meaningToEnglish');
});

test('bundled test words remain speakable without Web Speech API', () => {
  assert.equal(speechAvailable('apple'), true);
  assert.equal(speechAvailable('not-in-test-library'), false);
});

test('CSV supports BOM, quotes, commas, newlines and duplicate merging', () => {
  const input = '\uFEFFword,meaning\r\napple,"苹果, 果实"\r\nword,"词语\n单词"\r\napple,苹果；水果\r\n,坏行\r\n';
  const parsed = prepareCsvImport(input, '01_测试.csv');
  assert.equal(parsed.validRows.length, 2);
  assert.equal(parsed.validRows[0].meaning, '苹果, 果实；苹果；水果');
  assert.equal(parsed.errors[0].rowNumber, 5);
});

test('pasted table creates a named pack without requiring a header', () => {
  const parsed = preparePastedImport('apple\t苹果\r\nimportant\t重要的\r\napple\t水果', '五年级 Unit 3');
  assert.equal(parsed.proposedPackName, '五年级 Unit 3');
  assert.equal(parsed.fileName, '五年级 Unit 3.csv');
  assert.equal(parsed.sourceType, 'paste');
  assert.equal(parsed.validRows.length, 2);
  assert.equal(parsed.validRows[0].meaning, '苹果；水果');
  assert.equal(parsed.mergedMeanings, 1);
});

test('pasted content accepts Chinese headers and reports original row numbers', () => {
  const parsed = preparePastedImport('英文\t中文释义\r\napple\t苹果\r\n\t缺少英文', '测试词包');
  assert.equal(parsed.validRows.length, 1);
  assert.deepEqual(parsed.errors[0], { rowNumber: 3, message: '缺少英文' });
});

test('pasted content rejects a single column with a helpful message', () => {
  assert.throws(
    () => preparePastedImport('apple\nbanana', '测试词包'),
    /需要两列/,
  );
});

test('generated CSV round-trips quoted content and sanitizes file names', () => {
  const text = buildCsvText([{ word: 'word', meaning: '词语, "单词"' }]);
  const parsed = prepareCsvImport(text, '导出.csv');
  assert.equal(parsed.validRows[0].meaning, '词语, "单词"');
  assert.equal(csvFileName('Unit 1: A/B?'), 'Unit 1_ A_B_.csv');
  assert.equal(csvFileName('Unit 1.csv'), 'Unit 1.csv');
  assert.equal(csvFileName('CON'), '_CON.csv');
});
