import { Bug, FlaskConical, History, Layers3, Plus, Search, Sparkles } from 'lucide-react'
import type { PromptTemplate, RecentPrompt } from '../domain/types'
import { relativeTime } from '../lib/promptHistory'

const templateIcons = {
  spark: Sparkles,
  bug: Bug,
  search: Search,
  layers: Layers3,
  flask: FlaskConical,
} as const

interface TemplateSidebarProps {
  templates: PromptTemplate[]
  selectedId: string
  recents: RecentPrompt[]
  onSelect: (template: PromptTemplate) => void
  onRecent: (recent: RecentPrompt) => void
  onNew: () => void
}

export function TemplateSidebar({
  templates,
  selectedId,
  recents,
  onSelect,
  onRecent,
  onNew,
}: TemplateSidebarProps) {
  return (
    <aside className="template-sidebar" aria-label="Prompt templates">
      <div className="sidebar-head">
        <span>Workspace</span>
      </div>

      <button className="new-prompt-button" type="button" onClick={onNew} aria-label="New prompt">
        <Plus size={17} strokeWidth={2.2} />
        <span>New prompt</span>
      </button>

      <div className="sidebar-section">
        <div className="sidebar-label">
          <span>Templates</span>
          <span>{templates.length}</span>
        </div>
        <nav className="template-list" aria-label="Available templates">
          {templates.map((template) => {
            const Icon = templateIcons[template.icon]
            const selected = template.id === selectedId
            return (
              <button
                className={`template-item${selected ? ' is-active' : ''}`}
                type="button"
                key={template.id}
                onClick={() => onSelect(template)}
                aria-label={`${template.shortTitle}: ${template.description}`}
                aria-current={selected ? 'page' : undefined}
              >
                <span className="template-icon">
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{template.shortTitle}</strong>
                  <small>{template.description}</small>
                </span>
              </button>
            )
          })}
        </nav>
      </div>

      <div className="sidebar-section recent-section">
        <div className="sidebar-label">
          <span>Recent prompts</span>
          <History size={14} />
        </div>
        {recents.length ? (
          <div className="recent-list">
            {recents.slice(0, 3).map((recent) => (
              <button
                type="button"
                className="recent-item"
                key={recent.id}
                onClick={() => onRecent(recent)}
              >
                <span>{recent.title}</span>
                <small>
                  {recent.projectName} · {recent.preview}
                </small>
                <time dateTime={recent.createdAt}>{relativeTime(recent.createdAt)}</time>
              </button>
            ))}
          </div>
        ) : (
          <div className="recent-empty">Copied prompts will appear here.</div>
        )}
      </div>

      <div className="sidebar-foot">
        <div className="shortcut-hint">
          <span className="status-dot" />
          Local workspace
        </div>
        <span className="version-mark">v0.2</span>
      </div>
    </aside>
  )
}
