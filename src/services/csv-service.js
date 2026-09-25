import { mergeMeanings, normalizeWordKey } from '../core/normalize.js';

export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('CSV 中有未闭合的双引号');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

export function prepareCsvImport(text, fileName = '未命名词包.csv') {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('CSV 是空文件');
  const headers = rows[0].map((item) => item.trim().toLowerCase());
  const wordIndex = headers.indexOf('word');
  const meaningIndex = headers.indexOf('meaning');
  if (wordIndex < 0 || meaningIndex < 0) throw new Error('CSV 必须包含 word 和 meaning 两列表头');
  const words = new Map();
  const errors = [];
  let emptyRows = 0, duplicateRows = 0, mergedMeanings = 0;
  rows.slice(1).forEach((columns, index) => {
    const rowNumber = index + 2;
    if (columns.every((value) => !value.trim())) { emptyRows += 1; return; }
    const word = (columns[wordIndex] || '').trim();
    const meaning = (columns[meaningIndex] || '').trim();
    if (!word || !meaning) { errors.push({ rowNumber, message: !word ? '缺少英文' : '缺少中文释义' }); return; }
    const wordKey = normalizeWordKey(word);
    if (words.has(wordKey)) {
      const old = words.get(wordKey);
      const parts = mergeMeanings(old.meaning, meaning);
      if (parts.join('；') === old.meaning) duplicateRows += 1;
      else { old.meaning = parts.join('；'); old.meaningParts = parts; mergedMeanings += 1; }
      return;
    }
    const meaningParts = mergeMeanings(meaning);
    words.set(wordKey, { wordKey, word, meaning: meaningParts.join('；'), meaningParts });
  });
  if (!words.size) throw new Error('CSV 中没有可导入的有效单词');
  return {
    fileName,
    proposedPackName: fileName.replace(/\.csv$/i, ''),
    validRows: [...words.values()], emptyRows, duplicateRows, mergedMeanings, errors,
  };
}

export const naturalFileSort = (a, b) => new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }).compare(a.name, b.name);
