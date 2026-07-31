import {
  MAX_SELECTION_VALUE_LENGTH,
  MAX_SELECTION_SOURCE_LENGTH,
  type ProjectContext,
  type PromptValues,
  type RecentPrompt,
  type SlotSelection,
} from '../domain/types'
import { isSafeProjectPath } from './projectAnalyzer'

const STORAGE_KEY = 'turbo-prompt:workspace:v1'
const MAX_STORED_CHARS = 750_000
const origins = new Set<SlotSelection['origin']>(['project', 'template', 'recent', 'custom'])
const partialReasons = new Set(['limit', 'unreadable'])
const safeColorPattern = /^#[0-9a-f]{6}$/i

function hasUnsafeDisplayControls(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x061c ||
      (codePoint >= 0x200e && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) return true
  }
  return false
}

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

function isDisplayString(value: unknown, max = 8_192): value is string {
  return isString(value, max) && !hasUnsafeDisplayControls(value)
}

function isDateString(value: unknown): value is string {
  if (!isString(value, 128)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function normalizeProject(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.instructions)) return value
  return {
    ...value,
    instructions: value.instructions.map((instruction) => {
      if (!isRecord(instruction)) return instruction
      const source = typeof instruction.source === 'string' ? instruction.source : ''
      return {
        ...instruction,
        scope: source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '',
      }
    }),
  }
}

function isSelection(value: unknown): value is SlotSelection {
  if (!isRecord(value)) return false
  return (
    isString(value.id, 256) &&
    isString(value.label, MAX_SELECTION_VALUE_LENGTH) &&
    isString(value.value, MAX_SELECTION_VALUE_LENGTH) &&
    isString(value.source, MAX_SELECTION_SOURCE_LENGTH) &&
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
    isDisplayString(value.id, 256) &&
    isDisplayString(value.name, 512) &&
    isDisplayString(value.rootLabel, 4_096) &&
    (value.branch === null || isDisplayString(value.branch, 512)) &&
    isDisplayString(value.summary, 8_192) &&
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
        isSafeProjectPath(file.path) &&
        typeof file.kind === 'string' &&
        fileKinds.has(file.kind) &&
        (file.state === undefined ||
          (typeof file.state === 'string' && fileStates.has(file.state))),
    ) &&
    Array.isArray(directories) &&
    directories.length <= 80 &&
    directories.every(
      (directory) => isString(directory, 4_096) && isSafeProjectPath(directory),
    ) &&
    Array.isArray(languages) &&
    languages.length <= 100 &&
    languages.every(
      (language) =>
        isRecord(language) &&
        isDisplayString(language.name, 128) &&
        typeof language.count === 'number' &&
        Number.isInteger(language.count) &&
        language.count >= 0 &&
        isString(language.color, 64) &&
        safeColorPattern.test(language.color),
    ) &&
    Array.isArray(frameworks) &&
    frameworks.length <= 100 &&
    frameworks.every((framework) => isDisplayString(framework, 128)) &&
    (value.packageManager === null || isDisplayString(value.packageManager, 128)) &&
    Array.isArray(scripts) &&
    scripts.length <= 50 &&
    scripts.every(
      (script) =>
        isRecord(script) &&
        isDisplayString(script.name, 256) &&
        isDisplayString(script.command, 4_096) &&
        isDisplayString(script.source, 4_096),
    ) &&
    Array.isArray(instructions) &&
    instructions.length <= 20 &&
    instructions.every(
      (instruction) =>
        isRecord(instruction) &&
        isDisplayString(instruction.text, 16_384) &&
        isString(instruction.source, 4_096) &&
        isSafeProjectPath(instruction.source) &&
        isString(instruction.scope, 4_096) &&
        (instruction.scope === '' || isSafeProjectPath(instruction.scope)),
    ) &&
    Array.isArray(manifests) &&
    manifests.length <= 50 &&
    manifests.every(
      (manifest) => isString(manifest, 4_096) && isSafeProjectPath(manifest),
    ) &&
    isDateString(value.indexedAt) &&
    typeof value.isDemo === 'boolean' &&
    (value.truncated === undefined || typeof value.truncated === 'boolean') &&
    (value.partialReasons === undefined ||
      (Array.isArray(value.partialReasons) &&
        value.partialReasons.length <= 2 &&
        new Set(value.partialReasons).size === value.partialReasons.length &&
        value.partialReasons.every(
          (reason) => typeof reason === 'string' && partialReasons.has(reason),
        ) &&
        (value.partialReasons.length === 0 || value.truncated === true)))
  )
}

function isRecent(value: unknown): value is RecentPrompt {
  return (
    isRecord(value) &&
    isString(value.id, 256) &&
    isString(value.fingerprint, 256) &&
    isString(value.title, 512) &&
    isString(value.text, 250_000) &&
    typeof value.textExact === 'boolean' &&
    isString(value.preview, 2_048) &&
    isString(value.templateId, 256) &&
    isString(value.projectId, 256) &&
    isString(value.projectName, 512) &&
    isValues(value.values) &&
    isDateString(value.createdAt)
  )
}

export function loadWorkspace(): StoredWorkspace | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw || raw.length > MAX_STORED_CHARS) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.schemaVersion !== 1) return null
    if (!isString(parsed.templateId, 256) || !isValues(parsed.values)) return null
    const normalizedProject = normalizeProject(parsed.project)
    if (!isProject(normalizedProject)) return null
    if (!Array.isArray(parsed.recents) || parsed.recents.length > 20) return null
    const project = normalizedProject

    // Early v1 drafts predate per-recent project identity. Backfill from the
    // validated workspace project instead of discarding otherwise safe state.
    const recents = parsed.recents.map((recent) => {
      if (!isRecord(recent)) return recent
      const hasStoredText = isString(recent.text, 250_000)
      return {
        ...recent,
        fingerprint: isString(recent.fingerprint, 256)
          ? recent.fingerprint
          : `legacy-${String(recent.id).slice(0, 128)}`,
        text: hasStoredText
          ? recent.text
          : typeof recent.preview === 'string' ? recent.preview : '',
        textExact: hasStoredText
          ? typeof recent.textExact === 'boolean' ? recent.textExact : true
          : false,
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

export function clearWorkspace(): boolean {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    return window.localStorage.getItem(STORAGE_KEY) === null
  } catch {
    return false
  }
}

export function fitWorkspaceRecents(workspace: StoredWorkspace): RecentPrompt[] {
  try {
    let recents = workspace.recents.slice(0, 20)
    let serialized = JSON.stringify({ ...workspace, recents })
    while (serialized.length > MAX_STORED_CHARS && recents.length) {
      recents = recents.slice(0, -1)
      serialized = JSON.stringify({ ...workspace, recents })
    }
    return recents
  } catch {
    return []
  }
}

export function saveWorkspace(workspace: StoredWorkspace): boolean {
  try {
    const recents = fitWorkspaceRecents(workspace)
    const serialized = JSON.stringify({ ...workspace, recents })
    if (serialized.length > MAX_STORED_CHARS) return false

    window.localStorage.setItem(STORAGE_KEY, serialized)
    return true
  } catch {
    // Persistence is a convenience; private or full storage must not block composing.
    return false
  }
}
