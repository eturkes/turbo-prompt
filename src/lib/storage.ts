import {
  MAX_SELECTION_VALUE_LENGTH,
  type ProjectContext,
  type PromptValues,
  type RecentPrompt,
  type SlotSelection,
} from '../domain/types'

const STORAGE_KEY = 'turbo-prompt:workspace:v1'
const MAX_STORED_CHARS = 750_000
const origins = new Set<SlotSelection['origin']>(['project', 'template', 'recent', 'custom'])

export interface StoredWorkspace {
  schemaVersion: 1
  templateId: string
  values: PromptValues
  project: ProjectContext
  recents: RecentPrompt[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown, max = 8_192): value is string {
  return typeof value === 'string' && value.length <= max
}

function isSelection(value: unknown): value is SlotSelection {
  if (!isRecord(value)) return false
  return (
    isString(value.id, 256) &&
    isString(value.label, MAX_SELECTION_VALUE_LENGTH) &&
    isString(value.value, MAX_SELECTION_VALUE_LENGTH) &&
    isString(value.source, 4_096) &&
    typeof value.origin === 'string' &&
    origins.has(value.origin as SlotSelection['origin'])
  )
}

function isValues(value: unknown): value is PromptValues {
  if (!isRecord(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length <= 32 &&
    entries.every(
      ([slotId, selection]) =>
        /^[a-z][a-z0-9_-]{0,63}$/i.test(slotId) && isSelection(selection),
    )
  )
}

function isProject(value: unknown): value is ProjectContext {
  if (!isRecord(value)) return false
  const files = value.files
  const directories = value.directories
  const languages = value.languages
  const frameworks = value.frameworks
  const scripts = value.scripts
  const instructions = value.instructions
  const manifests = value.manifests
  const fileKinds = new Set(['source', 'test', 'config', 'docs', 'other'])
  const fileStates = new Set(['modified', 'new'])

  return (
    value.schemaVersion === 1 &&
    isString(value.id, 256) &&
    isString(value.name, 512) &&
    isString(value.rootLabel, 4_096) &&
    (value.branch === null || isString(value.branch, 512)) &&
    isString(value.summary, 8_192) &&
    typeof value.fileCount === 'number' &&
    Number.isInteger(value.fileCount) &&
    value.fileCount >= 0 &&
    value.fileCount <= 1_000_000 &&
    Array.isArray(files) &&
    files.length <= 160 &&
    files.every(
      (file) =>
        isRecord(file) &&
        isString(file.path, 4_096) &&
        typeof file.kind === 'string' &&
        fileKinds.has(file.kind) &&
        (file.state === undefined ||
          (typeof file.state === 'string' && fileStates.has(file.state))),
    ) &&
    Array.isArray(directories) &&
    directories.length <= 80 &&
    directories.every((directory) => isString(directory, 4_096)) &&
    Array.isArray(languages) &&
    languages.length <= 100 &&
    languages.every(
      (language) =>
        isRecord(language) &&
        isString(language.name, 128) &&
        typeof language.count === 'number' &&
        Number.isInteger(language.count) &&
        language.count >= 0 &&
        isString(language.color, 64),
    ) &&
    Array.isArray(frameworks) &&
    frameworks.length <= 100 &&
    frameworks.every((framework) => isString(framework, 128)) &&
    (value.packageManager === null || isString(value.packageManager, 128)) &&
    Array.isArray(scripts) &&
    scripts.length <= 50 &&
    scripts.every(
      (script) =>
        isRecord(script) &&
        isString(script.name, 256) &&
        isString(script.command, 4_096) &&
        isString(script.source, 4_096),
    ) &&
    Array.isArray(instructions) &&
    instructions.length <= 20 &&
    instructions.every(
      (instruction) =>
        isRecord(instruction) &&
        isString(instruction.text, 16_384) &&
        isString(instruction.source, 4_096),
    ) &&
    Array.isArray(manifests) &&
    manifests.length <= 50 &&
    manifests.every((manifest) => isString(manifest, 4_096)) &&
    isString(value.indexedAt, 128) &&
    typeof value.isDemo === 'boolean' &&
    (value.truncated === undefined || typeof value.truncated === 'boolean')
  )
}

function isRecent(value: unknown): value is RecentPrompt {
  return (
    isRecord(value) &&
    isString(value.id, 256) &&
    isString(value.title, 512) &&
    isString(value.preview, 2_048) &&
    isString(value.templateId, 256) &&
    isString(value.projectId, 256) &&
    isString(value.projectName, 512) &&
    isValues(value.values) &&
    isString(value.createdAt, 128)
  )
}

export function loadWorkspace(): StoredWorkspace | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw || raw.length > MAX_STORED_CHARS) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) return null
    if (!isString(parsed.templateId, 256) || !isValues(parsed.values)) return null
    if (!isProject(parsed.project)) return null
    if (!Array.isArray(parsed.recents) || parsed.recents.length > 20) return null
    const project = parsed.project

    // Early v1 drafts predate per-recent project identity. Backfill from the
    // validated workspace project instead of discarding otherwise safe state.
    const recents = parsed.recents.map((recent) => {
      if (!isRecord(recent)) return recent
      return {
        ...recent,
        projectId: isString(recent.projectId, 256)
          ? recent.projectId
          : project.id,
        projectName: isString(recent.projectName, 512)
          ? recent.projectName
          : project.name,
      }
    })
    if (!recents.every(isRecent)) return null

    return {
      schemaVersion: 1,
      templateId: parsed.templateId,
      values: parsed.values,
      project,
      recents,
    }
  } catch {
    return null
  }
}

export function clearWorkspace(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A blocked storage surface already behaves like a cleared workspace.
  }
}

export function saveWorkspace(workspace: StoredWorkspace): boolean {
  try {
    let recents = workspace.recents.slice(0, 20)
    let serialized = JSON.stringify({ ...workspace, recents })

    // Recents repeat full prompt values for exact restoration. Retain newest
    // entries while guaranteeing anything written can pass the loader's cap.
    while (serialized.length > MAX_STORED_CHARS && recents.length) {
      recents = recents.slice(0, -1)
      serialized = JSON.stringify({ ...workspace, recents })
    }
    if (serialized.length > MAX_STORED_CHARS) return false

    window.localStorage.setItem(STORAGE_KEY, serialized)
    return true
  } catch {
    // Persistence is a convenience; private or full storage must not block composing.
    return false
  }
}
