import { describe, expect, it } from 'vite-plus/test'

import type { ProjectContext, SlotSelection } from '../domain/types'
import {
  applyEvidenceProposals,
  applicableProjectInstructions,
  buildProjectEvidencePack,
  evidenceProposalStatus,
  relatedProjectFiles,
} from './evidencePack'

const project: ProjectContext = {
  schemaVersion: 1,
  id: 'evidence-fixture',
  name: 'evidence-fixture',
  rootLabel: 'evidence-fixture',
  branch: null,
  summary: 'Evidence fixture',
  fileCount: 8,
  files: [
    { path: 'packages/app/src/Button.tsx', kind: 'source' },
    { path: 'packages/app/src/Button.test.tsx', kind: 'test' },
    { path: 'packages/app/src/theme.ts', kind: 'source' },
    { path: 'packages/app/package.json', kind: 'config' },
    { path: 'packages/other/src/Button.tsx', kind: 'source' },
    { path: 'packages/other/src/other.test.ts', kind: 'test' },
    { path: 'AGENTS.md', kind: 'docs' },
    { path: 'packages/app/AGENTS.md', kind: 'docs' },
  ],
  directories: ['packages/app', 'packages/app/src', 'packages/other', 'packages/other/src'],
  languages: [{ name: 'TypeScript', count: 5, color: '#4169e1' }],
  frameworks: ['React'],
  packageManager: 'npm',
  scripts: [
    { name: 'build', command: 'npm run build', source: 'package.json' },
    { name: 'check', command: 'npm run check', source: 'package.json' },
    { name: 'test', command: 'npm run test', source: 'package.json' },
  ],
  instructions: [
    { text: 'Respect the root contract.', source: 'AGENTS.md', scope: '' },
    {
      text: 'Keep app components keyboard accessible.',
      source: 'packages/app/AGENTS.md',
      scope: 'packages/app',
    },
    {
      text: 'Use the other package conventions.',
      source: 'packages/other/AGENTS.md',
      scope: 'packages/other',
    },
  ],
  manifests: ['packages/app/package.json'],
  indexedAt: '2026-08-01T00:00:00.000Z',
  isDemo: false,
}

const target: SlotSelection = {
  id: 'target-button',
  label: 'packages/app/src/Button.tsx',
  value: 'packages/app/src/Button.tsx',
  source: 'Project index',
  origin: 'project',
}

describe('project evidence packs', () => {
  it('ranks adjacent coverage and scoped implementation ahead of other packages', () => {
    const related = relatedProjectFiles(project, target.value)

    expect(related[0]?.path).toBe('packages/app/src/Button.test.tsx')
    expect(related.map((file) => file.path)).toContain('packages/app/src/theme.ts')
    expect(related.map((file) => file.path)).not.toContain('packages/other/src/Button.tsx')
  })

  it('applies nested instructions by target scope with nearest guidance first', () => {
    expect(applicableProjectInstructions(project, target.value)).toEqual([
      expect.objectContaining({ source: 'packages/app/AGENTS.md' }),
      expect.objectContaining({ source: 'AGENTS.md' }),
    ])
    expect(applicableProjectInstructions(project, 'packages/other/src/other.ts')).toEqual([
      expect.objectContaining({ source: 'packages/other/AGENTS.md' }),
      expect.objectContaining({ source: 'AGENTS.md' }),
    ])
    expect(applicableProjectInstructions(project, undefined)).toEqual([
      expect.objectContaining({ source: 'AGENTS.md' }),
    ])
  })

  it('builds traceable context, guardrail, and verification proposals', () => {
    const pack = buildProjectEvidencePack(project, target)

    expect(pack).not.toBeNull()
    expect(pack?.target).toBe(target.value)
    expect(pack?.proposals).toEqual([
      expect.objectContaining({
        slotId: 'context',
        selection: expect.objectContaining({
          origin: 'project',
          value: expect.stringContaining('packages/app/src/Button.test.tsx'),
          source: expect.stringContaining('packages/app/AGENTS.md'),
        }),
      }),
      expect.objectContaining({
        slotId: 'constraint',
        selection: expect.objectContaining({
          value: 'Keep app components keyboard accessible.',
          source: 'packages/app/AGENTS.md',
        }),
      }),
      expect.objectContaining({
        slotId: 'verification',
        selection: expect.objectContaining({ value: 'npm run check' }),
      }),
    ])
    expect(pack?.proposals.every((proposal) => proposal.selection.value.length <= 16_384)).toBe(
      true,
    )
    expect(pack?.proposals.every((proposal) => proposal.selection.source.length <= 4_096)).toBe(
      true,
    )
  })

  it('does not infer project evidence for an unknown custom area', () => {
    expect(buildProjectEvidencePack(project, { ...target, value: 'outside/the/index' })).toBeNull()
  })

  it('builds directory evidence from descendants without crossing package boundaries', () => {
    const pack = buildProjectEvidencePack(project, {
      ...target,
      id: 'target-app-directory',
      value: 'packages/app',
    })

    expect(pack?.relatedFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'packages/app/src/Button.tsx',
        'packages/app/src/Button.test.tsx',
        'packages/app/package.json',
      ]),
    )
    expect(pack?.relatedFiles.some((file) => file.path.startsWith('packages/other/'))).toBe(false)
    expect(pack?.proposals[0]?.selection.value).toContain('packages/app/src/Button.tsx')
  })

  it('isolates service, package, and root modules and avoids substring-only test matches', () => {
    const monorepo: ProjectContext = {
      ...project,
      files: [
        { path: 'services/api/src/User.ts', kind: 'source' },
        { path: 'services/api/src/User.test.ts', kind: 'test' },
        { path: 'services/web/src/User.test.ts', kind: 'test' },
        { path: 'src/User.test.ts', kind: 'test' },
        { path: 'services/api/src/api.ts', kind: 'source' },
        { path: 'services/api/src/rapid.test.ts', kind: 'test' },
        { path: 'services/api/src/users/index.ts', kind: 'source' },
        { path: 'services/api/src/billing/index.test.ts', kind: 'test' },
        { path: 'services/api/package.json', kind: 'config' },
        { path: 'services/web/package.json', kind: 'config' },
      ],
      directories: ['services/api', 'services/api/src', 'services/web', 'services/web/src', 'src'],
      manifests: ['package.json', 'services/api/package.json', 'services/web/package.json'],
      instructions: [],
    }

    expect(
      relatedProjectFiles(monorepo, 'services/api/src/User.ts').map((file) => file.path),
    ).toEqual(expect.arrayContaining(['services/api/src/User.test.ts']))
    expect(
      relatedProjectFiles(monorepo, 'services/api/src/User.ts').map((file) => file.path),
    ).not.toEqual(expect.arrayContaining(['services/web/src/User.test.ts', 'src/User.test.ts']))
    expect(
      relatedProjectFiles(monorepo, 'services/api/src/api.ts').map((file) => file.path),
    ).not.toContain('services/api/src/rapid.test.ts')
    expect(
      relatedProjectFiles(monorepo, 'services/api/src/users/index.ts').map((file) => file.path),
    ).not.toContain('services/api/src/billing/index.test.ts')
  })

  it('never promotes a long-running script as a recommended check', () => {
    const pack = buildProjectEvidencePack(
      {
        ...project,
        scripts: [
          { name: 'dev', command: 'npm run dev', source: 'package.json' },
          { name: 'test:watch', command: 'npm run test:watch', source: 'package.json' },
          { name: 'test:ui', command: 'npm run test:ui', source: 'package.json' },
        ],
      },
      target,
    )

    expect(pack?.proposals.some((proposal) => proposal.slotId === 'verification')).toBe(false)
  })

  it('prefers a terminating check over interactive test scripts', () => {
    const pack = buildProjectEvidencePack(
      {
        ...project,
        scripts: [
          { name: 'test:watch', command: 'npm run test:watch', source: 'package.json' },
          { name: 'build', command: 'npm run build', source: 'package.json' },
        ],
      },
      target,
    )

    expect(
      pack?.proposals.find((proposal) => proposal.slotId === 'verification')?.selection.value,
    ).toBe('npm run build')
  })

  it('uses provenance-aware statuses and protects live custom or history wording', () => {
    const proposals = buildProjectEvidencePack(project, target)!.proposals
    const context = proposals.find((proposal) => proposal.slotId === 'context')!
    const constraint = proposals.find((proposal) => proposal.slotId === 'constraint')!
    const templateEqual = { ...context.selection, origin: 'template' as const }
    const customEqual = { ...constraint.selection, origin: 'custom' as const }
    const recentEqual = { ...context.selection, origin: 'recent' as const }

    expect(evidenceProposalStatus(templateEqual, context)).toBe('available')
    expect(evidenceProposalStatus(customEqual, constraint)).toBe('protected')
    expect(evidenceProposalStatus(recentEqual, context)).toBe('protected')

    const values = { context: templateEqual, constraint: customEqual }
    const applied = applyEvidenceProposals(values, proposals)
    expect(applied.context).toEqual(context.selection)
    expect(applied.constraint).toBe(customEqual)

    const racedValues = { context: { ...context.selection, origin: 'custom' as const } }
    expect(applyEvidenceProposals(racedValues, [context])).toBe(racedValues)
  })

  it('gives equal wording from different scoped sources distinct evidence identities', () => {
    const sharedText = `${'Preserve this long shared contract '.repeat(3)}without exceptions.`
    const scopedProject = {
      ...project,
      instructions: [
        { text: sharedText, source: 'packages/app/AGENTS.md', scope: 'packages/app' },
        { text: sharedText, source: 'packages/other/AGENTS.md', scope: 'packages/other' },
      ],
    }
    const appConstraint = buildProjectEvidencePack(scopedProject, target)!.proposals.find(
      (proposal) => proposal.slotId === 'constraint',
    )!
    const otherConstraint = buildProjectEvidencePack(scopedProject, {
      ...target,
      value: 'packages/other/src/Button.tsx',
    })!.proposals.find((proposal) => proposal.slotId === 'constraint')!

    expect(appConstraint.selection.value).toBe(otherConstraint.selection.value)
    expect(appConstraint.selection.id).not.toBe(otherConstraint.selection.id)
  })
})
