import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoProject } from '../data/demoProject'
import { defaultTemplate } from '../data/templates'
import { MAX_SELECTION_VALUE_LENGTH, type RecentPrompt } from '../domain/types'
import { initialValuesFor } from './suggestionEngine'
import { clearWorkspace, fitWorkspaceRecents, loadWorkspace, saveWorkspace } from './storage'

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
      textExact: false,
      projectId: demoProject.id,
      projectName: demoProject.name,
    })
  })

  it('backfills instruction scope in early v1 project snapshots', () => {
    const project = {
      ...demoProject,
      instructions: demoProject.instructions.map(({ text, source }) => ({ text, source })),
    }
    values.set(
      key,
      JSON.stringify({
        schemaVersion: 1,
        templateId: defaultTemplate.id,
        values: initialValuesFor(defaultTemplate, demoProject),
        project,
        recents: [],
      }),
    )

    expect(loadWorkspace()?.project.instructions.map(({ source, scope }) => ({ source, scope }))).toEqual([
      { source: '.agent/memory.md', scope: '.agent' },
      { source: '.agent/memory.md', scope: '.agent' },
      { source: 'AGENTS.md', scope: '' },
    ])
  })

  it('derives persisted instruction scope from its source path', () => {
    values.set(
      key,
      JSON.stringify({
        schemaVersion: 1,
        templateId: defaultTemplate.id,
        values: initialValuesFor(defaultTemplate, demoProject),
        project: {
          ...demoProject,
          instructions: [{
            text: 'Apply this only to the app package.',
            source: 'packages/app/AGENTS.md',
            scope: '',
          }],
        },
        recents: [],
      }),
    )

    expect(loadWorkspace()?.project.instructions[0]?.scope).toBe('packages/app')
  })

  it.each([
    { files: [{ path: 'secrets/config.json', kind: 'config' }] },
    { languages: [{ name: 'TypeScript', count: 1, color: 'url(https://example.invalid)' }] },
    { files: [{ path: 'src/\u202eevil.ts', kind: 'source' }] },
  ])('rejects unsafe persisted project display metadata', (override) => {
    values.set(
      key,
      JSON.stringify({
        schemaVersion: 1,
        templateId: defaultTemplate.id,
        values: initialValuesFor(defaultTemplate, demoProject),
        project: { ...demoProject, ...override },
        recents: [],
      }),
    )

    expect(loadWorkspace()).toBeNull()
  })

  it('clears retained workspace metadata', () => {
    values.set(key, '{}')
    expect(clearWorkspace()).toBe(true)
    expect(values.has(key)).toBe(false)
  })

  it('reports when browser storage blocks a clear request', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (name: string) => values.get(name) ?? null,
        setItem: (name: string, value: string) => values.set(name, value),
        removeItem: () => { throw new Error('Storage blocked') },
      },
    })
    values.set(key, '{}')

    expect(clearWorkspace()).toBe(false)
    expect(values.has(key)).toBe(true)
  })

  it('never labels a preview fallback as exact text', () => {
    const recent = {
      id: 'invalid-exact',
      fingerprint: 'legacy-invalid-exact',
      title: defaultTemplate.title,
      text: 'x'.repeat(250_001),
      textExact: true,
      preview: 'Only a preview survived',
      templateId: defaultTemplate.id,
      projectId: demoProject.id,
      projectName: demoProject.name,
      values: initialValuesFor(defaultTemplate, demoProject),
      createdAt: '2026-07-17T00:00:00.000Z',
    }
    values.set(key, JSON.stringify({
      schemaVersion: 1,
      templateId: defaultTemplate.id,
      values: recent.values,
      project: demoProject,
      recents: [recent],
    }))

    expect(loadWorkspace()?.recents[0]).toMatchObject({
      text: 'Only a preview survived',
      textExact: false,
    })
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
      fingerprint: `fingerprint-${index}`,
      title: defaultTemplate.title,
      text: `Large prompt ${index} ${'x'.repeat(80_000)}`,
      textExact: true,
      preview: `Large prompt ${index}`,
      templateId: defaultTemplate.id,
      projectId: demoProject.id,
      projectName: demoProject.name,
      values: largeValues,
      createdAt: `2026-07-17T00:00:0${index}.000Z`,
    }))

    const workspace = {
      schemaVersion: 1 as const,
      templateId: defaultTemplate.id,
      values: largeValues,
      project: demoProject,
      recents,
    }
    const retained = fitWorkspaceRecents(workspace)

    expect(saveWorkspace(workspace)).toBe(true)

    expect(values.get(key)?.length).toBeLessThanOrEqual(750_000)
    const loaded = loadWorkspace()
    expect(loaded).not.toBeNull()
    expect(loaded?.values).toEqual(largeValues)
    expect(loaded!.recents).toHaveLength(retained.length)
    expect(loaded!.recents.length).toBeLessThan(recents.length)
    expect(loaded?.recents[0]?.id).toBe('recent-0')
  })
})
