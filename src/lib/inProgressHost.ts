import type { ProjectContext, ProjectIndexPartialReason } from '../domain/types'
import {
  analyzeProjectEntries,
  type ProjectAnalysisEntry,
  type ProjectReadResult,
} from './projectAnalyzer'

export const IN_PROGRESS_API_VERSION = '1.0' as const
export const inProgressCapabilities = [
  'project.metadata',
  'project.tree',
  'project.readText',
] as const

export type InProgressCapability = (typeof inProgressCapabilities)[number]

export interface InProgressProjectMetadata {
  id: string
  name: string
  displayPath: string
  color: string
  branch: string | null
  available: boolean
}

export interface InProgressTreeEntry {
  path: string
  name: string
  kind: 'directory' | 'file' | 'symlink'
  depth: number
  size?: number
}

export interface InProgressTheme {
  mode: 'dark' | 'light'
  tokens: Record<string, string>
}

export interface InProgressContext {
  apiVersion: typeof IN_PROGRESS_API_VERSION
  capabilities: string[]
  project: {
    id: string
    name: string
    color: string
    available: boolean
  }
  theme: InProgressTheme
}

interface InProgressMethodMap {
  'project.metadata': { params: undefined; result: unknown }
  'project.tree': { params: { depth: number; limit: number }; result: unknown }
  'project.readText': { params: { path: string }; result: unknown }
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUnsafeTextControls(value: string): boolean {
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

function displayString(value: unknown, label: string, max = 4_096): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    hasUnsafeTextControls(value)
  ) throw new Error(`Invalid ${label} from in-progress host`)
  return value
}

function parseContext(value: unknown): InProgressContext {
  if (!isRecord(value) || value.apiVersion !== IN_PROGRESS_API_VERSION) {
    throw new Error('Unsupported in-progress host API')
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every((item) => typeof item === 'string')) {
    throw new Error('Invalid capability list from in-progress host')
  }
  for (const capability of inProgressCapabilities) {
    if (!value.capabilities.includes(capability)) {
      throw new Error(`Required capability was not granted: ${capability}`)
    }
  }
  if (!isRecord(value.project) || typeof value.project.available !== 'boolean') {
    throw new Error('Invalid project context from in-progress host')
  }
  if (!isRecord(value.theme) || (value.theme.mode !== 'dark' && value.theme.mode !== 'light')) {
    throw new Error('Invalid theme from in-progress host')
  }
  if (!isRecord(value.theme.tokens)) throw new Error('Invalid theme tokens from in-progress host')
  const tokens = Object.fromEntries(
    Object.entries(value.theme.tokens)
      .filter((entry): entry is [string, string] =>
        /^[a-z][a-zA-Z0-9]{0,63}$/.test(entry[0]) &&
        typeof entry[1] === 'string' &&
        entry[1].length <= 256,
      )
      .slice(0, 64),
  )

  return {
    apiVersion: IN_PROGRESS_API_VERSION,
    capabilities: [...value.capabilities],
    project: {
      id: displayString(value.project.id, 'project id', 256),
      name: displayString(value.project.name, 'project name', 512),
      color: displayString(value.project.color, 'project color', 64),
      available: value.project.available,
    },
    theme: { mode: value.theme.mode, tokens },
  }
}

export class InProgressHostClient {
  readonly context: InProgressContext
  readonly #port: MessagePort
  readonly #pending = new Map<string, PendingCall>()

  constructor(port: MessagePort, context: InProgressContext) {
    this.#port = port
    this.context = context
    port.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data
      if (!isRecord(data) || data.kind !== 'response' || typeof data.id !== 'string') return
      const pending = this.#pending.get(data.id)
      if (!pending) return
      this.#pending.delete(data.id)
      window.clearTimeout(pending.timer)
      if (data.ok === true) pending.resolve(data.result)
      else if (data.ok === false) {
        pending.reject(new Error(typeof data.error === 'string' ? data.error.slice(0, 1_024) : 'Host RPC failed'))
      } else {
        pending.reject(new Error('Malformed response from in-progress host'))
      }
    })
    port.start()
  }

  call<M extends InProgressCapability>(
    method: M,
    ...args: undefined extends InProgressMethodMap[M]['params']
      ? [params?: InProgressMethodMap[M]['params']]
      : [params: InProgressMethodMap[M]['params']]
  ): Promise<InProgressMethodMap[M]['result']> {
    if (!this.context.capabilities.includes(method)) {
      return Promise.reject(new Error(`Capability not granted: ${method}`))
    }
    const id = crypto.randomUUID()
    const params = args[0]
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`Host RPC timed out: ${method}`))
      }, 15_000)
      this.#pending.set(id, { resolve, reject, timer })
      this.#port.postMessage({
        kind: 'request',
        id,
        method,
        ...(params === undefined ? {} : { params }),
      })
    })
  }

  setStatus(status: {
    state: 'idle' | 'busy' | 'attention' | 'error'
    badge?: string | null
    title?: string | null
  }): void {
    this.#port.postMessage({ kind: 'event', name: 'status', payload: status })
  }

  dispose(): void {
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(new Error('in-progress host connection disposed'))
    }
    this.#pending.clear()
    this.#port.close()
  }
}

export function isEmbeddedFrame(): boolean {
  return window.parent !== window
}

export function connectInProgress(timeoutMs = 10_000): Promise<InProgressHostClient> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', receive)
      reject(new Error('in-progress host handshake timed out'))
    }, timeoutMs)

    function finish(): void {
      window.clearTimeout(timer)
      window.removeEventListener('message', receive)
    }

    function receive(event: MessageEvent<unknown>): void {
      if (event.source !== window.parent || !isRecord(event.data)) return
      if (event.data.type !== 'in-progress:init') return
      const port = event.ports[0]
      try {
        if (!port) throw new Error('in-progress host supplied no message port')
        const nonce = displayString(event.data.nonce, 'handshake nonce', 256)
        const context = parseContext(event.data.context)
        finish()
        port.postMessage({ kind: 'ready', nonce })
        resolve(new InProgressHostClient(port, context))
      } catch (error) {
        finish()
        port?.close()
        reject(error instanceof Error ? error : new Error('Invalid in-progress host handshake'))
      }
    }

    window.addEventListener('message', receive)
  })
}

function parseMetadata(value: unknown): InProgressProjectMetadata {
  if (!isRecord(value) || typeof value.available !== 'boolean') {
    throw new Error('Invalid project metadata from in-progress host')
  }
  const branch = value.branch === null ? null : displayString(value.branch, 'project branch', 512)
  return {
    id: displayString(value.id, 'project id', 256),
    name: displayString(value.name, 'project name', 512),
    displayPath: displayString(value.displayPath, 'project path'),
    color: displayString(value.color, 'project color', 64),
    branch,
    available: value.available,
  }
}

function parseTree(value: unknown): InProgressTreeEntry[] {
  if (!Array.isArray(value) || value.length > 2_000) {
    throw new Error('Invalid project tree from in-progress host')
  }
  return value.map((item) => {
    if (
      !isRecord(item) ||
      (item.kind !== 'directory' && item.kind !== 'file' && item.kind !== 'symlink') ||
      !Number.isInteger(item.depth) ||
      (item.depth as number) < 0 ||
      (item.depth as number) > 6
    ) throw new Error('Invalid project tree entry from in-progress host')
    const size = item.size
    if (size !== undefined && (!Number.isSafeInteger(size) || (size as number) < 0)) {
      throw new Error('Invalid project file size from in-progress host')
    }
    return {
      path: displayString(item.path, 'project path'),
      name: displayString(item.name, 'project entry name', 512),
      kind: item.kind,
      depth: item.depth as number,
      ...(size === undefined ? {} : { size: size as number }),
    }
  })
}

function parseProjectText(value: unknown, expectedPath: string): ProjectReadResult {
  if (
    !isRecord(value) ||
    value.path !== expectedPath ||
    typeof value.text !== 'string' ||
    value.text.length > 256 * 1_024 ||
    typeof value.truncated !== 'boolean'
  ) throw new Error('Invalid project text from in-progress host')
  return { text: value.text, truncated: value.truncated }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Project indexing was cancelled.', 'AbortError')
}

function serializedHostReader(client: InProgressHostClient) {
  let tail = Promise.resolve()
  return (path: string, signal?: AbortSignal): Promise<ProjectReadResult> => {
    const task = tail.then(async () => {
      throwIfAborted(signal)
      const value = await client.call('project.readText', { path })
      throwIfAborted(signal)
      return parseProjectText(value, path)
    })
    tail = task.then(() => undefined, () => undefined)
    return task
  }
}

export async function loadInProgressProject(
  client: InProgressHostClient,
  signal?: AbortSignal,
): Promise<ProjectContext> {
  client.setStatus({ state: 'busy', title: 'Indexing project' })
  try {
    const [metadataValue, treeValue] = await Promise.all([
      client.call('project.metadata'),
      client.call('project.tree', { depth: 6, limit: 2_000 }),
    ])
    const metadata = parseMetadata(metadataValue)
    if (metadata.id !== client.context.project.id) {
      throw new Error('Host project identity changed during startup')
    }
    if (!metadata.available) throw new Error(`${metadata.name} is unavailable`)
    const tree = parseTree(treeValue)
    const entries = tree
      .filter((entry) => entry.kind === 'file')
      .map<ProjectAnalysisEntry>((entry) => ({ path: entry.path, size: entry.size ?? 0 }))
    const reachedHostLimit =
      tree.length >= 2_000 ||
      tree.some((entry) => entry.kind === 'directory' && entry.depth >= 6)
    const partialReasons: ProjectIndexPartialReason[] = reachedHostLimit ? ['limit'] : []
    const project = await analyzeProjectEntries(
      entries,
      serializedHostReader(client),
      signal,
      reachedHostLimit,
      partialReasons,
    )
    client.setStatus({ state: 'idle', title: 'Prompt workspace ready' })
    return {
      ...project,
      id: `in-progress:${metadata.id}`,
      name: metadata.name,
      rootLabel: metadata.displayPath,
      branch: metadata.branch,
      summary: project.summary.replace(
        'indexed locally from the selected folder.',
        'indexed locally through the in-progress host.',
      ),
      isDemo: false,
    }
  } catch (error) {
    client.setStatus({ state: 'error', title: 'Project indexing failed' })
    throw error
  }
}

const themeColorTokens = [
  'background',
  'surface',
  'surfaceRaised',
  'border',
  'text',
  'muted',
  'accent',
  'warning',
  'danger',
] as const

export function applyInProgressTheme(theme: InProgressTheme): void {
  const root = document.documentElement
  const colors = Object.fromEntries(
    themeColorTokens.flatMap((name) => {
      const value = theme.tokens[name]
      return value && /^#[0-9a-f]{6}$/i.test(value) ? [[name, value]] : []
    }),
  )
  const set = (name: string, value: string | undefined) => {
    if (value) root.style.setProperty(name, value)
  }
  root.dataset.inProgressEmbedded = 'true'
  root.dataset.theme = theme.mode
  root.style.colorScheme = theme.mode
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeColor && colors.background) themeColor.content = colors.background
  set('--canvas', colors.background)
  set('--surface', colors.surface)
  set('--surface-raised', colors.surfaceRaised)
  set('--surface-muted', colors.surfaceRaised)
  set('--ink', colors.text)
  set('--ink-soft', colors.text)
  set('--muted', colors.muted)
  set('--faint', colors.muted)
  set('--rule', colors.border)
  set('--rule-strong', colors.border)
  set('--blue', colors.accent)
  set('--blue-dark', colors.accent)
  set('--green', colors.accent)
  set('--amber', colors.warning)
  set('--red', colors.danger)
  set('--blue-soft', colors.accent && `color-mix(in srgb, ${colors.accent} 18%, ${colors.background ?? 'transparent'})`)
  set('--blue-pale', colors.accent && `color-mix(in srgb, ${colors.accent} 10%, ${colors.background ?? 'transparent'})`)
  set('--green-soft', colors.accent && `color-mix(in srgb, ${colors.accent} 14%, ${colors.background ?? 'transparent'})`)
  set('--amber-soft', colors.warning && `color-mix(in srgb, ${colors.warning} 14%, ${colors.background ?? 'transparent'})`)
  const uiFont = theme.tokens.uiFont
  const monoFont = theme.tokens.monoFont
  if (uiFont && /^[a-z0-9 _-]{1,80}$/i.test(uiFont)) {
    set('--ui-font', `'${uiFont}', 'Instrument Sans Variable', sans-serif`)
  }
  if (monoFont && /^[a-z0-9 _-]{1,80}$/i.test(monoFont)) set('--mono', `'${monoFont}', monospace`)
}
