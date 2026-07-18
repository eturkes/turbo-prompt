import type { PromptSegment, PromptTemplate } from '../domain/types'

export interface TemplateValidationIssue {
  path: string
  message: string
}
export function validateTemplate(template: PromptTemplate): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = []
  const slotIds = new Set<string>()
  const referenced = new Set<string>()

  for (const [index, slot] of template.slots.entries()) {
    if (!slot.id.trim()) {
      issues.push({ path: `slots[${index}].id`, message: 'Slot IDs must be non-empty' })
    } else if (slotIds.has(slot.id)) {
      issues.push({ path: `slots[${index}].id`, message: `Duplicate slot ID: ${slot.id}` })
    }
    slotIds.add(slot.id)
  }

  const visit = (segments: PromptSegment[], path: string) => {
    for (const [index, segment] of segments.entries()) {
      const segmentPath = `${path}[${index}]`
      if (segment.type === 'slot') {
        referenced.add(segment.slotId)
        if (!slotIds.has(segment.slotId)) {
          issues.push({
            path: `${segmentPath}.slotId`,
            message: `Unknown slot reference: ${segment.slotId}`,
          })
        }
      } else if (segment.type === 'optional') {
        for (const slotId of segment.whenFilled) {
          if (!slotIds.has(slotId)) {
            issues.push({
              path: `${segmentPath}.whenFilled`,
              message: `Unknown optional condition: ${slotId}`,
            })
          }
        }
        visit(segment.segments, `${segmentPath}.segments`)
      }
    }
  }
  visit(template.segments, 'segments')

  for (const slot of template.slots) {
    if (slot.required && !referenced.has(slot.id)) {
      issues.push({ path: `slots.${slot.id}`, message: `Required slot is not rendered: ${slot.id}` })
    }
  }

  for (const slotId of Object.keys(template.initialValues)) {
    if (!slotIds.has(slotId)) {
      issues.push({ path: `initialValues.${slotId}`, message: `Initial value targets unknown slot: ${slotId}` })
    }
  }

  return issues
}
