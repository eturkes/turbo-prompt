import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demoProject'
import { defaultTemplate } from '../data/templates'
import { MAX_SELECTION_VALUE_LENGTH, type RecentPrompt } from '../domain/types'
import { initialValuesFor } from './suggestionEngine'
import { clearWorkspace, loadWorkspace, saveWorkspace } from './storage'

const key = 'turbo-prompt:workspace:v1'
let values = new Map<string, string>()

beforeEach(() => {
  values = new Map()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem: (name: string) => values.delete(name),
    },
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('workspace persistence', () => {
  it('round-trips a validated local workspace', () => {
    const workspace = {
      schemaVersion: 1 as const,
      templateId: defaultTemplate.id,
      values: initialValuesFor(defaultTemplate, demoProject),
      project: demoProject,
      recents: [],
    }

    saveWorkspace(workspace)
    expect(loadWorkspace()).toEqual(workspace)
  })

  it('discards malformed nested values rather than exposing them to rendering', () => {
    values.set(
      key,
      JSON.stringify({
        schemaVersion: 1,
        templateId: defaultTemplate.id,
        values: {
          action: {
            id: 'bad',
            label: 'bad',
            value: 42,
            source: 'corrupt state',
            origin: 'template',
          },
        },
        project: demoProject,
        recents: [],
      }),
    )

    expect(loadWorkspace()).toBeNull()
  })

  it('backfills project identity when loading early v1 recent prompts', () => {
    const recent = {
      id: 'legacy-recent',
      title: defaultTemplate.title,
      preview: 'Implement the feature',
      templateId: defaultTemplate.id,
      values: initialValuesFor(defaultTemplate, demoProject),
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    values.set(
      key,
      JSON.stringify({
        schemaVersion: 1,
        templateId: defaultTemplate.id,
        values: initialValuesFor(defaultTemplate, demoProject),
        project: demoProject,
        recents: [recent],
      }),
    )

    expect(loadWorkspace()?.recents[0]).toMatchObject({
      ...recent,
      projectId: demoProject.id,
      projectName: demoProject.name,
    })
  })

  it('clears retained workspace metadata', () => {
    values.set(key, '{}')
    clearWorkspace()
    expect(values.has(key)).toBe(false)
  })

  it('prunes oldest recents until every saved workspace is reloadable', () => {
    const largeValues = Object.fromEntries(
      Object.entries(initialValuesFor(defaultTemplate, demoProject)).map(
        ([slotId, selection]) => [
          slotId,
          selection
            ? {
                ...selection,
                label: 'x'.repeat(MAX_SELECTION_VALUE_LENGTH),
                value: 'x'.repeat(MAX_SELECTION_VALUE_LENGTH),
              }
            : selection,
        ],
      ),
    )
    const recents: RecentPrompt[] = Array.from({ length: 6 }, (_, index) => ({
      id: `recent-${index}`,
      title: defaultTemplate.title,
      preview: `Large prompt ${index}`,
      templateId: defaultTemplate.id,
      projectId: demoProject.id,
      projectName: demoProject.name,
      values: largeValues,
      createdAt: `2026-07-17T00:00:0${index}.000Z`,
    }))

    expect(
      saveWorkspace({
        schemaVersion: 1,
        templateId: defaultTemplate.id,
        values: largeValues,
        project: demoProject,
        recents,
      }),
    ).toBe(true)

    expect(values.get(key)?.length).toBeLessThanOrEqual(750_000)
    const loaded = loadWorkspace()
    expect(loaded).not.toBeNull()
    expect(loaded?.values).toEqual(largeValues)
    expect(loaded!.recents.length).toBeLessThan(recents.length)
    expect(loaded?.recents[0]?.id).toBe('recent-0')
  })
})
