/** True only for a generating → idle transition with audio enabled. */
export function shouldPlayCompletionSound(
  wasLoading: boolean,
  isLoading: boolean,
  enabled: boolean,
): boolean {
  return enabled && wasLoading && !isLoading;
}
