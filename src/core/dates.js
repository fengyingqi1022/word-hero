export function toLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addLocalDays(localDate, days) {
  const [year, month, day] = localDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + Math.max(0, days));
  return toLocalDate(date);
}

export function daysBetween(from, to) {
  const parse = (value) => {
    const [y, m, d] = value.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.floor((parse(to) - parse(from)) / 86400000);
}

export const systemClock = {
  now: () => new Date(),
  today: () => toLocalDate(new Date()),
};
