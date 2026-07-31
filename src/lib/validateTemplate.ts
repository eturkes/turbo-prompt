import type { PromptSegment, PromptTemplate } from '../domain/types'

export interface TemplateValidationIssue {
  path: string
  message: string
}
export function validateTemplate(template: PromptTemplate): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = []
  const slotIds = new Set<string>()
  const referenced = new Set<string>()
  const referenceGuards = new Map<string, string[][]>()
  const conditions = new Set<string>()
  const projectAwareKinds = new Set(['target', 'context', 'constraint', 'verification'])

  for (const [index, slot] of template.slots.entries()) {
    if (!slot.id.trim()) {
      issues.push({ path: `slots[${index}].id`, message: 'Slot IDs must be non-empty' })
    } else if (slotIds.has(slot.id)) {
      issues.push({ path: `slots[${index}].id`, message: `Duplicate slot ID: ${slot.id}` })
    }
    if (projectAwareKinds.has(slot.kind) && slot.id !== slot.kind) {
      issues.push({
        path: `slots[${index}].id`,
        message: `Project-aware ${slot.kind} slots must use the canonical ID: ${slot.kind}`,
      })
    }
    slotIds.add(slot.id)
  }

  const requiredIds = new Set(
    template.slots.filter((slot) => slot.required).map((slot) => slot.id),
  )

  const visit = (segments: PromptSegment[], path: string, guards: string[] = []) => {
    for (const [index, segment] of segments.entries()) {
      const segmentPath = `${path}[${index}]`
      if (segment.type === 'slot') {
        referenced.add(segment.slotId)
        referenceGuards.set(segment.slotId, [
          ...(referenceGuards.get(segment.slotId) ?? []),
          guards,
        ])
        if (!slotIds.has(segment.slotId)) {
          issues.push({
            path: `${segmentPath}.slotId`,
            message: `Unknown slot reference: ${segment.slotId}`,
          })
        }
      } else if (segment.type === 'optional') {
        for (const slotId of segment.whenFilled) {
          conditions.add(slotId)
          if (!slotIds.has(slotId)) {
            issues.push({
              path: `${segmentPath}.whenFilled`,
              message: `Unknown optional condition: ${slotId}`,
            })
          }
        }
        visit(
          segment.segments,
          `${segmentPath}.segments`,
          [...guards, ...segment.whenFilled],
        )
      }
    }
  }
  visit(template.segments, 'segments')

  for (const slot of template.slots) {
    if (slot.required && !referenced.has(slot.id)) {
      issues.push({ path: `slots.${slot.id}`, message: `Required slot is not rendered: ${slot.id}` })
    } else if (
      slot.required &&
      !referenceGuards.get(slot.id)?.some((guards) =>
        guards.every((condition) => requiredIds.has(condition)),
      )
    ) {
      issues.push({
        path: `slots.${slot.id}`,
        message: `Required slot can be hidden by an optional condition: ${slot.id}`,
      })
    }
  }

  for (const slotId of conditions) {
    if (!referenced.has(slotId)) {
      issues.push({
        path: `slots.${slotId}`,
        message: `Optional condition slot is not rendered: ${slotId}`,
      })
    }
  }

  for (const slotId of Object.keys(template.initialValues)) {
    if (!slotIds.has(slotId)) {
      issues.push({ path: `initialValues.${slotId}`, message: `Initial value targets unknown slot: ${slotId}` })
    }
  }

  return issues
}
