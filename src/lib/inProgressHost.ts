import {
  connectInProgress as connectProtocol,
  type InProgressClient,
} from '@in-progress/protocol/client'
import type { PluginTheme } from '@in-progress/protocol'

import type { ProjectContext, ProjectIndexPartialReason } from '../domain/types'
import {
  analyzeProjectEntries,
  type ProjectAnalysisEntry,
  type ProjectReadResult,
} from './projectAnalyzer'

export const inProgressCapabilities = [
  'project.metadata',
  'project.tree',
  'project.readText',
] as const

export type InProgressHostClient = InProgressClient

export function isEmbeddedFrame(): boolean {
  return window.parent !== window
}

export function connectInProgress(timeoutMs = 10_000): Promise<InProgressClient> {
  return connectProtocol({
    timeoutMs,
    requiredCapabilities: inProgressCapabilities,
    applyTheme: false,
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Project indexing was cancelled.', 'AbortError')
}

function serializedHostReader(client: InProgressClient) {
  let tail = Promise.resolve()
  return (path: string, signal?: AbortSignal): Promise<ProjectReadResult> => {
    const task = tail.then(async () => {
      throwIfAborted(signal)
      const value = await client.call('project.readText', { path }, signal ? { signal } : {})
      if (value.path !== path) throw new Error('Host returned a different project file')
      return { text: value.text, truncated: value.truncated }
    })
    tail = task.then(
      () => undefined,
      () => undefined,
    )
    return task
  }
}

export async function loadInProgressProject(
  client: InProgressClient,
  signal?: AbortSignal,
): Promise<ProjectContext> {
  client.setStatus({ state: 'busy', title: 'Indexing project' })
  try {
    const [metadata, tree] = await Promise.all([
      client.call('project.metadata'),
      client.call('project.tree', { depth: 6, limit: 2_000 }),
    ])
    if (metadata.id !== client.context.project.id) {
      throw new Error('Host project identity changed during startup')
    }
    if (!metadata.available) throw new Error(`${metadata.name} is unavailable`)
    const entries = tree
      .filter((entry) => entry.kind === 'file')
      .map<ProjectAnalysisEntry>((entry) => ({ path: entry.path, size: entry.size ?? 0 }))
    const reachedHostLimit =
      tree.length >= 2_000 || tree.some((entry) => entry.kind === 'directory' && entry.depth >= 6)
    const partialReasons: ProjectIndexPartialReason[] = reachedHostLimit ? ['limit'] : []
    const project = await analyzeProjectEntries(
      entries,
      serializedHostReader(client),
      signal,
      reachedHostLimit,
      partialReasons,
      { stripCommonRoot: false },
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

export function applyInProgressTheme(theme: PluginTheme): void {
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
  set(
    '--blue-soft',
    colors.accent &&
      `color-mix(in srgb, ${colors.accent} 18%, ${colors.background ?? 'transparent'})`,
  )
  set(
    '--blue-pale',
    colors.accent &&
      `color-mix(in srgb, ${colors.accent} 10%, ${colors.background ?? 'transparent'})`,
  )
  set(
    '--green-soft',
    colors.accent &&
      `color-mix(in srgb, ${colors.accent} 14%, ${colors.background ?? 'transparent'})`,
  )
  set(
    '--amber-soft',
    colors.warning &&
      `color-mix(in srgb, ${colors.warning} 14%, ${colors.background ?? 'transparent'})`,
  )
  const uiFont = theme.tokens.uiFont
  const monoFont = theme.tokens.monoFont
  if (uiFont && /^[a-z0-9 _-]{1,80}$/i.test(uiFont)) {
    set('--ui-font', `'${uiFont}', 'Instrument Sans Variable', sans-serif`)
  }
  if (monoFont && /^[a-z0-9 _-]{1,80}$/i.test(monoFont)) {
    set('--mono', `'${monoFont}', monospace`)
  }
}
