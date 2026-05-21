/**
 * Cap the joined sync-event error_message payload so it stays bounded for
 * UI/DB consumers. Mirrors the 1000-char truncation that `withSyncLock`
 * applies on its own failure path.
 */
const MAX_ERROR_MESSAGE_CHARS = 1000;

export function summarizeErrors(errors: string[]): string | null {
  if (errors.length === 0) return null;
  const joined = errors.join("; ");
  if (joined.length <= MAX_ERROR_MESSAGE_CHARS) return joined;

  const suffix = (n: number) => `… (+${n} more)`;
  const included: string[] = [];
  let used = 0;
  for (let i = 0; i < errors.length; i++) {
    const next = errors[i];
    const separator = included.length > 0 ? "; " : "";
    const reserve = suffix(errors.length - i - 1).length;
    if (
      used + separator.length + next.length + reserve >
      MAX_ERROR_MESSAGE_CHARS
    ) {
      return included.join("; ") + suffix(errors.length - included.length);
    }
    included.push(next);
    used += separator.length + next.length;
  }
  return included.join("; ");
}
