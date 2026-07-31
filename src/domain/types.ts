export type SlotKind =
  | 'action'
  | 'target'
  | 'outcome'
  | 'context'
  | 'constraint'
  | 'verification'
  | 'deliverable'

export type SuggestionOrigin = 'project' | 'template' | 'recent' | 'custom'

export const MAX_SELECTION_VALUE_LENGTH = 16_384
export const MAX_SELECTION_SOURCE_LENGTH = 4_096

export interface Suggestion {
  id: string
  kind: SlotKind
  label: string
  value: string
  detail: string
  source: string
  origin: SuggestionOrigin
  score?: number
}

export interface SlotSelection {
  id: string
  label: string
  value: string
  source: string
  origin: SuggestionOrigin
}

export interface PromptSlot {
  id: string
  kind: SlotKind
  label: string
  placeholder: string
  required: boolean
  description: string
}

export type PromptSegment =
  | { type: 'text'; value: string }
  | { type: 'slot'; slotId: string }
  | {
      type: 'optional'
      whenFilled: string[]
      segments: Array<{ type: 'text'; value: string } | { type: 'slot'; slotId: string }>
    }

export type TemplateIcon = 'spark' | 'bug' | 'search' | 'layers' | 'flask'

export interface PromptTemplate {
  schemaVersion: 1
  id: string
  title: string
  shortTitle: string
  description: string
  icon: TemplateIcon
  segments: PromptSegment[]
  slots: PromptSlot[]
  initialValues: Record<string, SlotSelection>
}

export type PromptValues = Record<string, SlotSelection | undefined>

export interface ProjectFile {
  path: string
  kind: 'source' | 'test' | 'config' | 'docs' | 'other'
  state?: 'modified' | 'new'
}

export interface ProjectScript {
  name: string
  command: string
  source: string
}

export interface ProjectInstruction {
  text: string
  source: string
  scope: string
}

export interface ProjectLanguage {
  name: string
  count: number
  color: string
}

export type ProjectIndexPartialReason = 'limit' | 'unreadable'

export interface ProjectContext {
  schemaVersion: 1
  id: string
  name: string
  rootLabel: string
  branch: string | null
  summary: string
  fileCount: number
  files: ProjectFile[]
  directories: string[]
  languages: ProjectLanguage[]
  frameworks: string[]
  packageManager: string | null
  scripts: ProjectScript[]
  instructions: ProjectInstruction[]
  manifests: string[]
  indexedAt: string
  isDemo: boolean
  truncated?: boolean
  partialReasons?: ProjectIndexPartialReason[]
}

export interface CompileDiagnostic {
  slotId: string
  label: string
  message: string
}

export interface CompiledPrompt {
  text: string
  diagnostics: CompileDiagnostic[]
  filled: number
  total: number
  complete: boolean
}

export interface RecentPrompt {
  id: string
  fingerprint: string
  title: string
  text: string
  textExact: boolean
  preview: string
  templateId: string
  projectId: string
  projectName: string
  values: PromptValues
  createdAt: string
}
