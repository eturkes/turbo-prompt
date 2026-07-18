import { useId, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  FileCode2,
  Files,
  FolderTree,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
} from 'lucide-react'
import type { CompiledPrompt, ProjectContext, PromptTemplate } from '../domain/types'

interface InspectorPanelProps {
  compiled: CompiledPrompt
  project: ProjectContext
  template: PromptTemplate
  copied: boolean
  ready: boolean
  staleCount: number
  scopeAnchored: boolean
  verificationExplicit: boolean
  onCopy: () => void
}

export function InspectorPanel({
  compiled,
  project,
  template,
  copied,
  ready,
  staleCount,
  scopeAnchored,
  verificationExplicit,
  onCopy,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<'preview' | 'context'>('preview')
  const baseId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const words = compiled.text.trim() ? compiled.text.trim().split(/\s+/).length : 0
  const topLanguages = project.languages.slice(0, 3)
  const readinessChecks = [scopeAnchored, compiled.complete && staleCount === 0, verificationExplicit]
  const readiness = Math.round(
    (readinessChecks.filter(Boolean).length / readinessChecks.length) * 100,
  )
  const selectTabFromKey = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + 2) % 2
    const nextTab = nextIndex === 0 ? 'preview' : 'context'
    setTab(nextTab)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <aside className="inspector-panel" aria-label="Prompt inspector">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector view">
        <button
          ref={(element) => { tabRefs.current[0] = element }}
          type="button"
          role="tab"
          id={`${baseId}-preview-tab`}
          aria-controls={`${baseId}-preview-panel`}
          aria-selected={tab === 'preview'}
          tabIndex={tab === 'preview' ? 0 : -1}
          className={tab === 'preview' ? 'is-active' : ''}
          onClick={() => setTab('preview')}
          onKeyDown={(event) => selectTabFromKey(event, 0)}
        >
          Preview
        </button>
        <button
          ref={(element) => { tabRefs.current[1] = element }}
          type="button"
          role="tab"
          id={`${baseId}-context-tab`}
          aria-controls={`${baseId}-context-panel`}
          aria-selected={tab === 'context'}
          tabIndex={tab === 'context' ? 0 : -1}
          className={tab === 'context' ? 'is-active' : ''}
          onClick={() => setTab('context')}
          onKeyDown={(event) => selectTabFromKey(event, 1)}
        >
          Context
          <span>{project.fileCount}</span>
        </button>
      </div>

      {tab === 'preview' ? (
        <div
          className="inspector-content"
          role="tabpanel"
          id={`${baseId}-preview-panel`}
          aria-labelledby={`${baseId}-preview-tab`}
        >
          <section className="preview-block">
            <div className="panel-section-head">
              <div>
                <span className="card-kicker">Compiled output</span>
                <small>Plain text · any coding agent</small>
              </div>
              <span className="word-count">{words} words</span>
            </div>
            <div className="compiled-prompt">{compiled.text}</div>
          </section>

          <section className="readiness-block">
            <div className="panel-section-head">
              <span className="card-kicker">Prompt readiness</span>
              <strong>{readiness}%</strong>
            </div>
            <div className="readiness-track"><span style={{ width: `${readiness}%` }} /></div>
            <ul className="readiness-list">
              <li className={scopeAnchored ? 'is-ready' : ''}>
                {scopeAnchored ? <CheckCircle2 size={15} /> : <span className="empty-check" />}
                <span>Scope is anchored to the active project</span>
              </li>
              <li className={compiled.complete && staleCount === 0 ? 'is-ready' : ''}>
                {compiled.complete && staleCount === 0 ? <CheckCircle2 size={15} /> : <span className="empty-check" />}
                <span>{staleCount ? `${staleCount} project field${staleCount === 1 ? '' : 's'} need replacing` : 'All required fields are complete'}</span>
              </li>
              <li className={verificationExplicit ? 'is-ready' : ''}>
                {verificationExplicit ? <CheckCircle2 size={15} /> : <span className="empty-check" />}
                <span>Verification path is explicit</span>
              </li>
            </ul>
          </section>

          <button className="copy-prompt-button" type="button" onClick={onCopy} disabled={!ready}>
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
            <span>{copied ? 'Copied to clipboard' : 'Copy prompt'}</span>
            {!copied && <kbd>Ctrl/⌘ ↵</kbd>}
          </button>
          {!ready && (
            <p className="copy-disabled-note">
              {staleCount
                ? `Replace ${staleCount} stale project field${staleCount === 1 ? '' : 's'} to copy.`
                : `Complete ${compiled.diagnostics.length} required field${compiled.diagnostics.length === 1 ? '' : 's'} to copy.`}
            </p>
          )}

          <div className="privacy-note">
            <ShieldCheck size={16} />
            <span><strong>Local by design.</strong> Project data never leaves this browser.</span>
          </div>
        </div>
      ) : (
        <div
          className="inspector-content context-view"
          role="tabpanel"
          id={`${baseId}-context-panel`}
          aria-labelledby={`${baseId}-context-tab`}
        >
          <section className="project-summary-card">
            <div className="project-summary-icon"><FolderTree size={20} /></div>
            <div>
              <span className="card-kicker">Active project</span>
              <h2>{project.name}</h2>
              <p>{project.summary}</p>
              {project.truncated ? (
                <span className="project-index-warning">Partial index · safety cap reached</span>
              ) : null}
            </div>
          </section>

          <section className="context-section">
            <div className="panel-section-head"><span className="card-kicker">Detected stack</span></div>
            <div className="stack-pills">
              {project.frameworks.map((framework) => <span key={framework}><Code2 size={13} />{framework}</span>)}
              {topLanguages.map((language) => <span key={language.name}><i style={{ background: language.color }} />{language.name}</span>)}
              {project.packageManager && <span><PackageCheck size={13} />{project.packageManager}</span>}
            </div>
          </section>

          <section className="context-section">
            <div className="panel-section-head"><span className="card-kicker">Suggestion sources</span></div>
            <ul className="source-list">
              <li><Files size={15} /><span>Files and directories</span><strong>{project.fileCount}{project.truncated ? '+' : ''}</strong></li>
              <li><FileCode2 size={15} /><span>Project manifests</span><strong>{project.manifests.length}</strong></li>
              <li><PackageCheck size={15} /><span>Runnable scripts</span><strong>{project.scripts.length}</strong></li>
              <li><LockKeyhole size={15} /><span>Local instructions</span><strong>{project.instructions.length}</strong></li>
            </ul>
          </section>

          <section className="context-section active-template">
            <span className="card-kicker">Active template</span>
            <h3>{template.title}</h3>
            <p>{template.description}</p>
          </section>
        </div>
      )}
    </aside>
  )
}
