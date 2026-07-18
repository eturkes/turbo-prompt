import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronsRight,
  CloudOff,
  FolderGit2,
  GitBranch,
} from 'lucide-react'
import { InspectorPanel } from './components/InspectorPanel'
import { ProjectDialog } from './components/ProjectDialog'
import { PromptComposer } from './components/PromptComposer'
import { TemplateSidebar } from './components/TemplateSidebar'
import { demoProject } from './data/demoProject'
import { defaultTemplate, templates } from './data/templates'
import type {
  ProjectContext,
  PromptTemplate,
  PromptValues,
  RecentPrompt,
  SlotSelection,
} from './domain/types'
import { compilePrompt } from './lib/compilePrompt'
import {
  initialValuesFor,
  isProjectSelectionStale,
} from './lib/suggestionEngine'
import { clearWorkspace, loadWorkspace, saveWorkspace } from './lib/storage'

const stored = loadWorkspace()
const storedTemplate = templates.find((template) => template.id === stored?.templateId)
const initialTemplate = storedTemplate ?? defaultTemplate
const usableStored = storedTemplate ? stored : null
const initialProject = usableStored?.project ?? demoProject
const initialValues =
  usableStored?.values ?? initialValuesFor(initialTemplate, initialProject)

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Some embedded/managed browsers expose Clipboard but reject writes; use the local fallback.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard write failed')
}

export default function App() {
  const [template, setTemplate] = useState<PromptTemplate>(initialTemplate)
  const [values, setValues] = useState<PromptValues>(initialValues)
  const [project, setProject] = useState<ProjectContext>(initialProject)
  const [recents, setRecents] = useState<RecentPrompt[]>(usableStored?.recents ?? [])
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [undoDraft, setUndoDraft] = useState<{
    template: PromptTemplate
    values: PromptValues
  } | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  const copyOperation = useRef(0)
  const undoReturnFocus = useRef<HTMLElement | null>(null)
  const skipNextWorkspaceSave = useRef(false)
  const compiled = useMemo(() => compilePrompt(template, values), [template, values])
  const staleSlots = useMemo(
    () =>
      template.slots.filter((slot) =>
        isProjectSelectionStale(slot, values[slot.id], project),
      ),
    [project, template.slots, values],
  )
  const ready = compiled.complete && staleSlots.length === 0

  useEffect(() => {
    if (skipNextWorkspaceSave.current) {
      skipNextWorkspaceSave.current = false
      return
    }
    saveWorkspace({
      schemaVersion: 1,
      templateId: template.id,
      values,
      project,
      recents,
    })
  }, [project, recents, template.id, values])

  useEffect(() => () => {
    window.clearTimeout(noticeTimer.current)
    window.clearTimeout(copyTimer.current)
    copyOperation.current += 1
  }, [])

  const flash = (
    message: string,
    undo?: { template: PromptTemplate; values: PromptValues },
  ) => {
    window.clearTimeout(noticeTimer.current)
    setNotice(message)
    setUndoDraft(undo ?? null)
    if (!undo) undoReturnFocus.current = null
    if (undo) return
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null)
      setUndoDraft(null)
    }, 2_400)
  }

  const dismissNotice = () => {
    window.clearTimeout(noticeTimer.current)
    setNotice(null)
    setUndoDraft(null)
    undoReturnFocus.current = null
  }

  const invalidateCopy = () => {
    copyOperation.current += 1
    window.clearTimeout(copyTimer.current)
    setCopiedText(null)
  }

  const handleTemplate = (next: PromptTemplate) => {
    dismissNotice()
    setTemplate(next)
    setValues((current) => {
      const defaults = initialValuesFor(next, project)
      const nextValues = { ...current }

      for (const slot of next.slots) {
        const currentValue = current[slot.id]
        const value =
          currentValue && currentValue.origin !== 'template'
            ? currentValue
            : defaults[slot.id]

        if (value) nextValues[slot.id] = value
        else delete nextValues[slot.id]
      }

      return nextValues
    })
    invalidateCopy()
  }

  const handleNew = () => {
    const previousDraft = { template, values }
    undoReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTemplate(defaultTemplate)
    setValues(initialValuesFor(defaultTemplate, project))
    invalidateCopy()
    flash('New prompt ready', previousDraft)
  }

  const handleReset = () => {
    const previousDraft = { template, values }
    undoReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setValues(initialValuesFor(template, project))
    invalidateCopy()
    flash('Prompt reset', previousDraft)
  }

  const handleUndo = () => {
    if (!undoDraft) return
    const returnFocus = undoReturnFocus.current
    window.clearTimeout(noticeTimer.current)
    setTemplate(undoDraft.template)
    setValues(undoDraft.values)
    invalidateCopy()
    setUndoDraft(null)
    setNotice(null)
    undoReturnFocus.current = null
    window.requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus()
    })
  }

  const handleDismissUndo = () => {
    const returnFocus = undoReturnFocus.current
    dismissNotice()
    window.requestAnimationFrame(() => {
      if (returnFocus?.isConnected) returnFocus.focus()
    })
  }

  const handleValue = (slotId: string, value: SlotSelection | undefined) => {
    dismissNotice()
    setValues((current) => ({ ...current, [slotId]: value }))
    invalidateCopy()
  }

  const handleCopy = async () => {
    dismissNotice()
    if (!ready) {
      flash(
        staleSlots.length
          ? `Replace ${staleSlots[0]!.label.toLowerCase()} with a ${project.name} suggestion first`
          : `Complete ${compiled.diagnostics[0]?.label ?? 'the remaining field'} first`,
      )
      return
    }
    const operation = copyOperation.current + 1
    copyOperation.current = operation
    window.clearTimeout(copyTimer.current)
    setCopiedText(null)
    const copiedSnapshot = {
      text: compiled.text,
      template,
      project,
      values,
    }
    try {
      await copyText(copiedSnapshot.text)
      if (copyOperation.current !== operation) return
      setCopiedText(copiedSnapshot.text)
      const recent: RecentPrompt = {
        id: `${Date.now()}`,
        title: copiedSnapshot.template.title,
        preview: copiedSnapshot.text.slice(0, 72),
        templateId: copiedSnapshot.template.id,
        projectId: copiedSnapshot.project.id,
        projectName: copiedSnapshot.project.name,
        values: copiedSnapshot.values,
        createdAt: new Date().toISOString(),
      }
      setRecents((current) => [recent, ...current.filter((item) => item.preview !== recent.preview)].slice(0, 6))
      copyTimer.current = window.setTimeout(() => {
        if (copyOperation.current === operation) setCopiedText(null)
      }, 2_000)
    } catch {
      if (copyOperation.current === operation) {
        flash('Clipboard access was unavailable')
      }
    }
  }

  const handleRecent = (recent: RecentPrompt) => {
    dismissNotice()
    const recentTemplate = templates.find((item) => item.id === recent.templateId)
    if (recentTemplate) setTemplate(recentTemplate)
    setValues(recent.values)
    invalidateCopy()
    if (recent.projectId !== project.id) flash(`Loaded from ${recent.projectName}; project values may need replacing`)
  }

  const handleProject = (nextProject: ProjectContext) => {
    setProject(nextProject)
    setProjectDialogOpen(false)
    invalidateCopy()
    flash(
      nextProject.truncated
        ? `${nextProject.name} indexed at the safety cap`
        : `${nextProject.name} indexed locally`,
    )
  }

  const handleClearWorkspace = () => {
    skipNextWorkspaceSave.current = true
    clearWorkspace()
    setTemplate(defaultTemplate)
    setProject(demoProject)
    setValues(initialValuesFor(defaultTemplate, demoProject))
    setRecents([])
    invalidateCopy()
    setProjectDialogOpen(false)
    flash('Saved project data and prompt history cleared')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key === 'Enter') {
        event.preventDefault()
        if (compiled.complete) void handleCopy()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Turbo Prompt home">
          <span className="brand-mark"><ChevronsRight size={20} strokeWidth={2.4} /></span>
          <span className="brand-name">turbo<span>prompt</span></span>
        </a>

        <button className="project-switcher" type="button" onClick={() => setProjectDialogOpen(true)}>
          <span className="project-folder"><FolderGit2 size={17} /></span>
          <span className="project-meta">
            <small>Active project</small>
            <strong>{project.name}</strong>
          </span>
          {project.branch && <span className="branch-label"><GitBranch size={12} />{project.branch}</span>}
          {project.isDemo && <span className="demo-label">Demo</span>}
          <ChevronDown size={14} className="switcher-chevron" />
        </button>

        <div className="topbar-actions">
          <span className="local-badge"><CloudOff size={13} />Local only</span>
          <span className="avatar" aria-label="Local workspace">ET</span>
        </div>
      </header>

      <div className="workspace-grid">
        <TemplateSidebar
          templates={templates}
          selectedId={template.id}
          recents={recents}
          onSelect={handleTemplate}
          onRecent={handleRecent}
          onNew={handleNew}
        />

        <main className="main-workspace">
          <div className="workspace-breadcrumb">
            <span>Prompt workspace</span>
            <span>/</span>
            <strong>{template.shortTitle}</strong>
          </div>
          <PromptComposer
            template={template}
            values={values}
            project={project}
            onChange={handleValue}
            onReset={handleReset}
          />
        </main>

        <InspectorPanel
          compiled={compiled}
          project={project}
          template={template}
          copied={copiedText === compiled.text}
          ready={ready}
          staleCount={staleSlots.length}
          scopeAnchored={Boolean(
            values.target?.origin === 'project' &&
              !template.slots.some(
                (slot) => slot.id === 'target' && isProjectSelectionStale(slot, values.target, project),
              ),
          )}
          verificationExplicit={Boolean(
            values.verification?.value.trim() &&
              !template.slots.some(
                (slot) =>
                  slot.id === 'verification' &&
                  isProjectSelectionStale(slot, values.verification, project),
              ),
          )}
          onCopy={() => void handleCopy()}
        />
      </div>

      <ProjectDialog
        open={projectDialogOpen}
        currentProject={project}
        onClose={() => setProjectDialogOpen(false)}
        onProject={handleProject}
        onClearWorkspace={handleClearWorkspace}
      />

      <div className={`toast${notice ? ' is-visible' : ''}`} role="status" aria-live="polite">
        <span>{notice}</span>
        {undoDraft ? (
          <>
            <button type="button" onClick={handleUndo}>Undo</button>
            <button type="button" onClick={handleDismissUndo}>Dismiss</button>
          </>
        ) : null}
      </div>
    </div>
  )
}
