import { Check, CircleAlert, RotateCcw, Sparkles } from 'lucide-react'
import type {
  ProjectContext,
  PromptSegment,
  PromptTemplate,
  PromptValues,
  SlotSelection,
} from '../domain/types'
import { isProjectSelectionStale } from '../lib/suggestionEngine'
import { InlineField } from './InlineField'

interface PromptComposerProps {
  template: PromptTemplate
  values: PromptValues
  project: ProjectContext
  onChange: (slotId: string, value: SlotSelection | undefined) => void
  onReset: () => void
}

function segmentsVisible(segments: PromptSegment[], values: PromptValues): PromptSegment[] {
  return segments.flatMap((segment) => {
    if (segment.type !== 'optional') return [segment]
    if (!segment.whenFilled.every((slotId) => values[slotId]?.value.trim())) return []
    return segment.segments
  })
}

export function PromptComposer({ template, values, project, onChange, onReset }: PromptComposerProps) {
  const requiredSlots = template.slots.filter((slot) => slot.required)
  const filled = requiredSlots.filter((slot) => values[slot.id]?.value.trim()).length
  const staleCount = template.slots.filter((slot) =>
    isProjectSelectionStale(slot, values[slot.id], project),
  ).length
  const complete = filled === requiredSlots.length && staleCount === 0
  const hiddenOptionalSlotIds = Array.from(
    new Set(
      template.segments.flatMap((segment) => {
        if (
          segment.type !== 'optional' ||
          segment.whenFilled.every((slotId) => values[slotId]?.value.trim())
        ) return []
        return segment.segments.flatMap((nested) =>
          nested.type === 'slot' ? [nested.slotId] : [],
        )
      }),
    ),
  )

  const renderField = (slotId: string, key: string) => {
    const slot = template.slots.find((item) => item.id === slotId)
    if (!slot) return null
    const selection = values[slot.id]
    return (
      <InlineField
        key={key}
        slot={slot}
        selection={selection}
        project={project}
        stale={isProjectSelectionStale(slot, selection, project)}
        onChange={(next) => onChange(slot.id, next)}
        onClear={() => onChange(slot.id, undefined)}
      />
    )
  }

  return (
    <section className="composer-section" aria-labelledby="composer-title">
      <div className="composer-heading">
        <div>
          <div className="eyebrow"><Sparkles size={13} /> Project-aware composer</div>
          <h1 id="composer-title">Shape the work before the agent starts.</h1>
          <p>Click any highlighted part to swap in a repository-aware suggestion - or write your own.</p>
        </div>
        <button className="quiet-button reset-button" type="button" onClick={onReset}>
          <RotateCcw size={15} />
          Reset
        </button>
      </div>

      <div className="composer-card">
        <header className="composer-card-head">
          <div>
            <span className="card-kicker">Prompt draft</span>
            <span className="draft-state"><span />Local draft</span>
          </div>
          <div className={`completion-badge${complete ? ' is-complete' : ''}`}>
            {complete ? <Check size={13} /> : <CircleAlert size={13} />}
            {staleCount
              ? `${staleCount} stale`
              : `${filled}/${requiredSlots.length} required`}
          </div>
        </header>

        <article className="prompt-canvas" aria-label="Interactive prompt">
          {segmentsVisible(template.segments, values).map((segment, index) => {
            if (segment.type === 'text') return <span key={`text-${index}`}>{segment.value}</span>
            if (segment.type === 'optional') return null
            return renderField(segment.slotId, `${segment.slotId}-${index}`)
          })}
        </article>

        {hiddenOptionalSlotIds.length > 0 && (
          <div className="optional-fields" aria-label="Optional prompt fields">
            <span>Optional details</span>
            {hiddenOptionalSlotIds.map((slotId) =>
              renderField(slotId, `optional-${slotId}`),
            )}
          </div>
        )}

        <footer className="composer-card-foot">
          <div className="field-legend">
            <span><i className="legend-mark project" />Project suggestion</span>
            <span><i className="legend-mark template" />Template suggestion</span>
            <span><i className="legend-mark custom" />Custom wording</span>
          </div>
          <span className="composer-tip"><kbd>Tab</kbd> moves between fields</span>
        </footer>
      </div>
    </section>
  )
}
