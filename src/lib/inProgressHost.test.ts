import { describe, expect, it } from 'vite-plus/test'

import { loadInProgressProject, type InProgressHostClient } from './inProgressHost'

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

  it('preserves the first directory of repository-relative host paths', async () => {
    const contents: Record<string, string> = {
      'src/package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      'src/AGENTS.md': '- Keep source changes scoped and verified.',
      'src/main.ts': 'export const main = true',
    }
    const reads: string[] = []
    const host = {
      context: { project: { id: 'source-only' } },
      async call(method: string, params?: { path?: string }) {
        if (method === 'project.metadata') {
          return {
            id: 'source-only',
            name: 'Source-only project',
            displayPath: '/projects/source-only',
            color: '#67d5b5',
            branch: 'main',
            available: true,
          }
        }
        if (method === 'project.tree') {
          return Object.entries(contents).map(([path, text]) => ({
            path,
            name: path.split('/').at(-1)!,
            kind: 'file',
            depth: 1,
            size: text.length,
          }))
        }
        if (method === 'project.readText' && params?.path) {
          reads.push(params.path)
          return { path: params.path, text: contents[params.path]!, truncated: false }
        }
        throw new Error(`Unexpected method: ${method}`)
      },
      setStatus() {},
    } as unknown as InProgressHostClient

    const result = await loadInProgressProject(host)

    expect(reads).toEqual(['src/AGENTS.md'])
    expect(result.files).toContainEqual({ path: 'src/main.ts', kind: 'source' })
    expect(result.files).not.toContainEqual({ path: 'main.ts', kind: 'source' })
    expect(result.instructions).toEqual([
      {
        text: 'Keep source changes scoped and verified.',
        source: 'src/AGENTS.md',
        scope: 'src',
      },
    ])
    expect(result.scripts).toEqual([])
    expect(result.manifests).toContain('src/package.json')
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
