import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from 'react'
import { FolderOpen, RotateCcw, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import { demoProject } from '../data/demoProject'
import type { ProjectContext, ProjectIndexPartialReason } from '../domain/types'
import {
  analyzeProjectFiles,
  compareProjectPaths,
  isSafeProjectPath,
  projectAnalysisLimits,
} from '../lib/projectAnalyzer'

interface ProjectDialogProps {
  open: boolean
  currentProject: ProjectContext
  onClose: () => void
  onProject: (project: ProjectContext) => void
  onClearWorkspace: () => void
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: {
    id?: string
    mode?: 'read' | 'readwrite'
  }) => Promise<FileSystemDirectoryHandle>
}

const directoryInputAttributes = { webkitdirectory: '' }
const rootTraversalQuantum = 256

interface LoadedProjectFiles {
  files: File[]
  truncated: boolean
  partialReasons: ProjectIndexPartialReason[]
}

interface HandleCandidate {
  handle: FileSystemFileHandle
  path: string
}

interface DroppedCandidate {
  entry: FileSystemFileEntry
  path: string
}

interface PendingDroppedDirectory {
  reader: FileSystemDirectoryReader
  depth: number
  path: string
  buffered: FileSystemEntry[]
}

function traversalPriority(path: string): number {
  if (!path) return -1_000
  const segments = path.toLowerCase().split('/')
  if (
    segments.some((segment) => ['src', 'app', 'lib', 'packages', 'test', 'tests'].includes(segment))
  ) {
    return -100
  }
  if (segments.some((segment) => ['assets', 'images', 'public', 'static'].includes(segment))) {
    return 100
  }
  return 0
}

function traversalQuantum(depth: number, path: string): number {
  if (depth === 0) return rootTraversalQuantum
  return traversalPriority(path) < 0 ? 64 : 1
}

function rankedCandidates<T extends { path: string }>(candidates: T[]): T[] {
  return candidates.sort((left, right) => compareProjectPaths(left.path, right.path))
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Project indexing was cancelled.', 'AbortError')
}

function fileWithRelativePath(file: File, path: string): File {
  try {
    Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path })
    return file
  } catch {
    const copy = new File([file], file.name, { lastModified: file.lastModified, type: file.type })
    Object.defineProperty(copy, 'webkitRelativePath', { configurable: true, value: path })
    return copy
  }
}

async function readDirectoryHandle(
  directory: FileSystemDirectoryHandle,
  signal: AbortSignal,
): Promise<LoadedProjectFiles> {
  const root = directory.name
  const candidates: HandleCandidate[] = []
  const pending: Array<{
    iterator: AsyncIterator<[string, FileSystemHandle]>
    parent: string
    depth: number
  }> = [
    {
      iterator: directory.entries()[Symbol.asyncIterator](),
      parent: '',
      depth: 0,
    },
  ]
  let entries = 0
  let depthTruncated = false
  let unreadable = false

  // Each round visits every discovered directory. Root enumeration receives a
  // larger quantum so late sibling directories are discovered without letting
  // any one descendant consume the entire safety budget.
  while (pending.length && entries < projectAnalysisLimits.maxEntries) {
    throwIfCancelled(signal)
    const active = pending
      .splice(0)
      .sort(
        (left, right) =>
          traversalPriority(left.parent) - traversalPriority(right.parent) ||
          left.depth - right.depth ||
          left.parent.localeCompare(right.parent),
      )
    const survivors: typeof pending = []
    const discovered: typeof pending = []

    for (const current of active) {
      let exhausted = false
      const quantum = traversalQuantum(current.depth, current.parent)

      for (
        let index = 0;
        index < quantum && entries < projectAnalysisLimits.maxEntries;
        index += 1
      ) {
        let next: IteratorResult<[string, FileSystemHandle]>
        try {
          next = await current.iterator.next()
        } catch {
          unreadable = true
          exhausted = true
          break
        }
        if (next.done) {
          exhausted = true
          break
        }
        entries += 1
        const [name, entry] = next.value
        const relativePath = current.parent ? `${current.parent}/${name}` : name
        const projectPath = `${root}/${relativePath}`
        if (!isSafeProjectPath(projectPath)) continue

        if (entry.kind === 'directory') {
          if (current.depth < projectAnalysisLimits.maxDepth) {
            const directoryEntry = entry as FileSystemDirectoryHandle
            try {
              discovered.push({
                iterator: directoryEntry.entries()[Symbol.asyncIterator](),
                parent: relativePath,
                depth: current.depth + 1,
              })
            } catch {
              unreadable = true
            }
          } else {
            depthTruncated = true
          }
        } else {
          candidates.push({ handle: entry as FileSystemFileHandle, path: projectPath })
        }

        if (entries >= projectAnalysisLimits.maxEntries) break
      }

      if (!exhausted) survivors.push(current)
      if (entries >= projectAnalysisLimits.maxEntries) break
    }

    pending.push(...survivors, ...discovered)
  }

  const files: File[] = []
  for (const candidate of rankedCandidates(candidates)) {
    if (files.length >= projectAnalysisLimits.maxFiles) break
    throwIfCancelled(signal)
    try {
      files.push(fileWithRelativePath(await candidate.handle.getFile(), candidate.path))
    } catch {
      unreadable = true
    }
  }

  const reachedLimit =
    candidates.length > projectAnalysisLimits.maxFiles ||
    entries >= projectAnalysisLimits.maxEntries ||
    depthTruncated
  const partialReasons: ProjectIndexPartialReason[] = [
    ...(reachedLimit ? ['limit' as const] : []),
    ...(unreadable ? ['unreadable' as const] : []),
  ]

  return {
    files,
    truncated: partialReasons.length > 0,
    partialReasons,
  }
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readEntryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

function collectDroppedEntry(
  entry: FileSystemEntry,
  depth: number,
  candidates: DroppedCandidate[],
  pending: PendingDroppedDirectory[],
): ProjectIndexPartialReason | null {
  const path = entry.fullPath.replace(/^\/+/, '') || entry.name
  if (!isSafeProjectPath(path)) return null

  if (entry.isFile) {
    candidates.push({ entry: entry as FileSystemFileEntry, path })
    return null
  }

  if (!entry.isDirectory) return null
  if (depth >= projectAnalysisLimits.maxDepth) return 'limit'
  try {
    pending.push({
      reader: (entry as FileSystemDirectoryEntry).createReader(),
      depth: depth + 1,
      path,
      buffered: [],
    })
    return null
  } catch {
    return 'unreadable'
  }
}

async function filesFromDrop(
  dataTransfer: DataTransfer,
  signal: AbortSignal,
): Promise<LoadedProjectFiles> {
  const fallback = Array.from(dataTransfer.files)
  const entries = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file' && typeof item.webkitGetAsEntry === 'function')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)

  if (!entries.length) {
    return {
      files: fallback,
      truncated: fallback.length > projectAnalysisLimits.maxFiles,
      partialReasons: fallback.length > projectAnalysisLimits.maxFiles ? ['limit'] : [],
    }
  }

  const candidates: DroppedCandidate[] = []
  const pending: PendingDroppedDirectory[] = []
  let entryCount = 0
  let depthTruncated = false
  let unreadable = false
  for (const entry of entries) {
    if (entryCount >= projectAnalysisLimits.maxEntries) break
    entryCount += 1
    const partialReason = collectDroppedEntry(entry, -1, candidates, pending)
    if (partialReason === 'limit') depthTruncated = true
    if (partialReason === 'unreadable') unreadable = true
  }

  // Readers yield batches, but one buffered entry per directory is consumed
  // per round so a large first directory cannot starve later siblings.
  while (pending.length && entryCount < projectAnalysisLimits.maxEntries) {
    throwIfCancelled(signal)
    const active = pending
      .splice(0)
      .sort(
        (left, right) =>
          traversalPriority(left.path) - traversalPriority(right.path) ||
          left.depth - right.depth ||
          left.path.localeCompare(right.path),
      )
    const survivors: PendingDroppedDirectory[] = []
    const discovered: PendingDroppedDirectory[] = []

    for (const current of active) {
      let exhausted = false
      const quantum = traversalQuantum(current.depth, current.path)

      for (let index = 0; index < quantum; index += 1) {
        if (!current.buffered.length) {
          try {
            current.buffered.push(...(await readEntryBatch(current.reader)))
          } catch {
            unreadable = true
            exhausted = true
            break
          }
        }
        const child = current.buffered.shift()
        if (!child) {
          exhausted = true
          break
        }
        entryCount += 1
        const partialReason = collectDroppedEntry(child, current.depth, candidates, discovered)
        if (partialReason === 'limit') depthTruncated = true
        if (partialReason === 'unreadable') unreadable = true
        if (entryCount >= projectAnalysisLimits.maxEntries) break
      }

      if (!exhausted) survivors.push(current)
      if (entryCount >= projectAnalysisLimits.maxEntries) break
    }

    pending.push(...survivors, ...discovered)
  }

  const files: File[] = []
  for (const candidate of rankedCandidates(candidates)) {
    if (files.length >= projectAnalysisLimits.maxFiles) break
    throwIfCancelled(signal)
    try {
      const file = await readEntryFile(candidate.entry)
      files.push(fileWithRelativePath(file, candidate.path))
    } catch {
      unreadable = true
    }
  }

  const reachedLimit =
    candidates.length > projectAnalysisLimits.maxFiles ||
    entryCount >= projectAnalysisLimits.maxEntries ||
    depthTruncated ||
    fallback.length > projectAnalysisLimits.maxFiles
  const partialReasons: ProjectIndexPartialReason[] = [
    ...(reachedLimit ? ['limit' as const] : []),
    ...(unreadable ? ['unreadable' as const] : []),
  ]

  return files.length
    ? {
        files,
        truncated: partialReasons.length > 0,
        partialReasons,
      }
    : {
        files: fallback,
        truncated: partialReasons.length > 0,
        partialReasons,
      }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'That folder could not be read. Try the compatibility picker instead.'
}

function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function ProjectDialog({
  open,
  currentProject,
  onClose,
  onProject,
  onClearWorkspace,
}: ProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const dragDepth = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const [isBusy, setIsBusy] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const supportsDirectoryPicker =
    typeof window !== 'undefined' &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function'

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog) return

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    primaryButtonRef.current?.focus()

    return () => {
      abortRef.current?.abort()
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      previouslyFocused?.focus()
    }
  }, [open])

  if (!open) return null

  const closeDialog = () => {
    abortRef.current?.abort()
    dragDepth.current = 0
    setIsDragging(false)
    setError(null)
    setStatus(null)
    setConfirmClear(false)
    onClose()
  }

  const indexFiles = async (
    loadFiles: (signal: AbortSignal) => LoadedProjectFiles | Promise<LoadedProjectFiles>,
    initialStatus: string,
  ) => {
    if (isBusy) return
    setIsBusy(true)
    setError(null)
    setStatus(initialStatus)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const loaded = await loadFiles(controller.signal)
      setStatus(`Indexing ${loaded.files.length.toLocaleString()} project files…`)
      const project = await analyzeProjectFiles(
        loaded.files,
        controller.signal,
        loaded.truncated,
        loaded.partialReasons,
      )
      setConfirmClear(false)
      onProject(project)
      onClose()
    } catch (caught) {
      if (!isCancelled(caught)) setError(errorText(caught))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsBusy(false)
      setStatus(null)
    }
  }

  const openFolder = () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker
    if (!picker) {
      inputRef.current?.click()
      return
    }
    void indexFiles(async (signal) => {
      const directory = await picker.call(window, { id: 'turbo-prompt-project', mode: 'read' })
      return readDirectoryHandle(directory, signal)
    }, 'Reading project folder…')
  }

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length) {
      void indexFiles(
        () => ({
          files,
          truncated: files.length > projectAnalysisLimits.maxFiles,
          partialReasons: files.length > projectAnalysisLimits.maxFiles ? ['limit'] : [],
        }),
        'Reading selected files…',
      )
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (isBusy) return
    dragDepth.current += 1
    setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (!dragDepth.current) setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    if (isBusy) return
    const dataTransfer = event.dataTransfer
    void indexFiles((signal) => filesFromDrop(dataTransfer, signal), 'Reading dropped project…')
  }

  const handleBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget || isBusy) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const outside =
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    if (outside) closeDialog()
  }

  const resetToDemo = () => {
    if (isBusy) return
    setConfirmClear(false)
    onProject(demoProject)
    onClose()
  }

  return (
    <dialog
      className="project-dialog"
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        closeDialog()
      }}
      onClick={handleBackdrop}
    >
      <div className="project-dialog-panel">
        <header className="project-dialog-header">
          <div className="project-dialog-heading">
            <span className="project-dialog-icon" aria-hidden="true">
              <FolderOpen size={20} />
            </span>
            <div>
              <h2 id={titleId}>Connect a project</h2>
              <p id={descriptionId}>
                Index a folder to fill prompt fields with real paths, scripts, stack details, and
                repo guidance.
              </p>
            </div>
          </div>
          <button
            className="icon-button project-dialog-close"
            type="button"
            aria-label="Close project dialog"
            onClick={closeDialog}
          >
            <X size={18} />
          </button>
        </header>

        <div className="project-current-context" aria-label="Current project">
          <span className="project-current-label">Active now</span>
          <strong>{currentProject.name}</strong>
          <span>
            {currentProject.isDemo ? 'Demo project' : 'Local project'} ·{' '}
            {currentProject.fileCount.toLocaleString()} files
          </span>
        </div>

        <div className="project-privacy-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Processed and stored locally</strong>
            <p>
              Files stay on this device. Indexed paths, detected project details,
              repository-guidance excerpts, and prompt history persist when browser storage is
              available.
            </p>
          </div>
        </div>

        <div
          className={`project-dropzone${isDragging ? ' is-dragging' : ''}`}
          onDragEnter={handleDragEnter}
          onDragOver={(event) => {
            event.preventDefault()
            if (!isBusy) event.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload size={24} aria-hidden="true" />
          <h3>Drop a project folder here</h3>
          <p>or choose a folder from this device</p>
          <button
            className="project-folder-button"
            ref={primaryButtonRef}
            type="button"
            onClick={() => {
              if (isBusy) abortRef.current?.abort()
              else openFolder()
            }}
          >
            {isBusy ? (
              <X size={17} aria-hidden="true" />
            ) : (
              <FolderOpen size={17} aria-hidden="true" />
            )}
            {isBusy ? 'Cancel indexing' : 'Choose project folder'}
          </button>
          {supportsDirectoryPicker && !isBusy && (
            <button
              className="project-compatibility-button"
              type="button"
              onClick={() => inputRef.current?.click()}
            >
              Use compatibility picker
            </button>
          )}
          <input
            {...directoryInputAttributes}
            className="project-folder-input"
            ref={inputRef}
            type="file"
            multiple
            hidden
            aria-label="Choose project folder using the compatibility picker"
            onChange={handleInput}
          />
        </div>

        <div className="project-dialog-feedback" aria-live="polite" aria-atomic="true">
          {status && <p className="project-index-status">{status}</p>}
          {error && (
            <p className="project-index-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="project-dialog-footer">
          <p>Manage the project snapshot saved on this device.</p>
          <div className="project-dialog-footer-actions">
            <button
              className={`project-clear-button${confirmClear ? ' is-confirming' : ''}`}
              type="button"
              onClick={() => {
                if (confirmClear) {
                  setConfirmClear(false)
                  onClearWorkspace()
                } else setConfirmClear(true)
              }}
              disabled={isBusy}
            >
              <Trash2 size={14} aria-hidden="true" />
              {confirmClear ? 'Confirm clear' : 'Clear saved data'}
            </button>
            <button
              className="project-demo-button"
              type="button"
              onClick={resetToDemo}
              disabled={isBusy}
            >
              <RotateCcw size={15} aria-hidden="true" />
              Use demo
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  )
}
