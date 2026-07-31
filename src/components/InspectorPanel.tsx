import { useId, useRef, useState } from 'react'
import {
  Check,
  CheckCircle2,
  Clipboard,
  Code2,
  FileCheck2,
  FileCode2,
  Files,
  FolderTree,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type {
  CompiledPrompt,
  ProjectContext,
  PromptTemplate,
  PromptValues,
} from '../domain/types'
import {
  evidenceProposalStatus,
  type EvidencePackProposal,
  type ProjectEvidencePack,
} from '../lib/evidencePack'
import { relativeTime } from '../lib/promptHistory'

interface InspectorPanelProps {
  compiled: CompiledPrompt
  project: ProjectContext
  template: PromptTemplate
  values: PromptValues
  evidencePack: ProjectEvidencePack | null
  copied: boolean
  ready: boolean
  staleCount: number
  scopeAnchored: boolean
  contextGrounded: boolean
  verificationExplicit: boolean
  onApplyEvidence: (proposals: EvidencePackProposal[]) => void
  onCopy: () => void
}

export function InspectorPanel({
  compiled,
  project,
  template,
  values,
  evidencePack,
  copied,
  ready,
  staleCount,
  scopeAnchored,
  contextGrounded,
  verificationExplicit,
  onApplyEvidence,
  onCopy,
}: InspectorPanelProps) {
  const [tab, setTab] = useState<'preview' | 'context'>('preview')
  const baseId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const words = compiled.text.trim() ? compiled.text.trim().split(/\s+/).length : 0
  const topLanguages = project.languages.slice(0, 3)
  const hasTarget = template.slots.some((slot) => slot.kind === 'target')
  const hasContext = template.slots.some((slot) => slot.kind === 'context')
  const hasVerification = template.slots.some((slot) => slot.kind === 'verification')
  const readinessChecks = [
    ...(hasTarget ? [{ id: 'scope', ready: scopeAnchored, label: 'Scope is anchored to the active project' }] : []),
    {
      id: 'required',
      ready: compiled.complete && staleCount === 0,
      label: staleCount
        ? `${staleCount} project field${staleCount === 1 ? '' : 's'} need replacing`
        : 'All required fields are complete',
    },
    ...(hasContext ? [{ id: 'context', ready: contextGrounded, label: 'Context uses project evidence' }] : []),
    ...(hasVerification ? [{ id: 'verification', ready: verificationExplicit, label: 'Verification path is explicit' }] : []),
  ]
  const readiness = Math.round(
    (readinessChecks.filter((check) => check.ready).length / readinessChecks.length) * 100,
  )
  const evidenceProposals = evidencePack?.proposals.filter((proposal) =>
    template.slots.some((slot) => slot.id === proposal.slotId),
  ) ?? []
  const availableEvidence = evidenceProposals.filter(
    (proposal) => evidenceProposalStatus(values[proposal.slotId], proposal) === 'available',
  )
  const partialReasons = project.partialReasons ?? (project.truncated ? ['limit'] : [])
  const partialIndexLabel = partialReasons.includes('unreadable')
    ? partialReasons.includes('limit')
      ? 'Partial index · cap reached; unreadable paths omitted'
      : 'Partial index · unreadable paths omitted'
    : 'Partial index · safety cap reached'
  const focusContextTab = () => {
    setTab('context')
    window.requestAnimationFrame(() => tabRefs.current[1]?.focus())
  }
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
              <span className="card-kicker">Quality signals</span>
              <strong>{readiness}%</strong>
            </div>
            <progress
              className="readiness-track"
              max={100}
              value={readiness}
              aria-label={`Prompt quality signals: ${readiness}%`}
            />
            <ul className="readiness-list">
              {readinessChecks.map((check) => (
                <li className={check.ready ? 'is-ready' : ''} key={check.id}>
                  {check.ready ? <CheckCircle2 size={15} /> : <span className="empty-check" />}
                  <span className="sr-only">{check.ready ? 'Ready: ' : 'Needs attention: '}</span>
                  <span>{check.label}</span>
                </li>
              ))}
            </ul>
            {hasContext && !contextGrounded && evidencePack ? (
              <button className="readiness-action" type="button" onClick={focusContextTab}>
                Review project evidence
              </button>
            ) : null}
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
            <span><strong>No network uploads.</strong> Project-derived text leaves the browser only when you copy it.</span>
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
              <time className="project-index-age" dateTime={project.indexedAt}>
                Indexed {relativeTime(project.indexedAt)}{relativeTime(project.indexedAt) === 'now' ? '' : ' ago'}
              </time>
              {project.truncated ? (
                <span className="project-index-warning">{partialIndexLabel}</span>
              ) : null}
            </div>
          </section>

          <section className="evidence-pack-section" aria-labelledby={`${baseId}-evidence-title`}>
            <div className="evidence-pack-heading">
              <span className="evidence-pack-icon"><Sparkles size={16} /></span>
              <div>
                <span className="card-kicker">Target-linked evidence</span>
                <h3 id={`${baseId}-evidence-title`}>Project evidence pack</h3>
              </div>
              {evidencePack ? <span className="evidence-pack-count">{evidenceProposals.length}</span> : null}
            </div>

            {evidencePack ? (
              <>
                <p className="evidence-pack-target">Built for <strong>{evidencePack.target}</strong></p>
                {evidencePack.relatedFiles.length ? (
                  <div className="evidence-related-paths" aria-label="Related project paths">
                    {evidencePack.relatedFiles.map((file) => (
                      <span key={file.path} data-kind={file.kind}>
                        <FileCheck2 size={12} />{file.path}
                      </span>
                    ))}
                  </div>
                ) : null}
                <ul className="evidence-proposal-list">
                  {evidenceProposals.map((proposal) => {
                    const current = values[proposal.slotId]
                    const status = evidenceProposalStatus(current, proposal)
                    return (
                      <li key={proposal.slotId}>
                        <div className="evidence-proposal-head">
                          <span>{proposal.label}</span>
                          <button
                            type="button"
                            disabled={status !== 'available'}
                            onClick={() => {
                              onApplyEvidence([proposal])
                              window.requestAnimationFrame(() => tabRefs.current[1]?.focus())
                            }}
                          >
                            {status === 'applied'
                              ? 'Applied'
                              : status === 'protected'
                                ? current?.origin === 'recent' ? 'History kept' : 'Custom kept'
                                : 'Use'}
                          </button>
                        </div>
                        <p>{proposal.selection.value}</p>
                        <small>{proposal.detail} · {proposal.selection.source}</small>
                      </li>
                    )
                  })}
                </ul>
                {availableEvidence.length > 1 ? (
                  <button
                    className="apply-evidence-button"
                    type="button"
                    onClick={() => {
                      onApplyEvidence(availableEvidence)
                      window.requestAnimationFrame(() => tabRefs.current[1]?.focus())
                    }}
                  >
                    Apply {availableEvidence.length} available suggestions
                  </button>
                ) : null}
              </>
            ) : (
              <p className="evidence-pack-empty">
                Choose a path from the active project to discover nearby tests, in-scope guidance, and a recommended check.
              </p>
            )}
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
              <li><Files size={15} /><span>Indexed files</span><strong>{project.fileCount}</strong></li>
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
