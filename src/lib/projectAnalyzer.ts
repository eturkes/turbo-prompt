import type {
  ProjectContext,
  ProjectFile,
  ProjectIndexPartialReason,
  ProjectInstruction,
  ProjectLanguage,
  ProjectScript,
} from '../domain/types'

const MAX_FILES = 2_500
const MAX_ENTRIES = 10_000
const MAX_INPUT_PATHS = 100_000
const MAX_DEPTH = 40
const MAX_CONFIG_BYTES = 128_000
const MAX_PATH_LENGTH = 1_024
const safeScriptNamePattern = /^[a-z0-9][a-z0-9:._-]{0,127}$/i
const safePackageNamePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i

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
const ignoredSegments = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.angular',
  '.dart_tool',
  '.gradle',
  '.hypothesis',
  '.mypy_cache',
  '.nox',
  '.parcel-cache',
  '.pnpm-store',
  '.pytest_cache',
  '.ruff_cache',
  '.svelte-kit',
  '.tox',
  '.venv',
  '.yarn',
  '__pycache__',
  'node_modules',
  'pods',
  'site-packages',
  'vendor',
  'venv',
  'dist',
  'build',
  'coverage',
  'target',
])
const secretPattern = /(^|\/)(\.env(?:\..*)?|(?:credentials?|secrets?)(?:[-_.][^/]*)?|\.npmrc|\.pypirc|\.netrc|id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:pem|p12|pfx|key))$/i
const secretDirectoryPattern = /^(?:\.aws|\.azure|\.gnupg|\.kube|\.ssh|(?:credentials?|secrets?)(?:[-_.][^/]*)?)$/i

const languagesByExtension: Record<string, { name: string; color: string }> = {
  ts: { name: 'TypeScript', color: '#4169e1' },
  tsx: { name: 'TypeScript', color: '#4169e1' },
  js: { name: 'JavaScript', color: '#eab308' },
  jsx: { name: 'JavaScript', color: '#eab308' },
  css: { name: 'CSS', color: '#a855f7' },
  scss: { name: 'SCSS', color: '#d946ef' },
  html: { name: 'HTML', color: '#f97316' },
  rs: { name: 'Rust', color: '#c2410c' },
  go: { name: 'Go', color: '#0891b2' },
  py: { name: 'Python', color: '#2563eb' },
  rb: { name: 'Ruby', color: '#dc2626' },
  java: { name: 'Java', color: '#ea580c' },
  kt: { name: 'Kotlin', color: '#7c3aed' },
  swift: { name: 'Swift', color: '#f43f5e' },
  php: { name: 'PHP', color: '#6366f1' },
  c: { name: 'C', color: '#64748b' },
  h: { name: 'C', color: '#64748b' },
  cc: { name: 'C++', color: '#2563eb' },
  cpp: { name: 'C++', color: '#2563eb' },
  cxx: { name: 'C++', color: '#2563eb' },
  hpp: { name: 'C++', color: '#2563eb' },
  cs: { name: 'C#', color: '#7c3aed' },
  dart: { name: 'Dart', color: '#0891b2' },
  ex: { name: 'Elixir', color: '#7c3aed' },
  exs: { name: 'Elixir', color: '#7c3aed' },
  hs: { name: 'Haskell', color: '#6366f1' },
  lua: { name: 'Lua', color: '#1d4ed8' },
  scala: { name: 'Scala', color: '#dc2626' },
  sh: { name: 'Shell', color: '#4d7c0f' },
  sql: { name: 'SQL', color: '#ca8a04' },
  svelte: { name: 'Svelte', color: '#ea580c' },
  vue: { name: 'Vue', color: '#16a34a' },
  md: { name: 'Markdown', color: '#2f9e75' },
}

function relativePath(file: File): string {
  return file.webkitRelativePath || file.name
}

export function isSafeProjectPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (
    !normalized ||
    normalized.length > MAX_PATH_LENGTH ||
    hasUnsafeTextControls(normalized) ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    segments.some((segment) => segment === '..')
  ) return false
  if (secretPattern.test(normalized)) return false
  if (segments.some((segment) => secretDirectoryPattern.test(segment))) return false
  return !segments.some((segment) => ignoredSegments.has(segment.toLowerCase()))
}

function fileKind(path: string): ProjectFile['kind'] {
  const lower = path.toLowerCase()
  if (/(^|\/)(test|tests|spec|specs|__tests__)(\/|$)|\.(test|spec)\.[^.]+$/.test(lower)) return 'test'
  if (/(^|\/)(readme|agents|claude|contributing)(\.|$)|\.(md|mdx)$/.test(lower)) return 'docs'
  if (/(^|\/)(package\.json|cargo\.toml|pyproject\.toml|go\.mod|tsconfig[^/]*\.json|vite\.config\.)/.test(lower)) return 'config'
  const extension = lower.split('.').pop() ?? ''
  if (languagesByExtension[extension]) return 'source'
  return 'other'
}

function rootName(paths: string[]): string {
  const firstSegments = paths.map((path) => path.split('/')[0]).filter(Boolean)
  const first = firstSegments[0]
  if (first && firstSegments.every((segment) => segment === first) && paths.some((path) => path.includes('/'))) {
    return first
  }
  return 'local-project'
}

function pathWithoutRoot(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function manifestName(path: string): boolean {
  return /(^|\/)(package\.json|cargo\.toml|pyproject\.toml|go\.mod|composer\.json|gemfile|deno\.jsonc?|vite\.config\.[^/]+|tsconfig\.json)$/i.test(path)
}

function instructionName(path: string): boolean {
  return /(^|\/)(agents\.md|claude\.md|contributing\.md)$/i.test(path)
}

function retentionPriority(path: string): number {
  if (
    manifestName(path) ||
    instructionName(path) ||
    /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i.test(path)
  ) return 0
  const kind = fileKind(path)
  if (kind === 'source') return 1
  if (kind === 'test') return 2
  if (kind === 'config') return 3
  if (kind === 'docs') return 4
  return 5
}

export function compareProjectPaths(left: string, right: string): number {
  return retentionPriority(left) - retentionPriority(right) || left.localeCompare(right)
}

function evenlySample<T>(values: readonly T[], limit: number): T[] {
  if (values.length <= limit) return [...values]
  if (limit <= 0) return []
  if (limit === 1) return [values[0]!]
  return Array.from({ length: limit }, (_, index) =>
    values[Math.round((index * (values.length - 1)) / (limit - 1))]!,
  )
}

function representativeProjectFiles(files: ProjectFile[], limit: number): ProjectFile[] {
  const quotas: Record<ProjectFile['kind'], number> = {
    source: 60,
    test: 24,
    config: 16,
    docs: 12,
    other: 8,
  }
  const selected = new Set<string>()
  for (const kind of Object.keys(quotas) as ProjectFile['kind'][]) {
    const candidates = files.filter((file) => file.kind === kind)
    for (const file of evenlySample(candidates, quotas[kind])) selected.add(file.path)
  }
  const remaining = files.filter((file) => !selected.has(file.path))
  for (const file of evenlySample(remaining, limit - selected.size)) selected.add(file.path)
  return files.filter((file) => selected.has(file.path)).slice(0, limit)
}

interface RankedFile {
  file: File
  path: string
}

function pushRankedFile(heap: RankedFile[], candidate: RankedFile): void {
  const swap = (left: number, right: number) => {
    const previous = heap[left]!
    heap[left] = heap[right]!
    heap[right] = previous
  }

  if (heap.length < MAX_FILES) {
    heap.push(candidate)
    let index = heap.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (compareProjectPaths(heap[parent]!.path, heap[index]!.path) >= 0) break
      swap(parent, index)
      index = parent
    }
    return
  }

  if (compareProjectPaths(candidate.path, heap[0]!.path) >= 0) return
  heap[0] = candidate
  let index = 0
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    let worst = index
    if (
      left < heap.length &&
      compareProjectPaths(heap[left]!.path, heap[worst]!.path) > 0
    ) worst = left
    if (
      right < heap.length &&
      compareProjectPaths(heap[right]!.path, heap[worst]!.path) > 0
    ) worst = right
    if (worst === index) break
    swap(index, worst)
    index = worst
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Project indexing was cancelled.', 'AbortError')
}

async function safeRead(
  file: File,
  signal?: AbortSignal,
  onPartial?: (reason: ProjectIndexPartialReason) => void,
): Promise<string> {
  throwIfAborted(signal)
  if (file.size > MAX_CONFIG_BYTES) {
    onPartial?.('limit')
    return ''
  }
  try {
    const contents = await file.text()
    throwIfAborted(signal)
    return contents
  } catch {
    onPartial?.('unreadable')
    return ''
  }
}

function detectPackageManager(paths: string[]): string | null {
  if (paths.includes('pnpm-lock.yaml')) return 'pnpm'
  if (paths.some((path) => /^bun\.lockb?$/.test(path))) return 'bun'
  if (paths.includes('yarn.lock')) return 'yarn'
  if (paths.includes('package-lock.json')) return 'npm'
  return null
}

function stableId(value: string): string {
  let hash = 2_166_136_261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

export async function analyzeProjectFiles(
  input: readonly File[],
  signal?: AbortSignal,
  collectionTruncated = false,
  collectionPartialReasons: readonly ProjectIndexPartialReason[] = [],
): Promise<ProjectContext> {
  const rankedFiles: RankedFile[] = []
  let safeFileCount = 0
  const inspectedCount = Math.min(input.length, MAX_INPUT_PATHS)
  for (let index = 0; index < inspectedCount; index += 1) {
    throwIfAborted(signal)
    const inputIndex =
      input.length > MAX_INPUT_PATHS
        ? Math.round((index * (input.length - 1)) / (MAX_INPUT_PATHS - 1))
        : index
    const file = input[inputIndex]!
    const path = relativePath(file)
    if (isSafeProjectPath(path)) {
      safeFileCount += 1
      pushRankedFile(rankedFiles, { file, path })
    }
    if (index > 0 && index % 4_096 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  }
  const reachedLimit = input.length > MAX_INPUT_PATHS || safeFileCount > MAX_FILES
  const partialReasonSet = new Set<ProjectIndexPartialReason>([
    ...collectionPartialReasons,
    ...((reachedLimit || (collectionTruncated && !collectionPartialReasons.length))
      ? ['limit' as const]
      : []),
  ])
  const accepted = rankedFiles
    .sort((left, right) => compareProjectPaths(left.path, right.path))
    .map((candidate) => candidate.file)
  if (!accepted.length) throw new Error('No safe project files were found in that folder.')

  const rawPaths = accepted.map(relativePath)
  const root = rootName(rawPaths)
  const normalizedPaths = rawPaths.map((path) => pathWithoutRoot(path, root))
  const languageCounts = new Map<string, ProjectLanguage>()

  for (const path of normalizedPaths) {
    throwIfAborted(signal)
    const extension = path.split('.').pop()?.toLowerCase() ?? ''
    const language = languagesByExtension[extension]
    if (!language) continue
    const current = languageCounts.get(language.name)
    languageCounts.set(language.name, {
      ...language,
      count: (current?.count ?? 0) + 1,
    })
  }

  const packageFileIndex = normalizedPaths.findIndex((path) => path === 'package.json')
  let packageName = root
  let scripts: ProjectScript[] = []
  let dependencies: string[] = []
  if (packageFileIndex >= 0) {
    const contents = await safeRead(
      accepted[packageFileIndex]!,
      signal,
      (reason) => partialReasonSet.add(reason),
    )
    try {
      const parsed = JSON.parse(contents) as {
        name?: unknown
        scripts?: unknown
        dependencies?: unknown
        devDependencies?: unknown
      }
      if (
        typeof parsed.name === 'string' &&
        parsed.name.length <= 512 &&
        safePackageNamePattern.test(parsed.name)
      ) {
        packageName = parsed.name
      }
      if (parsed.scripts && typeof parsed.scripts === 'object') {
        const scriptEntries = Object.entries(parsed.scripts as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .filter(([name]) => safeScriptNamePattern.test(name))
        if (scriptEntries.length > 20) partialReasonSet.add('limit')
        scripts = scriptEntries
          .slice(0, 20)
          .map(([name]) => ({
            name,
            command: `${detectPackageManager(normalizedPaths) ?? 'npm'} run ${name}`,
            source: 'package.json',
          }))
      }
      dependencies = [
        ...Object.keys((parsed.dependencies as Record<string, unknown> | undefined) ?? {}),
        ...Object.keys((parsed.devDependencies as Record<string, unknown> | undefined) ?? {}),
      ]
    } catch {
      // A malformed manifest is still indexed as a file; it simply contributes no metadata.
    }
  }

  const frameworkSignals: Array<[string, string[]]> = [
    ['React', ['react']],
    ['Vue', ['vue']],
    ['Svelte', ['svelte']],
    ['Angular', ['@angular/core']],
    ['Next.js', ['next']],
    ['Astro', ['astro']],
    ['Vite', ['vite']],
    ['Vitest', ['vitest']],
    ['Playwright', ['@playwright/test', 'playwright']],
  ]
  const frameworks = frameworkSignals
    .filter(([, signals]) => signals.some((signal) => dependencies.includes(signal)))
    .map(([name]) => name)

  const instructionCandidates = accepted
    .map((file, index) => ({ file, source: normalizedPaths[index]! }))
    .filter(({ source }) => instructionName(source))
  const rootInstruction = instructionCandidates.find(({ source }) => !source.includes('/'))
  const scopedByDirectory = Array.from(
    instructionCandidates.reduce((groups, candidate) => {
      if (!candidate.source.includes('/')) return groups
      const scope = candidate.source.slice(0, candidate.source.lastIndexOf('/'))
      if (!groups.has(scope)) groups.set(scope, candidate)
      return groups
    }, new Map<string, (typeof instructionCandidates)[number]>()),
    ([, candidate]) => candidate,
  )
  const scopedInstructionBudget = 17
  const sampledScopedInstructions = scopedByDirectory.length <= scopedInstructionBudget
    ? scopedByDirectory
    : Array.from({ length: scopedInstructionBudget }, (_, index) =>
        scopedByDirectory[
          Math.round((index * (scopedByDirectory.length - 1)) / (scopedInstructionBudget - 1))
        ]!,
      )
  const instructionFiles = [
    ...(rootInstruction ? [rootInstruction] : []),
    ...sampledScopedInstructions,
  ]
  const instructionGroups = await Promise.all(
    instructionFiles.map(async ({ file, source }) => {
      const scope = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : ''
      const text = await safeRead(file, signal, (reason) => partialReasonSet.add(reason))
      const lineBudget = scope ? 1 : 3
      const bulletLines = text
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
        .filter((line): line is string => typeof line === 'string')
      if (bulletLines.some((line) => line.length > 180) || bulletLines.length > lineBudget) {
        partialReasonSet.add('limit')
      }
      return bulletLines
        .filter(
          (line): line is string =>
            line.length >= 12 && line.length <= 180 && !hasUnsafeTextControls(line),
        )
        .slice(0, lineBudget)
        .map<ProjectInstruction>((line) => ({ text: line, source, scope }))
    }),
  )
  const instructions = instructionGroups.flat().slice(0, 20)
  throwIfAborted(signal)

  const priority = (path: string): number => {
    const kind = fileKind(path)
    if (kind === 'source') return 0
    if (kind === 'test') return 1
    if (kind === 'config') return 2
    if (kind === 'docs') return 3
    return 4
  }
  const rankedProjectFiles = normalizedPaths
    .map((path) => ({ path, kind: fileKind(path) }))
    .sort((left, right) => priority(left.path) - priority(right.path) || left.path.localeCompare(right.path))
  const projectFiles = representativeProjectFiles(rankedProjectFiles, 120)

  const allDirectories = Array.from(
    new Set(
      normalizedPaths.flatMap((path) => {
        const parts = path.split('/').slice(0, -1)
        if (!parts.length) return []
        const values = [parts[0]!]
        if (parts.length > 1) values.push(`${parts[0]}/${parts[1]}`)
        return values
      }),
    ),
  ).sort()
  const directories = evenlySample(allDirectories, 40)
  const languages = [...languageCounts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      Number(left.name === 'Markdown') - Number(right.name === 'Markdown') ||
      left.name.localeCompare(right.name),
  )
  const topStack = [...frameworks.slice(0, 2), ...languages.slice(0, 2).map((item) => item.name)]
  const allManifests = normalizedPaths.filter(manifestName)
  if (
    rankedProjectFiles.length > projectFiles.length ||
    allDirectories.length > directories.length ||
    allManifests.length > 20 ||
    scopedByDirectory.length > sampledScopedInstructions.length ||
    instructionCandidates.length > Number(Boolean(rootInstruction)) + scopedByDirectory.length ||
    instructions.length < instructionGroups.flat().length
  ) partialReasonSet.add('limit')
  const partialReasons = [...partialReasonSet]
  const truncated = collectionTruncated || reachedLimit || partialReasons.length > 0

  return {
    schemaVersion: 1,
    id: `local-${stableId(`${packageName}:${normalizedPaths.join('|')}`)}`,
    name: packageName,
    rootLabel: root,
    branch: null,
    summary: `${topStack.length ? `${topStack.join(' + ')} project` : 'Project'} indexed locally from the selected folder.${partialReasons.includes('limit') ? ' The safety cap was reached; representative high-signal files were retained.' : ''}${partialReasons.includes('unreadable') ? ' Unreadable paths were omitted.' : ''}`,
    fileCount: accepted.length,
    files: projectFiles,
    directories,
    languages,
    frameworks,
    packageManager: detectPackageManager(normalizedPaths),
    scripts,
    instructions,
    manifests: evenlySample(allManifests, 20),
    indexedAt: new Date().toISOString(),
    isDemo: false,
    truncated,
    ...(partialReasons.length ? { partialReasons } : {}),
  }
}

export const projectAnalysisLimits = {
  maxFiles: MAX_FILES,
  maxEntries: MAX_ENTRIES,
  maxInputPaths: MAX_INPUT_PATHS,
  maxDepth: MAX_DEPTH,
  maxConfigBytes: MAX_CONFIG_BYTES,
} as const
