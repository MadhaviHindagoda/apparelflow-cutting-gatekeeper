// Client-side validation mirrors the server rules for instant inline feedback.
// The SERVER still validates everything again (these checks are UX, not security).

export function validateRecipe(v) {
  return String(v).trim() === '' ? 'Select a recipe' : '';
}

export function validateQty(v) {
  const s = String(v).trim();
  if (s === '') return 'Target quantity is required';
  if (/^-\d+$/.test(s)) return 'Quantity cannot be negative';
  if (/^\d+[.,]\d+$/.test(s)) return 'Quantity must be a whole number (no decimals)';
  if (!/^\d+$/.test(s)) return 'Quantity must contain digits only';
  const n = Number(s);
  if (n <= 0) return 'Quantity must be greater than 0';
  if (n > 100000) return 'Quantity is too large (max 100,000)';
  return '';
}

export function validateRoll(v, { required = true } = {}) {
  const s = String(v).trim();
  if (s === '') return required ? 'Fabric roll ID is required' : '';
  if (s.length > 50) return 'Fabric roll ID is too long (max 50)';
  return '';
}

export function validateYards(v, { required = true } = {}) {
  const s = String(v).trim();
  if (s === '') return required ? 'Fabric used is required' : '';
  if (/^-/.test(s)) return 'Fabric used cannot be negative';
  if (!/^\d+(\.\d+)?$/.test(s)) return 'Enter a number, for example 94.5';
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 'Use at most 2 decimal places';
  const n = Number(s);
  if (n <= 0) return 'Fabric used must be greater than 0';
  if (n > 1000000) return 'Fabric used is too large';
  return '';
}