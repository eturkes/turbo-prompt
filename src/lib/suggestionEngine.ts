import {
  MAX_SELECTION_VALUE_LENGTH,
  type ProjectContext,
  type PromptSlot,
  type PromptTemplate,
  type PromptValues,
  type SlotSelection,
  type Suggestion,
  type SuggestionOrigin,
} from '../domain/types'

type StaticSuggestion = Omit<Suggestion, 'kind' | 'score'>

const staticSuggestions: Record<PromptSlot['kind'], StaticSuggestion[]> = {
  action: ([
    ['implement', 'Implement'],
    ['fix', 'Fix'],
    ['review', 'Review'],
    ['refactor', 'Refactor'],
    ['test', 'Test'],
    ['document', 'Document'],
    ['explain', 'Explain'],
  ] as const).map(([id, value]) => ({
    id: `action-${id}`,
    label: value,
    value,
    detail: 'Common coding-agent action',
    source: 'Built-in actions',
    origin: 'template' as const,
  })),
  target: [
    {
      id: 'target-relevant-area',
      label: 'the most relevant implementation area',
      value: 'the most relevant implementation area',
      detail: 'Let the agent locate the narrowest responsible scope',
      source: 'Built-in target',
      origin: 'template',
    },
  ],
  outcome: [
    {
      id: 'outcome-keyboard',
      label: 'Mouse and keyboard completion',
      value: 'make every prompt field easy to complete with mouse or keyboard',
      detail: 'Concrete usability outcome',
      source: 'Template recommendation',
      origin: 'template',
    },
    {
      id: 'outcome-reliable',
      label: 'Reliable core workflow',
      value: 'make the core workflow reliable across expected and empty states',
      detail: 'Outcome includes failure-state behavior',
      source: 'Template recommendation',
      origin: 'template',
    },
    {
      id: 'outcome-ambiguity',
      label: 'Less ambiguity',
      value: 'remove ambiguity without changing established behavior',
      detail: 'Good fit for targeted maintenance',
      source: 'Template recommendation',
      origin: 'template',
    },
    {
      id: 'outcome-understandable',
      label: 'Understandable implementation',
      value: 'leave the implementation simpler to understand and extend',
      detail: 'Maintainability-focused outcome',
      source: 'Template recommendation',
      origin: 'template',
    },
  ],
  context: [
    {
      id: 'context-instructions-tests',
      label: 'Instructions + adjacent tests',
      value: 'project instructions and adjacent tests',
      detail: 'Ground the change in local policy and behavior',
      source: 'Template recommendation',
      origin: 'template',
    },
    {
      id: 'context-implementation',
      label: 'Current implementation',
      value: 'the current implementation and its direct callers',
      detail: 'Trace behavior across the smallest useful surface',
      source: 'Template recommendation',
      origin: 'template',
    },
    {
      id: 'context-diff',
      label: 'Current diff',
      value: 'the current diff, surrounding code, and existing conventions',
      detail: 'Useful when reviewing work in progress',
      source: 'Template recommendation',
      origin: 'template',
    },
  ],
  constraint: [
    {
      id: 'constraint-local',
      label: 'Keep data local',
      value: 'keep project data on this device',
      detail: 'Privacy boundary for repository content',
      source: 'Built-in guardrail',
      origin: 'template',
    },
    {
      id: 'constraint-api',
      label: 'Preserve public API',
      value: 'preserve the public API and existing behavior',
      detail: 'Compatibility boundary',
      source: 'Built-in guardrail',
      origin: 'template',
    },
    {
      id: 'constraint-scope',
      label: 'Stay in scope',
      value: 'keep the change tightly scoped and avoid unrelated cleanup',
      detail: 'Limits implementation drift',
      source: 'Built-in guardrail',
      origin: 'template',
    },
  ],
  verification: [
    {
      id: 'verification-related',
      label: 'Relevant tests',
      value: 'the relevant focused tests',
      detail: 'Use the repository’s nearest verification path',
      source: 'Built-in verification',
      origin: 'template',
    },
    {
      id: 'verification-checks',
      label: 'Tests + static checks',
      value: 'focused tests followed by the project’s static checks',
      detail: 'Layered verification',
      source: 'Built-in verification',
      origin: 'template',
    },
  ],
  deliverable: [
    {
      id: 'deliverable-patch',
      label: 'Patch + verification note',
      value: 'a focused patch with a concise verification note',
      detail: 'Implementation and proof, without excess narration',
      source: 'Built-in deliverable',
      origin: 'template',
    },
    {
      id: 'deliverable-findings',
      label: 'Prioritized findings',
      value: 'prioritized findings with file references and open questions',
      detail: 'Review-oriented response',
      source: 'Built-in deliverable',
      origin: 'template',
    },
    {
      id: 'deliverable-plan',
      label: 'Implementation plan',
      value: 'a sequenced implementation plan with risks and validation steps',
      detail: 'Planning-oriented response',
      source: 'Built-in deliverable',
      origin: 'template',
    },
  ],
}

function projectSuggestions(slot: PromptSlot, project: ProjectContext): Suggestion[] {
  if (slot.kind === 'target') {
    const files = project.files.map((file, index) => ({
      id: `project-file-${file.path.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      kind: slot.kind,
      label: file.path,
      value: file.path,
      detail: `${file.kind === 'test' ? 'Test file' : file.kind === 'config' ? 'Project config' : 'Project file'}${file.state ? ` · ${file.state}` : ''}`,
      source: `Project index · ${file.path}`,
      origin: 'project' as const,
      score: file.state ? Math.max(1, 180 - index) : Math.max(1, 100 - index),
    }))
    const directories = project.directories.map((path, index) => ({
      id: `project-dir-${path.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      kind: slot.kind,
      label: path,
      value: path,
      detail: 'Project directory',
      source: `Project index · ${path}`,
      origin: 'project' as const,
      score: Math.max(1, 70 - index),
    }))
    return [...files, ...directories]
  }

  if (slot.kind === 'verification') {
    return project.scripts.map((script, index) => ({
      id: `project-script-${script.name}`,
      kind: slot.kind,
      label: script.command,
      value: script.command,
      detail: `${script.name} script`,
      source: `${script.source} · script`,
      origin: 'project',
      score: script.name === 'check' || script.name === 'test' ? 170 - index : 100 - index,
    }))
  }

  if (slot.kind === 'constraint') {
    return project.instructions.map((instruction, index) => ({
      id: `project-instruction-${index}`,
      kind: slot.kind,
      label: instruction.text,
      value: instruction.text,
      detail: 'Repository instruction',
      source: instruction.source,
      origin: 'project',
      score: 145 - index,
    }))
  }

  if (slot.kind === 'context') {
    const suggestions: Suggestion[] = []
    if (project.instructions.length) {
      suggestions.push({
        id: 'project-context-instructions',
        kind: slot.kind,
        label: 'Project instructions',
        value: `project instructions in ${project.instructions.map((item) => item.source).filter((value, index, all) => all.indexOf(value) === index).join(' and ')}`,
        detail: `${project.instructions.length} indexed instruction${project.instructions.length === 1 ? '' : 's'}`,
        source: project.instructions[0]!.source,
        origin: 'project',
        score: 150,
      })
    }
    const changed = project.files.filter((file) => file.state)
    if (changed.length) {
      suggestions.push({
        id: 'project-context-changed',
        kind: slot.kind,
        label: 'Recently changed files',
        value: `the recently changed files ${changed.slice(0, 3).map((file) => file.path).join(', ')}`,
        detail: `${changed.length} changed path${changed.length === 1 ? '' : 's'} in the project index`,
        source: 'Project index · changed files',
        origin: 'project',
        score: 140,
      })
    }
    return suggestions
  }

  return []
}

function textScore(suggestion: Suggestion, query: string): number {
  const base = suggestion.score ?? (suggestion.origin === 'project' ? 80 : 40)
  const normalized = query.trim().toLowerCase()
  if (!normalized) return base
  const haystack = `${suggestion.label} ${suggestion.value} ${suggestion.detail}`.toLowerCase()
  if (suggestion.label.toLowerCase().startsWith(normalized)) return base + 300
  if (haystack.includes(normalized)) return base + 200
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const matched = tokens.filter((token) => haystack.includes(token)).length
  return matched === tokens.length ? base + matched * 40 : -1
}

export function getSuggestions(
  slot: PromptSlot,
  project: ProjectContext,
  query = '',
): Suggestion[] {
  const builtIn = staticSuggestions[slot.kind].map((suggestion) => ({
    ...suggestion,
    kind: slot.kind,
  }))
  const seen = new Set<string>()

  return [...projectSuggestions(slot, project), ...builtIn]
    .map((suggestion) => ({ ...suggestion, score: textScore(suggestion, query) }))
    .filter((suggestion) => (suggestion.score ?? -1) >= 0)
    .filter((suggestion) => {
      const key = suggestion.value.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
}

export function toSelection(suggestion: Suggestion): import('../domain/types').SlotSelection {
  return {
    id: suggestion.id,
    label: suggestion.label,
    value: suggestion.value,
    source: suggestion.source,
    origin: suggestion.origin,
  }
}

export function isProjectSelectionStale(
  slot: PromptSlot,
  selection: SlotSelection | undefined,
  project: ProjectContext,
): boolean {
  if (selection?.origin !== 'project') return false
  return !getSuggestions(slot, project).some(
    (suggestion) => suggestion.origin === 'project' && suggestion.value === selection.value,
  )
}

export function initialValuesFor(
  template: PromptTemplate,
  project: ProjectContext,
): PromptValues {
  return Object.fromEntries(
    template.slots.flatMap((slot) => {
      const preset = template.initialValues[slot.id]
      if (!preset) return []
      if (preset.origin !== 'project') return [[slot.id, preset]]

      const projectSuggestions = getSuggestions(slot, project).filter(
        (suggestion) => suggestion.origin === 'project',
      )
      const resolved =
        projectSuggestions.find((suggestion) => suggestion.value === preset.value) ??
        projectSuggestions[0]
      return resolved ? [[slot.id, toSelection(resolved)]] : []
    }),
  )
}

export function customSuggestion(slot: PromptSlot, value: string): Suggestion {
  const normalizedValue = value.trim().slice(0, MAX_SELECTION_VALUE_LENGTH)

  return {
    id: `custom-${slot.id}-${normalizedValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`,
    kind: slot.kind,
    label: normalizedValue,
    value: normalizedValue,
    detail: 'Use your exact wording',
    source: 'Custom value',
    origin: 'custom' as SuggestionOrigin,
    score: 1_000,
  }
}
