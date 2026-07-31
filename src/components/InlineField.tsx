import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

import type {
  ProjectContext,
  PromptSlot,
  SlotSelection,
} from '../domain/types'
import { SuggestionMenu } from './SuggestionMenu'

export interface InlineFieldProps {
  slot: PromptSlot
  selection: SlotSelection | undefined
  targetSelection: SlotSelection | undefined
  project: ProjectContext
  onChange: (selection: SlotSelection) => void
  onClear?: () => void
  stale?: boolean
}

export function InlineField({
  slot,
  selection,
  targetSelection,
  project,
  onChange,
  onClear,
  stale = false,
}: InlineFieldProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  const [alignRight, setAlignRight] = useState(false)
  const reactId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = `inline-field-${slot.id}-${reactId.replace(/:/g, '')}-menu`
  const isStale = Boolean(selection && stale)

  const returnFocusToTrigger = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const closeAndReturnFocus = useCallback(() => {
    setIsOpen(false)
    returnFocusToTrigger()
  }, [returnFocusToTrigger])

  useEffect(() => {
    if (!isOpen) return

    function handleOutsidePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen || !rootRef.current) return
    const bounds = rootRef.current.getBoundingClientRect()
    setPlacement(
      window.innerHeight - bounds.bottom < 430 && bounds.top > 430 ? 'above' : 'below',
    )
    setAlignRight(bounds.left + 390 > window.innerWidth - 16)
  }, [isOpen])

  const state = isStale ? 'stale' : selection ? 'filled' : 'empty'
  const triggerLabel = selection
    ? `${slot.label}: ${selection.value}. ${
        isStale
          ? 'Selection no longer found in the current project.'
          : `Source: ${selection.source}.`
      } Open suggestions. Press Delete or Backspace to clear.`
    : `${slot.label}: ${slot.placeholder}. Open suggestions.${
        slot.required ? ' Required.' : ''
      }`

  return (
    <span
      ref={rootRef}
      className={[
        'inline-field',
        `inline-field--${state}`,
        isOpen ? 'inline-field--open' : '',
        isOpen ? `inline-field--${placement}` : '',
        alignRight ? 'inline-field--align-right' : '',
        slot.required ? 'inline-field--required' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-kind={slot.kind}
      data-state={state}
      data-origin={selection?.origin ?? 'empty'}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && rootRef.current?.contains(nextTarget)) return
        setIsOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        className="inline-field__trigger"
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-invalid={isStale || undefined}
        title={
          isStale
            ? 'Selection no longer found in the current project'
            : selection
              ? `${selection.value} — ${selection.source}`
              : slot.description
        }
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setIsOpen(true)
          } else if (event.key === 'Escape' && isOpen) {
            event.preventDefault()
            setIsOpen(false)
          } else if (
            selection &&
            onClear &&
            (event.key === 'Delete' || event.key === 'Backspace')
          ) {
            event.preventDefault()
            onClear()
            setIsOpen(false)
          }
        }}
      >
        <span className="inline-field__label">{slot.label}</span>
        <span
          className={selection ? 'inline-field__value' : 'inline-field__placeholder'}
        >
          {selection?.value ?? slot.placeholder}
        </span>
        {selection ? (
          <span className="inline-field__provenance">{selection.source}</span>
        ) : null}
        {selection ? (
          <span className="inline-field__origin">
            {selection.origin === 'project'
              ? 'Project'
              : selection.origin === 'custom'
                ? 'Custom'
                : selection.origin === 'recent'
                  ? 'History'
                  : 'Built in'}
          </span>
        ) : null}
        {isStale ? <span className="inline-field__status">Stale</span> : null}
        <ChevronDown className="inline-field__chevron" aria-hidden="true" size={15} />
      </button>

      {selection && onClear ? (
        <button
          className="inline-field__clear"
          type="button"
          tabIndex={-1}
          aria-label={`Clear ${slot.label.toLocaleLowerCase()} selection`}
          title={`Clear ${slot.label.toLocaleLowerCase()} selection`}
          onClick={(event) => {
            event.stopPropagation()
            onClear()
            setIsOpen(false)
            returnFocusToTrigger()
          }}
        >
          <X aria-hidden="true" size={14} />
        </button>
      ) : null}

      {isOpen ? (
        <span className="inline-field__menu-anchor">
          <SuggestionMenu
            id={menuId}
            slot={slot}
            selection={selection}
            targetSelection={targetSelection}
            project={project}
            onSelect={(nextSelection) => {
              onChange(nextSelection)
              closeAndReturnFocus()
            }}
            onClose={closeAndReturnFocus}
          />
        </span>
      ) : null}
    </span>
  )
}

export default InlineField
