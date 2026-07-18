import { describe, expect, it } from 'vitest'

import type {
  PromptTemplate,
  PromptValues,
  SlotSelection,
} from '../domain/types'
import { compilePrompt } from './compilePrompt'
import { templates } from '../data/templates'
import { validateTemplate } from './validateTemplate'

const template: PromptTemplate = {
  schemaVersion: 1,
  id: 'compiler-fixture',
  title: 'Compiler fixture',
  shortTitle: 'Compile',
  description: 'Exercises required and optional prompt segments.',
  icon: 'spark',
  slots: [
    {
      id: 'action',
      kind: 'action',
      label: 'Action',
      placeholder: 'Choose action',
      required: true,
      description: 'The requested action',
    },
    {
      id: 'verification',
      kind: 'verification',
      label: 'Verification',
      placeholder: 'Choose verification',
      required: false,
      description: 'An optional verification command',
    },
  ],
  segments: [
    { type: 'text', value: 'Please ' },
    { type: 'slot', slotId: 'action' },
    {
      type: 'optional',
      whenFilled: ['verification'],
      segments: [
        { type: 'text', value: '. Verify with ' },
        { type: 'slot', slotId: 'verification' },
      ],
    },
    { type: 'text', value: '.' },
  ],
  initialValues: {},
}

function selection(
  id: string,
  value: string,
  origin: SlotSelection['origin'] = 'template',
): SlotSelection {
  return {
    id,
    label: value.trim(),
    value,
    source: 'Test fixture',
    origin,
  }
}

describe('compilePrompt', () => {
  it('accepts every registered built-in template', () => {
    for (const registered of templates) expect(validateTemplate(registered)).toEqual([])
  })

  it('reports required slots and renders a useful placeholder', () => {
    const result = compilePrompt(template, {})

    expect(result).toEqual({
      text: 'Please [action].',
      diagnostics: [
        {
          slotId: 'action',
          label: 'Action',
          message: 'Action is required',
        },
      ],
      filled: 0,
      total: 2,
      complete: false,
    })
    expect(compilePrompt(template, {}, false).text).toBe('Please .')
  })

  it('includes optional text only when all of its controlling values are filled', () => {
    const actionOnly: PromptValues = {
      action: selection('implement', '  Implement the feature  '),
      verification: selection('blank-verification', '   '),
    }

    expect(compilePrompt(template, actionOnly)).toMatchObject({
      text: 'Please Implement the feature.',
      diagnostics: [],
      filled: 1,
      complete: true,
    })

    const withVerification: PromptValues = {
      ...actionOnly,
      verification: selection('npm-test', '  npm test  ', 'project'),
    }

    expect(compilePrompt(template, withVerification)).toMatchObject({
      text: 'Please Implement the feature. Verify with npm test.',
      diagnostics: [],
      filled: 2,
      complete: true,
    })
  })

  it('fails closed when a template contains unknown slot references', () => {
    const invalid: PromptTemplate = {
      ...template,
      segments: [
        { type: 'text', value: 'Please ' },
        { type: 'slot', slotId: 'missing' },
      ],
    }

    const result = compilePrompt(invalid, {
      action: selection('implement', 'Implement'),
    })

    expect(result.complete).toBe(false)
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: '$template',
          message: expect.stringContaining('Unknown slot reference: missing'),
        }),
        expect.objectContaining({
          slotId: '$template',
          message: expect.stringContaining('Required slot is not rendered: action'),
        }),
      ]),
    )
  })

  it('treats malformed runtime selection values as unresolved instead of throwing', () => {
    const malformed = {
      action: { ...selection('bad', 'bad'), value: 42 },
    } as unknown as PromptValues

    expect(compilePrompt(template, malformed)).toMatchObject({
      complete: false,
      text: 'Please [action].',
    })
  })
})
