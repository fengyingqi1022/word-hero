export function normalizeWordKey(value = '') {
  return String(value).normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

export function normalizeAnswer(value = '') {
  return normalizeWordKey(value).replace(/[.?!。？！]+$/u, '').trim();
}

export function splitMeanings(value = '') {
  return String(value).split(/[;；]/u).map((part) => part.trim()).filter(Boolean);
}

export function mergeMeanings(...values) {
  const seen = new Set();
  return values.flatMap(splitMeanings).filter((part) => {
    if (seen.has(part)) return false;
    seen.add(part);
    return true;
  });
}
