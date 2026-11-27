function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Delimiter-bounded matching prevents a shorter query model or error code from
// being “confirmed” by a longer, merely similar token. Match the literal text
// instead of stripping punctuation: stripping removes the boundaries that make
// this check safe.
export function containsExactToken(text: string, value: string): boolean {
  if (typeof text !== 'string' || typeof value !== 'string') return false;
  const needle = value.trim();
  if (!needle) return false;
  const pattern = new RegExp(`(^|[^A-Z0-9])${escapeRegExp(needle)}(?=$|[^A-Z0-9])`, 'i');
  return pattern.test(text);
}
