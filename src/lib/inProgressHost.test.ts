import { describe, expect, it } from 'vitest'

import {
  loadInProgressProject,
  type InProgressHostClient,
} from './inProgressHost'

describe('in-progress project adapter', () => {
  it('derives a host-bound project while serializing bounded text reads', async () => {
    const contents: Record<string, string> = {
      'package.json': JSON.stringify({
        name: 'manifest-name',
        scripts: { check: 'vitest run', dev: 'vite' },
        dependencies: { react: '19.0.0' },
      }),
      'AGENTS.md': '- Preserve the configured project boundary.',
      'src/AGENTS.md': '- Keep source changes focused and verified.',
      'src/main.tsx': 'export const main = true',
    }
    const tree = [
      { path: 'src', name: 'src', kind: 'directory', depth: 0 },
      ...Object.entries(contents).map(([path, text]) => ({
        path,
        name: path.split('/').at(-1)!,
        kind: 'file',
        depth: path.includes('/') ? 1 : 0,
        size: text.length,
      })),
      { path: 'package-lock.json', name: 'package-lock.json', kind: 'file', depth: 0, size: 2 },
    ]
    let activeReads = 0
    let maximumActiveReads = 0
    const statuses: string[] = []
    const host = {
      context: { project: { id: 'host-project' } },
      async call(method: string, params?: { path?: string }) {
        if (method === 'project.metadata') {
          return {
            id: 'host-project',
            name: 'Host project',
            displayPath: '/projects/host-project',
            color: '#67d5b5',
            branch: 'feature/embedded',
            available: true,
          }
        }
        if (method === 'project.tree') return tree
        if (method === 'project.readText' && params?.path) {
          activeReads += 1
          maximumActiveReads = Math.max(maximumActiveReads, activeReads)
          await Promise.resolve()
          activeReads -= 1
          return { path: params.path, text: contents[params.path] ?? '{}', truncated: false }
        }
        throw new Error(`Unexpected method: ${method}`)
      },
      setStatus(status: { state: string }) {
        statuses.push(status.state)
      },
    } as unknown as InProgressHostClient

    const result = await loadInProgressProject(host)

    expect(maximumActiveReads).toBe(1)
    expect(statuses).toEqual(['busy', 'idle'])
    expect(result).toMatchObject({
      id: 'in-progress:host-project',
      name: 'Host project',
      rootLabel: '/projects/host-project',
      branch: 'feature/embedded',
      isDemo: false,
      packageManager: 'npm',
      scripts: [
        { name: 'check', command: 'npm run check' },
        { name: 'dev', command: 'npm run dev' },
      ],
      instructions: [
        { text: 'Preserve the configured project boundary.', source: 'AGENTS.md', scope: '' },
        {
          text: 'Keep source changes focused and verified.',
          source: 'src/AGENTS.md',
          scope: 'src',
        },
      ],
    })
    expect(result.summary).toContain('indexed locally through the in-progress host')
  })

  it('fails closed when required host metadata is unavailable', async () => {
    const statuses: string[] = []
    const host = {
      context: { project: { id: 'missing' } },
      async call(method: string) {
        if (method === 'project.metadata') {
          return {
            id: 'missing',
            name: 'Missing project',
            displayPath: '/missing',
            color: '#67d5b5',
            branch: null,
            available: false,
          }
        }
        if (method === 'project.tree') return []
        throw new Error(`Unexpected method: ${method}`)
      },
      setStatus(status: { state: string }) {
        statuses.push(status.state)
      },
    } as unknown as InProgressHostClient

    await expect(loadInProgressProject(host)).rejects.toThrow('Missing project is unavailable')
    expect(statuses).toEqual(['busy', 'error'])
  })
})
