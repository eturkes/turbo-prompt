export function promptFingerprint(text: string): string {
  let hash = 2_166_136_261
  for (const character of text) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return `prompt-${text.length.toString(36)}-${(hash >>> 0).toString(36)}`
}

export function relativeTime(value: string, now = Date.now()): string {
  const elapsed = Math.max(0, now - new Date(value).getTime())
  if (elapsed < 60_000) return 'now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`
  return `${Math.floor(elapsed / 86_400_000)}d`
}
