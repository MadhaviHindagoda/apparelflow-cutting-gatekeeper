export function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};