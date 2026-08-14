import { describe, expect, it } from 'vite-plus/test'

import { promptFingerprint, relativeTime } from './promptHistory'

describe('prompt history helpers', () => {
  it('fingerprints the complete prompt rather than its visible preview', () => {
    const prefix = 'x'.repeat(72)
    expect(promptFingerprint(`${prefix} first ending`)).not.toBe(
      promptFingerprint(`${prefix} second ending`),
    )
    expect(promptFingerprint(`${prefix} first ending`)).toBe(
      promptFingerprint(`${prefix} first ending`),
    )
  })

  it('formats bounded relative history timestamps', () => {
    const now = Date.parse('2026-08-01T12:00:00.000Z')
    expect(relativeTime('2026-08-01T11:59:45.000Z', now)).toBe('now')
    expect(relativeTime('2026-08-01T11:55:00.000Z', now)).toBe('5m')
    expect(relativeTime('2026-07-31T12:00:00.000Z', now)).toBe('1d')
    expect(relativeTime('2026-08-01T12:01:00.000Z', now)).toBe('now')
  })
})
