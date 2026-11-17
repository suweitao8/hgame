export function numberOption(raw, name, { min = 0, max = Infinity, integer = false } = {}) {
  const value = Number(raw);
  const invalidType = (typeof raw !== 'number' && typeof raw !== 'string') || (typeof raw === 'string' && !raw.trim());
  if (invalidType || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
    throw new RangeError(`${name} must be a finite ${integer ? 'integer' : 'number'} between ${min} and ${max}.`);
  }
  return value;
}

export function viewportOption(raw) {
  const match = typeof raw === 'string' && /^(\d+)x(\d+)$/.exec(raw);
  if (!match) throw new RangeError('--viewport must contain positive integer dimensions such as 960x540.');
  return { width: numberOption(match[1], '--viewport width', { min: 1, integer: true }),
    height: numberOption(match[2], '--viewport height', { min: 1, integer: true }) };
}
