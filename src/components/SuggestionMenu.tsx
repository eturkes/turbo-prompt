import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Search, X } from 'lucide-react'

import {
  MAX_SELECTION_VALUE_LENGTH,
  type ProjectContext,
  type PromptSlot,
  type SlotSelection,
  type Suggestion,
  type SuggestionOrigin,
} from '../domain/types'
import { customSuggestion, getSuggestions, toSelection } from '../lib/suggestionEngine'

const originLabels: Record<SuggestionOrigin, string> = {
  project: 'Project',
  template: 'Built in',
  recent: 'Recent',
  custom: 'Custom',
}

export interface SuggestionMenuProps {
  id: string
  slot: PromptSlot
  selection: SlotSelection | undefined
  targetSelection: SlotSelection | undefined
  project: ProjectContext
  onSelect: (selection: SlotSelection) => void
  onClose: () => void
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

export function SuggestionMenu({
  id,
  slot,
  selection,
  targetSelection,
  project,
  onSelect,
  onClose,
}: SuggestionMenuProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLSpanElement | null>>([])

  const options = useMemo(() => {
    const suggestions = getSuggestions(slot, project, query, targetSelection)
    const customValue = query.trim()

    if (
      !customValue ||
      suggestions.some(
        (suggestion) =>
          normalized(suggestion.value) === normalized(customValue) ||
          normalized(suggestion.label) === normalized(customValue),
      )
    ) {
      return suggestions
    }

    const custom = customSuggestion(slot, customValue)
    return slot.kind === 'target' ? [...suggestions, custom] : [custom, ...suggestions]
  }, [project, query, slot, targetSelection])

  const effectiveActiveIndex = options.length ? Math.min(activeIndex, options.length - 1) : -1
  const activeOptionId =
    effectiveActiveIndex >= 0 ? `${id}-option-${effectiveActiveIndex}` : undefined

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (effectiveActiveIndex < 0) return
    optionRefs.current[effectiveActiveIndex]?.scrollIntoView({ block: 'nearest' })
  }, [effectiveActiveIndex])

  function moveActive(delta: number) {
    setActiveIndex((current) => {
      if (!options.length) return 0
      const boundedCurrent = Math.min(current, options.length - 1)
      return (boundedCurrent + delta + options.length) % options.length
    })
  }

  function choose(suggestion: Suggestion) {
    onSelect(toSelection(suggestion))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveActive(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveActive(-1)
        break
      case 'Enter': {
        const activeOption = options[effectiveActiveIndex]
        if (!activeOption) return
        event.preventDefault()
        choose(activeOption)
        break
      }
      case 'Escape':
        event.preventDefault()
        onClose()
        break
    }
  }

  return (
    <span className="suggestion-menu" data-slot-kind={slot.kind}>
      <span className="suggestion-menu__header">
        <Search className="suggestion-menu__search-icon" aria-hidden="true" size={16} />
        <input
          ref={inputRef}
          className="suggestion-menu__input"
          type="text"
          role="combobox"
          aria-label={`Search ${slot.label.toLocaleLowerCase()} suggestions`}
          aria-describedby={`${id}-description ${id}-results-count`}
          aria-autocomplete="list"
          aria-controls={id}
          aria-expanded="true"
          aria-required={slot.required}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          maxLength={MAX_SELECTION_VALUE_LENGTH}
          placeholder={`Search ${slot.label.toLocaleLowerCase()}…`}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="suggestion-menu__close"
          type="button"
          aria-label={`Close ${slot.label.toLocaleLowerCase()} suggestions`}
          onClick={onClose}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </span>

      <span id={`${id}-description`} className="suggestion-menu__description">
        {slot.description}
      </span>
      <span
        id={`${id}-results-count`}
        className="suggestion-menu__results-count"
        aria-live="polite"
      >
        {options.length} {options.length === 1 ? 'suggestion' : 'suggestions'}
      </span>

      <span
        id={id}
        className="suggestion-menu__list"
        role="listbox"
        aria-label={`${slot.label} suggestions`}
      >
        {options.map((suggestion, index) => {
          const isActive = index === effectiveActiveIndex
          const isSelected = Boolean(
            selection &&
            selection.origin === suggestion.origin &&
            selection.value === suggestion.value &&
            selection.source === suggestion.source,
          )

          return (
            <span
              ref={(element) => {
                optionRefs.current[index] = element
              }}
              id={`${id}-option-${index}`}
              key={`${suggestion.origin}-${suggestion.id}-${index}`}
              className={[
                'suggestion-menu__option',
                isActive ? 'suggestion-menu__option--active' : '',
                isSelected ? 'suggestion-menu__option--selected' : '',
                suggestion.origin === 'custom' ? 'suggestion-menu__option--custom' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="option"
              aria-selected={isSelected}
              title={suggestion.value}
              data-active={isActive || undefined}
              data-origin={suggestion.origin}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(suggestion)}
            >
              <span className="suggestion-menu__option-main">
                <span className="suggestion-menu__option-label">{suggestion.label}</span>
                <span className="suggestion-menu__option-origin" data-origin={suggestion.origin}>
                  {originLabels[suggestion.origin]}
                </span>
              </span>
              <span className="suggestion-menu__option-meta">
                <span className="suggestion-menu__option-detail">
                  {suggestion.label === suggestion.value ? suggestion.detail : suggestion.value}
                </span>
                <span className="suggestion-menu__option-source">{suggestion.source}</span>
              </span>
              {isSelected ? (
                <Check className="suggestion-menu__option-check" aria-hidden="true" size={16} />
              ) : null}
            </span>
          )
        })}

        {!options.length ? (
          <span className="suggestion-menu__empty" role="presentation">
            No matching suggestions. Type a custom value to continue.
          </span>
        ) : null}
      </span>

      <span className="suggestion-menu__footer" aria-hidden="true">
        <span>↑↓ Navigate</span>
        <span>Enter Choose</span>
        <span>Esc Close</span>
      </span>
    </span>
  )
}

export default SuggestionMenu
