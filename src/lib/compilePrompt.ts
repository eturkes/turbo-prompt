import type { CompiledPrompt, PromptSegment, PromptTemplate, PromptValues } from '../domain/types'
import { validateTemplate } from './validateTemplate'

function selectedValue(values: PromptValues, slotId: string): string {
  const value: unknown = values[slotId]?.value
  return typeof value === 'string' ? value.trim() : ''
}

function renderSegments(
  segments: PromptSegment[],
  template: PromptTemplate,
  values: PromptValues,
  showPlaceholders: boolean,
): string {
  return segments
    .map((segment) => {
      if (segment.type === 'text') return segment.value

      if (segment.type === 'optional') {
        const visible = segment.whenFilled.every((slotId) => Boolean(selectedValue(values, slotId)))
        if (!visible) return ''
        return renderSegments(segment.segments, template, values, showPlaceholders)
      }

      const value = selectedValue(values, segment.slotId)
      if (value) return value
      if (!showPlaceholders) return ''
      const slot = template.slots.find((item) => item.id === segment.slotId)
      return `[${slot?.label.toLowerCase() ?? segment.slotId}]`
    })
    .join('')
}

export function compilePrompt(
  template: PromptTemplate,
  values: PromptValues,
  showPlaceholders = true,
): CompiledPrompt {
  const structuralDiagnostics = validateTemplate(template).map((issue) => ({
    slotId: '$template',
    label: 'Template',
    message: `${issue.path}: ${issue.message}`,
  }))
  const slotDiagnostics = template.slots
    .filter((slot) => slot.required && !selectedValue(values, slot.id))
    .map((slot) => ({
      slotId: slot.id,
      label: slot.label,
      message: `${slot.label} is required`,
    }))

  const diagnostics = [...structuralDiagnostics, ...slotDiagnostics]
  const filled = template.slots.filter((slot) => Boolean(selectedValue(values, slot.id))).length

  return {
    text: renderSegments(template.segments, template, values, showPlaceholders).trim(),
    diagnostics,
    filled,
    total: template.slots.length,
    complete: diagnostics.length === 0,
  }
}
