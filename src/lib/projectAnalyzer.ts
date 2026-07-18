import type {
  ProjectContext,
  ProjectFile,
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

async function safeRead(file: File, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  if (file.size > MAX_CONFIG_BYTES) return ''
  try {
    const contents = await file.text()
    throwIfAborted(signal)
    return contents
  } catch {
    return ''
  }
}

function detectPackageManager(paths: string[]): string | null {
  if (paths.some((path) => /(^|\/)pnpm-lock\.yaml$/.test(path))) return 'pnpm'
  if (paths.some((path) => /(^|\/)bun\.lockb?$/.test(path))) return 'bun'
  if (paths.some((path) => /(^|\/)yarn\.lock$/.test(path))) return 'yarn'
  if (paths.some((path) => /(^|\/)package-lock\.json$/.test(path))) return 'npm'
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
  const truncated =
    collectionTruncated ||
    input.length > MAX_INPUT_PATHS ||
    safeFileCount > MAX_FILES
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
    const contents = await safeRead(accepted[packageFileIndex]!, signal)
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
        scripts = Object.entries(parsed.scripts as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          .filter(([name]) => safeScriptNamePattern.test(name))
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

  const instructionFiles = accepted.filter((_, index) => instructionName(normalizedPaths[index]!)).slice(0, 3)
  const instructionGroups = await Promise.all(
    instructionFiles.map(async (file) => {
      const source = pathWithoutRoot(relativePath(file), root)
      const text = await safeRead(file, signal)
      return text
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*[-*]\s+(.{12,180})$/)?.[1]?.trim())
        .filter(
          (line): line is string =>
            typeof line === 'string' && !hasUnsafeTextControls(line),
        )
        .slice(0, 3)
        .map<ProjectInstruction>((line) => ({ text: line, source }))
    }),
  )
  const instructions = instructionGroups.flat().slice(0, 6)
  throwIfAborted(signal)

  const priority = (path: string): number => {
    const kind = fileKind(path)
    if (kind === 'source') return 0
    if (kind === 'test') return 1
    if (kind === 'config') return 2
    if (kind === 'docs') return 3
    return 4
  }
  const projectFiles = normalizedPaths
    .map((path) => ({ path, kind: fileKind(path) }))
    .sort((left, right) => priority(left.path) - priority(right.path) || left.path.localeCompare(right.path))
    .slice(0, 120)

  const directories = Array.from(
    new Set(
      normalizedPaths.flatMap((path) => {
        const parts = path.split('/').slice(0, -1)
        if (!parts.length) return []
        const values = [parts[0]!]
        if (parts.length > 1) values.push(`${parts[0]}/${parts[1]}`)
        return values
      }),
    ),
  )
    .sort()
    .slice(0, 40)
  const languages = [...languageCounts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      Number(left.name === 'Markdown') - Number(right.name === 'Markdown') ||
      left.name.localeCompare(right.name),
  )
  const topStack = [...frameworks.slice(0, 2), ...languages.slice(0, 2).map((item) => item.name)]

  return {
    schemaVersion: 1,
    id: `local-${stableId(`${packageName}:${normalizedPaths.join('|')}`)}`,
    name: packageName,
    rootLabel: root,
    branch: null,
    summary: topStack.length
      ? `${topStack.join(' + ')} project indexed locally from the selected folder.${truncated ? ' The folder scan reached its safety cap; representative high-signal files were retained.' : ''}`
      : `Project indexed locally from the selected folder.${truncated ? ' The folder scan reached its safety cap; representative high-signal files were retained.' : ''}`,
    fileCount: accepted.length,
    files: projectFiles,
    directories,
    languages,
    frameworks,
    packageManager: detectPackageManager(normalizedPaths),
    scripts,
    instructions,
    manifests: normalizedPaths.filter(manifestName).slice(0, 20),
    indexedAt: new Date().toISOString(),
    isDemo: false,
    truncated,
  }
}

export const projectAnalysisLimits = {
  maxFiles: MAX_FILES,
  maxEntries: MAX_ENTRIES,
  maxInputPaths: MAX_INPUT_PATHS,
  maxDepth: MAX_DEPTH,
  maxConfigBytes: MAX_CONFIG_BYTES,
} as const
