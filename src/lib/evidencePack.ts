import {
  MAX_SELECTION_SOURCE_LENGTH,
  MAX_SELECTION_VALUE_LENGTH,
  type ProjectContext,
  type ProjectFile,
  type ProjectInstruction,
  type ProjectScript,
  type PromptValues,
  type SlotSelection,
} from '../domain/types'

export type EvidenceSlotId = 'context' | 'constraint' | 'verification'

export interface EvidencePackProposal {
  slotId: EvidenceSlotId
  label: string
  detail: string
  selection: SlotSelection
}

export interface ProjectEvidencePack {
  target: string
  relatedFiles: ProjectFile[]
  instructions: ProjectInstruction[]
  proposals: EvidencePackProposal[]
}

function directory(path: string): string {
  const separator = path.lastIndexOf('/')
  return separator < 0 ? '' : path.slice(0, separator)
}

function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

function stem(path: string): string {
  return (path.split('/').at(-1) ?? path)
    .replace(/\.(?:test|spec)\b/gi, '')
    .replace(/(?:_test|-test)\b/gi, '')
    .replace(/\.[^.]+$/, '')
}

function moduleStem(path: string): string {
  const pathStem = stem(path)
  return pathStem.toLowerCase() === 'index'
    ? (directory(path).split('/').at(-1) ?? pathStem)
    : pathStem
}

function moduleTokens(path: string): string[] {
  return moduleStem(path)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/i)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
}

function commonDirectoryDepth(left: string, right: string): number {
  const leftParts = pathSegments(directory(left))
  const rightParts = pathSegments(directory(right))
  let depth = 0
  while (leftParts[depth] && leftParts[depth] === rightParts[depth]) depth += 1
  return depth
}

const workspaceCollections = new Set(['apps', 'packages', 'services', 'crates', 'modules'])

function workspaceBoundary(project: ProjectContext, path: string): string {
  const segments = pathSegments(path)
  const nestedManifestScope = project.manifests
    .map(directory)
    .filter(
      (scope) =>
        scope && (path === scope || path.startsWith(`${scope}/`)),
    )
    .sort((left, right) => pathSegments(right).length - pathSegments(left).length)[0]
  if (nestedManifestScope) return `manifest:${nestedManifestScope}`
  if (workspaceCollections.has((segments[0] ?? '').toLowerCase()) && segments[1]) {
    return `workspace:${segments[0]!.toLowerCase()}/${segments[1]}`
  }
  return 'root'
}

function relationScore(target: ProjectFile, candidate: ProjectFile, project: ProjectContext): number {
  const targetStem = moduleStem(target.path)
  const candidateStem = moduleStem(candidate.path)
  const sharedDepth = commonDirectoryDepth(target.path, candidate.path)
  const sameDirectory = directory(target.path) === directory(candidate.path)
  let score = sharedDepth * 14
  const targetBoundary = workspaceBoundary(project, target.path)
  const candidateBoundary = workspaceBoundary(project, candidate.path)
  if (targetBoundary !== candidateBoundary) score -= 300

  if (sameDirectory) score += 26
  const sameStem = Boolean(targetStem && targetStem === candidateStem)
  const targetTokens = new Set(moduleTokens(target.path))
  const relatedStem = moduleTokens(candidate.path).some(
    (token) => token.length >= 2 && targetTokens.has(token),
  )
  if (sameStem) score += 150
  else if (relatedStem) score += 70

  if (candidate.kind === 'test') {
    if (sameStem || relatedStem) score += target.kind === 'source' ? 55 : 22
    else score -= 30
  }
  else if (candidate.kind === 'source') score += 14
  else if (candidate.kind === 'config' && project.manifests.includes(candidate.path)) {
    const manifestScope = directory(candidate.path)
    if (!manifestScope || target.path === manifestScope || target.path.startsWith(`${manifestScope}/`)) {
      score += 24 + pathSegments(manifestScope).length * 12
    }
  }

  return score
}

export function applicableProjectInstructions(
  project: ProjectContext,
  target: string | undefined,
): ProjectInstruction[] {
  return project.instructions
    .map((instruction, index) => ({ instruction, index }))
    .filter(({ instruction }) => {
      if (!instruction.scope) return true
      if (!target) return false
      return target === instruction.scope || target.startsWith(`${instruction.scope}/`)
    })
    .sort(
      (left, right) =>
        pathSegments(right.instruction.scope).length - pathSegments(left.instruction.scope).length ||
        left.index - right.index,
    )
    .map(({ instruction }) => instruction)
}

export function relatedProjectFiles(
  project: ProjectContext,
  targetPath: string,
  limit = 4,
): ProjectFile[] {
  const target = project.files.find((file) => file.path === targetPath)
  if (!target) {
    if (!project.directories.includes(targetPath)) return []
    return project.files
      .filter((file) => file.path.startsWith(`${targetPath}/`))
      .map((file) => {
        const relativeDepth = pathSegments(file.path.slice(targetPath.length + 1)).length
        const kindSignal = file.kind === 'test'
          ? 60
          : file.kind === 'source'
            ? 50
            : file.kind === 'config' && project.manifests.includes(file.path)
              ? 45
              : file.kind === 'docs'
                ? 5
                : 0
        return { file, score: 180 - relativeDepth * 12 + kindSignal + (file.state ? 24 : 0) }
      })
      .filter(({ score }) => score >= 150)
      .sort(
        (left, right) =>
          right.score - left.score ||
          Number(left.file.kind !== 'test') - Number(right.file.kind !== 'test') ||
          left.file.path.localeCompare(right.file.path),
      )
      .slice(0, limit)
      .map(({ file }) => file)
  }

  return project.files
    .filter((file) => file.path !== target.path)
    .map((file) => ({ file, score: relationScore(target, file, project) }))
    .filter(({ score }) => score >= 40)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(left.file.kind !== 'test') - Number(right.file.kind !== 'test') ||
        left.file.path.localeCompare(right.file.path),
    )
    .slice(0, limit)
    .map(({ file }) => file)
}

function scriptScore(script: ProjectScript): number | null {
  const name = script.name.toLowerCase()
  if (/(?:^|:)(?:dev|open|serve|start|ui|watch)(?::|$)/.test(name)) return null
  if (name === 'check' || name === 'verify' || name === 'ci') return 1_000
  if (/^(?:test:e2e|e2e|test:integration)$/.test(name)) return 900
  if (name === 'test') return 850
  if (name.startsWith('test:')) return 800
  if (name === 'lint' || name === 'typecheck' || name === 'type-check') return 700
  if (name === 'build') return 600
  return null
}

export function isRecommendedVerificationScript(script: ProjectScript): boolean {
  return scriptScore(script) !== null
}

function strongestScript(project: ProjectContext): ProjectScript | undefined {
  return project.scripts
    .map((script, index) => ({ script, index, score: scriptScore(script) }))
    .filter(
      (candidate): candidate is { script: ProjectScript; index: number; score: number } =>
        candidate.score !== null,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.script
}

function stableHash(value: string): string {
  let hash = 2_166_136_261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

function boundedSource(source: string): string {
  if (source.length <= MAX_SELECTION_SOURCE_LENGTH) return source
  const suffix = ' · [source list truncated]'
  return `${source.slice(0, MAX_SELECTION_SOURCE_LENGTH - suffix.length)}${suffix}`
}

function evidenceSource(sources: string[]): string {
  const uniqueSources = [...new Set(sources)]
  let result = 'Project evidence'
  for (let index = 0; index < uniqueSources.length; index += 1) {
    const suffix = ` · +${uniqueSources.length - index} more source${uniqueSources.length - index === 1 ? '' : 's'}`
    const candidate = `${result} · ${uniqueSources[index]}`
    if (candidate.length + suffix.length > MAX_SELECTION_SOURCE_LENGTH) {
      return boundedSource(`${result}${suffix}`)
    }
    result = candidate
  }
  return result
}

function evidenceSelection(
  slotId: EvidenceSlotId,
  value: string,
  source: string,
): SlotSelection {
  const boundedValue = value.slice(0, MAX_SELECTION_VALUE_LENGTH)
  const boundedSelectionSource = boundedSource(source)
  const identity = stableHash(`${slotId}\u0000${value}\u0000${source}`)
  return {
    id: `evidence-${slotId}-${boundedValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36)}-${identity}`,
    label: boundedValue,
    value: boundedValue,
    source: boundedSelectionSource,
    origin: 'project',
  }
}

export type EvidenceProposalStatus = 'available' | 'applied' | 'protected'

export function evidenceProposalStatus(
  current: SlotSelection | undefined,
  proposal: EvidencePackProposal,
): EvidenceProposalStatus {
  if (current?.origin === 'custom' || current?.origin === 'recent') return 'protected'
  if (
    current?.origin === proposal.selection.origin &&
    current.value === proposal.selection.value &&
    current.source === proposal.selection.source
  ) return 'applied'
  return 'available'
}

export function applyEvidenceProposals(
  values: PromptValues,
  proposals: readonly EvidencePackProposal[],
  allowedSlotIds?: ReadonlySet<string>,
): PromptValues {
  let next = values
  for (const proposal of proposals) {
    if (allowedSlotIds && !allowedSlotIds.has(proposal.slotId)) continue
    if (evidenceProposalStatus(next[proposal.slotId], proposal) !== 'available') continue
    if (next === values) next = { ...values }
    next[proposal.slotId] = proposal.selection
  }
  return next
}

function contextValue(
  target: ProjectFile | undefined,
  targetPath: string,
  relatedFiles: ProjectFile[],
  instructions: ProjectInstruction[],
): string {
  const pieces: string[] = []
  const tests = relatedFiles.filter((file) => file.kind === 'test').slice(0, 2)
  const implementation = relatedFiles.filter((file) => file.kind === 'source').slice(0, 2)
  const manifests = relatedFiles.filter((file) => file.kind === 'config').slice(0, 1)

  pieces.push(
    target?.kind === 'source'
      ? `the implementation in ${targetPath}`
      : `the project area ${targetPath}`,
  )
  if (tests.length) pieces.push(`related coverage in ${tests.map((file) => file.path).join(' and ')}`)
  if (implementation.length) {
    pieces.push(`neighboring code in ${implementation.map((file) => file.path).join(' and ')}`)
  }
  if (manifests.length) pieces.push(`the scoped manifest ${manifests[0]!.path}`)
  if (instructions.length) {
    const sources = [...new Set(instructions.map((instruction) => instruction.source))]
    pieces.push(`applicable repository guidance in ${sources.join(' and ')}`)
  }

  return pieces.join(', ')
}

export function buildProjectEvidencePack(
  project: ProjectContext,
  targetSelection: SlotSelection | undefined,
): ProjectEvidencePack | null {
  const targetPath = targetSelection?.value.trim()
  if (!targetPath) return null
  const target = project.files.find((file) => file.path === targetPath)
  const isKnownDirectory = project.directories.includes(targetPath)
  if (!target && !isKnownDirectory) return null

  const relatedFiles = relatedProjectFiles(project, targetPath)
  const instructions = applicableProjectInstructions(project, targetPath)
  const sources = [
    targetPath,
    ...relatedFiles.map((file) => file.path),
    ...instructions.map((instruction) => instruction.source),
  ]
  const context = contextValue(target, targetPath, relatedFiles, instructions)
  const proposals: EvidencePackProposal[] = [
    {
      slotId: 'context',
      label: 'Scope evidence',
      detail: `${relatedFiles.length} related path${relatedFiles.length === 1 ? '' : 's'} · ${instructions.length} applicable rule${instructions.length === 1 ? '' : 's'}`,
      selection: evidenceSelection(
        'context',
        context,
        evidenceSource(sources),
      ),
    },
  ]

  const instruction = instructions[0]
  if (instruction) {
    proposals.push({
      slotId: 'constraint',
      label: 'In-scope instruction',
      detail: instruction.scope ? `Applies within ${instruction.scope}` : 'Applies project-wide',
      selection: evidenceSelection('constraint', instruction.text, instruction.source),
    })
  }

  const script = strongestScript(project)
  if (script) {
    proposals.push({
      slotId: 'verification',
      label: 'Recommended project check',
      detail: `${script.name} script`,
      selection: evidenceSelection('verification', script.command, `${script.source} · script`),
    })
  }

  return { target: targetPath, relatedFiles, instructions, proposals }
}
