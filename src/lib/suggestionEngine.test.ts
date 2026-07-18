import { describe, expect, it } from 'vitest'

import type { ProjectContext, PromptSlot } from '../domain/types'
import {
  customSuggestion,
  getSuggestions,
  initialValuesFor,
  isProjectSelectionStale,
  toSelection,
} from './suggestionEngine'
import { defaultTemplate } from '../data/templates'
import { MAX_SELECTION_VALUE_LENGTH } from '../domain/types'

const targetSlot: PromptSlot = {
  id: 'target',
  kind: 'target',
  label: 'Target',
  placeholder: 'Choose a target',
  required: true,
  description: 'The file or area in scope',
}

const verificationSlot: PromptSlot = {
  id: 'verification',
  kind: 'verification',
  label: 'Verification',
  placeholder: 'Choose verification',
  required: true,
  description: 'How to verify the work',
}

const project: ProjectContext = {
  schemaVersion: 1,
  id: 'suggestion-fixture',
  name: 'suggestion-fixture',
  rootLabel: 'suggestion-fixture',
  branch: 'main',
  summary: 'A deterministic suggestion fixture.',
  fileCount: 3,
  files: [
    { path: 'src/changed.ts', kind: 'source', state: 'modified' },
    { path: 'src/stable.ts', kind: 'source' },
    {
      path: 'THE MOST RELEVANT IMPLEMENTATION AREA',
      kind: 'other',
    },
  ],
  directories: ['src'],
  languages: [{ name: 'TypeScript', count: 2, color: '#4169e1' }],
  frameworks: [],
  packageManager: 'npm',
  scripts: [
    { name: 'build', command: 'npm run build', source: 'package.json' },
    { name: 'test', command: 'npm run test', source: 'package.json' },
    { name: 'check', command: 'npm run check', source: 'package.json' },
  ],
  instructions: [],
  manifests: ['package.json'],
  indexedAt: '2026-07-17T00:00:00.000Z',
  isDemo: false,
}

describe('getSuggestions', () => {
  it('ranks changed project paths first and exposes their provenance', () => {
    const suggestions = getSuggestions(targetSlot, project)

    expect(suggestions[0]).toMatchObject({
      id: 'project-file-src-changed-ts',
      value: 'src/changed.ts',
      detail: 'Project file · modified',
      source: 'Project index · src/changed.ts',
      origin: 'project',
    })
    expect(suggestions[0]!.score).toBeGreaterThan(suggestions[1]!.score ?? 0)
  })

  it('deduplicates equivalent values while preserving the project-derived item', () => {
    const duplicates = getSuggestions(targetSlot, project).filter(
      (suggestion) =>
        suggestion.value.trim().toLowerCase() ===
        'the most relevant implementation area',
    )

    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]).toMatchObject({
      origin: 'project',
      source: 'Project index · THE MOST RELEVANT IMPLEMENTATION AREA',
    })
  })

  it('prioritizes high-signal project scripts over generic verification choices', () => {
    const suggestions = getSuggestions(verificationSlot, project)

    expect(suggestions.slice(0, 2).map((suggestion) => suggestion.value)).toEqual([
      'npm run test',
      'npm run check',
    ])
    expect(suggestions[0]).toMatchObject({
      detail: 'test script',
      source: 'package.json · script',
      origin: 'project',
    })
  })

  it('keeps all bounded project files available before a search', () => {
    const manyFiles = {
      ...project,
      fileCount: 120,
      files: Array.from({ length: 120 }, (_, index) => ({
        path: `src/file-${index}.ts`,
        kind: 'source' as const,
      })),
    }

    const paths = getSuggestions(targetSlot, manyFiles)
      .filter((suggestion) => suggestion.origin === 'project')
      .map((suggestion) => suggestion.value)

    expect(paths).toContain('src/file-119.ts')
  })

  it('resolves project defaults against the active project and identifies stale values', () => {
    const values = initialValuesFor(defaultTemplate, project)

    expect(values.target?.value).toBe('src/changed.ts')
    expect(values.verification?.value).toBe('npm run check')
    expect(isProjectSelectionStale(targetSlot, values.target, project)).toBe(false)
    expect(
      isProjectSelectionStale(
        targetSlot,
        {
          id: 'old-path',
          label: 'src/old.ts',
          value: 'src/old.ts',
          source: 'Old project',
          origin: 'project',
        },
        project,
      ),
    ).toBe(true)
  })
})

describe('customSuggestion', () => {
  it('normalizes exact user wording and retains custom provenance in a selection', () => {
    const suggestion = customSuggestion(targetSlot, '  src/new module.ts  ')

    expect(suggestion).toEqual({
      id: 'custom-target-src-new-module-ts',
      kind: 'target',
      label: 'src/new module.ts',
      value: 'src/new module.ts',
      detail: 'Use your exact wording',
      source: 'Custom value',
      origin: 'custom',
      score: 1_000,
    })
    expect(toSelection(suggestion)).toEqual({
      id: 'custom-target-src-new-module-ts',
      label: 'src/new module.ts',
      value: 'src/new module.ts',
      source: 'Custom value',
      origin: 'custom',
    })
  })

  it('bounds pasted custom wording to the persistence contract', () => {
    const suggestion = customSuggestion(targetSlot, `  ${'x'.repeat(MAX_SELECTION_VALUE_LENGTH + 9)}  `)

    expect(suggestion.value).toHaveLength(MAX_SELECTION_VALUE_LENGTH)
    expect(suggestion.label).toBe(suggestion.value)
  })
})
