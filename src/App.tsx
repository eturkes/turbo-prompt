import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronsRight,
  Clipboard,
  CloudOff,
  FolderGit2,
  GitBranch,
  History,
} from 'lucide-react'
import { HistoryDialog } from './components/HistoryDialog'
import { InspectorPanel } from './components/InspectorPanel'
import { ProjectDialog } from './components/ProjectDialog'
import { PromptComposer } from './components/PromptComposer'
import { TemplateSidebar } from './components/TemplateSidebar'
import { demoProject } from './data/demoProject'
import { defaultTemplate, templates } from './data/templates'
import {
  MAX_SELECTION_SOURCE_LENGTH,
  type ProjectContext,
  type PromptTemplate,
  type PromptValues,
  type RecentPrompt,
  type SlotSelection,
} from './domain/types'
import { compilePrompt } from './lib/compilePrompt'
import {
  buildProjectEvidencePack,
  applyEvidenceProposals,
  evidenceProposalStatus,
  type EvidencePackProposal,
} from './lib/evidencePack'
import {
  initialValuesFor,
  isProjectSelectionStale,
} from './lib/suggestionEngine'
import { promptFingerprint } from './lib/promptHistory'
import { clearWorkspace, fitWorkspaceRecents, loadWorkspace, saveWorkspace } from './lib/storage'

export interface AppProps {
  embeddedProject?: ProjectContext
}

function initialWorkspace(embeddedProject: ProjectContext | undefined) {
  const stored = embeddedProject ? null : loadWorkspace()
  const storedTemplate = templates.find((template) => template.id === stored?.templateId)
  const template = storedTemplate ?? defaultTemplate
  const project = embeddedProject ?? stored?.project ?? demoProject
  const values =
    storedTemplate && stored?.values
      ? stored.values
      : initialValuesFor(template, project)
  return { template, project, values, recents: stored?.recents ?? [] }
}

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

export default function App({ embeddedProject }: AppProps) {
  const embedded = embeddedProject !== undefined
  const [startup] = useState(() => initialWorkspace(embeddedProject))
  const [template, setTemplate] = useState<PromptTemplate>(startup.template)
  const [values, setValues] = useState<PromptValues>(startup.values)
  const [project, setProject] = useState<ProjectContext>(startup.project)
  const [recents, setRecents] = useState<RecentPrompt[]>(startup.recents)
  const [projectDialogOpen, setProjectDialogOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historicalText, setHistoricalText] = useState<string | null>(null)
  const [restoredProject, setRestoredProject] = useState<{ id: string; name: string } | null>(null)
  const [copiedText, setCopiedText] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [undoDraft, setUndoDraft] = useState<{
    template: PromptTemplate
    values: PromptValues
    historicalText: string | null
    restoredProject: { id: string; name: string } | null
  } | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  const copyTimer = useRef<number | undefined>(undefined)
  const copyOperation = useRef(0)
  const undoReturnFocus = useRef<HTMLElement | null>(null)
  const skipNextWorkspaceSave = useRef(false)
  const liveCompiled = useMemo(() => compilePrompt(template, values), [template, values])
  const compiled = useMemo(
    () => historicalText !== null
      ? {
          ...liveCompiled,
          text: historicalText,
          diagnostics: [],
          filled: liveCompiled.total,
          complete: true,
        }
      : liveCompiled,
    [historicalText, liveCompiled],
  )
  const evidencePack = useMemo(
    () => buildProjectEvidencePack(project, values.target),
    [project, values.target],
  )
  const staleSlots = useMemo(
    () =>
      template.slots.filter((slot) =>
        isProjectSelectionStale(slot, values[slot.id], project, values.target),
      ),
    [project, template.slots, values],
  )
  const ready = compiled.complete && staleSlots.length === 0
  const persistableRecents = useMemo(
    () => fitWorkspaceRecents({
      schemaVersion: 1,
      templateId: template.id,
      values,
      project,
      recents,
    }),
    [project, recents, template.id, values],
  )

  useEffect(() => {
    if (embedded) return
    if (skipNextWorkspaceSave.current) {
      skipNextWorkspaceSave.current = false
      return
    }
    saveWorkspace({
      schemaVersion: 1,
      templateId: template.id,
      values,
      project,
      recents: persistableRecents,
    })
  }, [embedded, persistableRecents, project, template.id, values])

  useEffect(() => () => {
    window.clearTimeout(noticeTimer.current)
    window.clearTimeout(copyTimer.current)
    copyOperation.current += 1
  }, [])

  const flash = (
    message: string,
    undo?: {
      template: PromptTemplate
      values: PromptValues
      historicalText: string | null
      restoredProject: { id: string; name: string } | null
    },
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
    setHistoricalText(null)
    setRestoredProject(null)
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
    const previousDraft = { template, values, historicalText, restoredProject }
    undoReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTemplate(defaultTemplate)
    setHistoricalText(null)
    setRestoredProject(null)
    setValues(initialValuesFor(defaultTemplate, project))
    invalidateCopy()
    flash('New prompt ready', previousDraft)
  }

  const handleReset = () => {
    const previousDraft = { template, values, historicalText, restoredProject }
    undoReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setValues(initialValuesFor(template, project))
    setHistoricalText(null)
    setRestoredProject(null)
    invalidateCopy()
    flash('Prompt reset', previousDraft)
  }

  const handleUndo = () => {
    if (!undoDraft) return
    const returnFocus = undoReturnFocus.current
    window.clearTimeout(noticeTimer.current)
    setTemplate(undoDraft.template)
    setValues(undoDraft.values)
    setHistoricalText(undoDraft.historicalText)
    setRestoredProject(undoDraft.restoredProject)
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
    setHistoricalText(null)
    setRestoredProject(null)
    setValues((current) => ({ ...current, [slotId]: value }))
    invalidateCopy()
  }

  const handleApplyEvidence = (proposals: EvidencePackProposal[]) => {
    const slotIds = new Set(template.slots.map((slot) => slot.id))
    const applicable = proposals.filter(
      (proposal) =>
        slotIds.has(proposal.slotId) &&
        evidenceProposalStatus(values[proposal.slotId], proposal) === 'available',
    )
    if (!applicable.length) return

    const previousDraft = { template, values, historicalText, restoredProject }
    undoReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setHistoricalText(null)
    setRestoredProject(null)
    setValues((current) => applyEvidenceProposals(current, applicable, slotIds))
    invalidateCopy()
    flash(
      applicable.length === 1
        ? `${applicable[0]!.label} applied`
        : `${applicable.length} project evidence suggestions applied`,
      previousDraft,
    )
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
      restoredProject,
      values,
    }
    try {
      await copyText(copiedSnapshot.text)
      if (copyOperation.current !== operation) return
      setCopiedText(copiedSnapshot.text)
      const fingerprint = promptFingerprint(copiedSnapshot.text)
      const recent: RecentPrompt = {
        id: `${Date.now()}-${fingerprint}`,
        fingerprint,
        title: copiedSnapshot.template.title,
        text: copiedSnapshot.text,
        textExact: true,
        preview: copiedSnapshot.text.slice(0, 72),
        templateId: copiedSnapshot.template.id,
        projectId: copiedSnapshot.restoredProject?.id ?? copiedSnapshot.project.id,
        projectName: copiedSnapshot.restoredProject?.name ?? copiedSnapshot.project.name,
        values: copiedSnapshot.values,
        createdAt: new Date().toISOString(),
      }
      const nextRecents = [
        recent,
        ...recents.filter((item) => item.text !== recent.text),
      ].slice(0, 20)
      setRecents(nextRecents)
      if (embedded || !saveWorkspace({
        schemaVersion: 1,
        templateId: copiedSnapshot.template.id,
        values: copiedSnapshot.values,
        project: copiedSnapshot.project,
        recents: nextRecents,
      })) {
        flash('Copied; history is available for this session only')
      }
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
    if (!recentTemplate) {
      flash('That prompt uses a workflow that is no longer available')
      return
    }
    const recentValues: PromptValues = Object.fromEntries(
      Object.entries(recent.values).map(([slotId, selection]) => [
        slotId,
        selection
          ? {
              ...selection,
              source: (selection.origin === 'recent'
                ? selection.source
                : `Prompt history · ${selection.source}`
              ).slice(0, MAX_SELECTION_SOURCE_LENGTH),
              origin: 'recent' as const,
            }
          : selection,
      ]),
    )
    const restoredFromValues = compilePrompt(recentTemplate, recent.values).text
    const workflowHasChanged = recent.textExact && restoredFromValues !== recent.text
    setTemplate(recentTemplate)
    setValues(recentValues)
    setHistoricalText(workflowHasChanged ? recent.text : null)
    setRestoredProject({ id: recent.projectId, name: recent.projectName })
    invalidateCopy()
    if (!recent.textExact) {
      flash('Loaded legacy history from saved fields; wording may differ from the original copy')
    } else if (workflowHasChanged) {
      flash('Loaded the exact copied text; editing a field updates it to the current workflow')
    } else if (recent.projectId !== project.id) {
      flash(`Loaded from ${recent.projectName}; saved wording is protected`)
    }
  }

  const handleProject = (nextProject: ProjectContext) => {
    setProject(nextProject)
    setProjectDialogOpen(false)
    invalidateCopy()
    flash(
      nextProject.truncated
        ? nextProject.partialReasons?.includes('unreadable')
          ? nextProject.partialReasons.includes('limit')
            ? `${nextProject.name} indexed partially; cap reached and unreadable paths omitted`
            : `${nextProject.name} indexed with unreadable paths omitted`
          : `${nextProject.name} indexed at the safety cap`
        : `${nextProject.name} indexed locally`,
    )
  }

  const handleClearWorkspace = () => {
    const storageCleared = clearWorkspace()
    skipNextWorkspaceSave.current = storageCleared
    setTemplate(defaultTemplate)
    setProject(demoProject)
    setValues(initialValuesFor(defaultTemplate, demoProject))
    setRecents([])
    setHistoricalText(null)
    setRestoredProject(null)
    invalidateCopy()
    setProjectDialogOpen(false)
    flash(
      storageCleared
        ? 'Saved project data and prompt history cleared'
        : 'Workspace reset; browser storage could not confirm deletion',
    )
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select, [contenteditable="true"]') ||
          target.closest('dialog'))
      ) return
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key === 'Enter') {
        event.preventDefault()
        if (compiled.complete) void handleCopy()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const projectIdentity = (
    <>
      <span className="project-folder"><FolderGit2 size={17} /></span>
      <span className="project-meta">
        <small>{embedded ? 'Host project' : 'Active project'}</small>
        <strong>{project.name}</strong>
      </span>
      {project.branch && <span className="branch-label"><GitBranch size={12} />{project.branch}</span>}
      {project.isDemo && <span className="demo-label">Demo</span>}
      {!embedded && <ChevronDown size={14} className="switcher-chevron" />}
    </>
  )

  const brand = (
    <>
      <span className="brand-mark"><ChevronsRight size={20} strokeWidth={2.4} /></span>
      <span className="brand-name">turbo<span>prompt</span></span>
    </>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        {embedded ? (
          <div className="brand" aria-label="Turbo Prompt home">{brand}</div>
        ) : (
          <a className="brand" href="/" aria-label="Turbo Prompt home">{brand}</a>
        )}

        {embedded ? (
          <div className="project-switcher is-host-bound" aria-label={`Host project: ${project.name}`}>
            {projectIdentity}
          </div>
        ) : (
          <button className="project-switcher" type="button" onClick={() => setProjectDialogOpen(true)}>
            {projectIdentity}
          </button>
        )}

        <div className="topbar-actions">
          <button
            className="icon-button history-trigger"
            type="button"
            aria-label={`Open prompt history, ${persistableRecents.length} ${persistableRecents.length === 1 ? 'entry' : 'entries'}`}
            onClick={() => setHistoryOpen(true)}
          >
            <History size={17} />
            {persistableRecents.length ? <span>{persistableRecents.length}</span> : null}
          </button>
          <span className="local-badge">
            <CloudOff size={13} />{embedded ? 'Host-bound · session history' : 'Local only'}
          </span>
        </div>
      </header>

      <div className="workspace-grid">
        <TemplateSidebar
          templates={templates}
          selectedId={template.id}
          recents={persistableRecents}
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
          {historicalText !== null ? (
            <div className="historical-draft-note" role="status">
              <History size={15} aria-hidden="true" />
              <span><strong>Copied-text snapshot.</strong> Preview and copy preserve the original; editing a field adopts the current workflow.</span>
            </div>
          ) : null}
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
          values={values}
          evidencePack={evidencePack}
          copied={copiedText === compiled.text}
          ready={ready}
          staleCount={staleSlots.length}
          scopeAnchored={Boolean(
            values.target?.origin === 'project' &&
              !template.slots.some(
                (slot) => slot.id === 'target' && isProjectSelectionStale(slot, values.target, project, values.target),
              ),
          )}
          contextGrounded={Boolean(
            values.context?.origin === 'project' &&
              !template.slots.some(
                (slot) => slot.id === 'context' && isProjectSelectionStale(slot, values.context, project, values.target),
              ),
          )}
          verificationExplicit={Boolean(
            values.verification?.value.trim() &&
              !template.slots.some(
                (slot) =>
                  slot.id === 'verification' &&
                  isProjectSelectionStale(slot, values.verification, project, values.target),
              ),
          )}
          onApplyEvidence={handleApplyEvidence}
          onCopy={() => void handleCopy()}
        />
      </div>

      <div className="mobile-action-bar" aria-label="Prompt copy action">
        <div>
          <strong>{ready ? 'Ready to copy' : 'Prompt needs attention'}</strong>
          <span>
            {ready
              ? `${compiled.text.trim().split(/\s+/).length} words · local plain text`
              : staleSlots.length
                ? `${staleSlots.length} stale project field${staleSlots.length === 1 ? '' : 's'}`
                : `${compiled.diagnostics.length} required field${compiled.diagnostics.length === 1 ? '' : 's'} left`}
          </span>
        </div>
        <button type="button" onClick={() => void handleCopy()} disabled={!ready}>
          {copiedText === compiled.text ? <Check size={18} /> : <Clipboard size={18} />}
          {copiedText === compiled.text ? 'Copied' : 'Copy prompt'}
        </button>
      </div>

      {!embedded ? (
        <ProjectDialog
          open={projectDialogOpen}
          currentProject={project}
          onClose={() => setProjectDialogOpen(false)}
          onProject={handleProject}
          onClearWorkspace={handleClearWorkspace}
        />
      ) : null}

      <HistoryDialog
        open={historyOpen}
        recents={persistableRecents}
        onClose={() => setHistoryOpen(false)}
        onSelect={handleRecent}
        onDelete={(recent) => setRecents((current) => current.filter((item) => item.id !== recent.id))}
        onClear={() => setRecents([])}
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
