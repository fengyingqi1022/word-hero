import { mergeMeanings, normalizeWordKey } from '../core/normalize.js';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10000;
const MAX_FIELD_LENGTH = 2000;

function assertImportSize(source) {
  if (new Blob([source]).size > MAX_IMPORT_BYTES) throw new Error('内容超过 10 MB，请拆成多个词包');
}

function assertRowLimits(rows) {
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new Error(`单个词包最多支持 ${MAX_IMPORT_ROWS} 行单词`);
  rows.forEach((columns, rowIndex) => {
    columns.forEach((field) => {
      if (field.length > MAX_FIELD_LENGTH) throw new Error(`第 ${rowIndex + 1} 行有内容超过 ${MAX_FIELD_LENGTH} 个字符`);
    });
  });
}

export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, '');
  assertImportSize(source);
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
  assertRowLimits(rows);
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

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsvText(rows) {
  const body = rows.map((row) => `${csvCell(row.word)},${csvCell(row.meaning)}`);
  return `\uFEFFword,meaning\r\n${body.join('\r\n')}\r\n`;
}

export function csvFileName(packName) {
  let safe = String(packName ?? '')
    .trim()
    .replace(/\.csv$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 80) || '未命名词包';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe)) safe = `_${safe}`;
  return `${safe}.csv`;
}

function isPasteHeader(columns) {
  const wordHeaders = new Set(['word', '英文', '英文单词', '单词']);
  const meaningHeaders = new Set(['meaning', '中文', '中文释义', '释义', '意思']);
  return wordHeaders.has((columns[0] || '').trim().toLowerCase())
    && meaningHeaders.has((columns[1] || '').trim().toLowerCase());
}

export function preparePastedImport(text, packName) {
  const proposedPackName = String(packName ?? '').trim();
  if (!proposedPackName) throw new Error('请先填写词包名称');
  if (proposedPackName.length > 80) throw new Error('词包名称不能超过 80 个字符');

  const source = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('请粘贴英文单词和中文释义');
  assertImportSize(source);

  const rows = source.includes('\t')
    ? source.split(/\r?\n/).map((line) => line.split('\t'))
    : parseCsv(source);
  assertRowLimits(rows);

  const hasHeader = isPasteHeader(rows[0] || []);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (!dataRows.some((columns) => columns.some((value) => value.trim()))) throw new Error('粘贴内容中没有单词');
  if (!dataRows.some((columns) => columns.length >= 2)) {
    throw new Error('粘贴内容需要两列：第一列英文，第二列中文释义；建议从 Excel 或 WPS 直接复制两列');
  }

  const normalizedCsv = buildCsvText(dataRows.map((columns) => ({
    word: columns[0] || '',
    meaning: columns[1] || '',
  })));
  const parsed = prepareCsvImport(normalizedCsv, csvFileName(proposedPackName));
  if (!hasHeader) parsed.errors = parsed.errors.map((error) => ({ ...error, rowNumber: error.rowNumber - 1 }));
  return { ...parsed, proposedPackName, sourceType: 'paste' };
}

export const naturalFileSort = (a, b) => new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }).compare(a.name, b.name);
