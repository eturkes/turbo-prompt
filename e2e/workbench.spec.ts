import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('composes with project suggestions and custom wording, then copies plain text', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Shape the work before the agent starts.' })).toBeVisible()

  await page.getByRole('button', { name: /^Target:/ }).click()
  const targetSearch = page.getByRole('combobox', { name: 'Search target suggestions' })
  await expect(targetSearch).toBeFocused()
  await targetSearch.fill('projectAnalyzer')
  await targetSearch.press('Enter')
  await expect(page.getByRole('button', { name: /Target: src\/lib\/projectAnalyzer\.ts/ })).toBeVisible()

  await page.getByRole('button', { name: /^Outcome:/ }).click()
  const outcomeSearch = page.getByRole('combobox', { name: 'Search outcome suggestions' })
  await outcomeSearch.fill('Mouse and keyboard completion')
  await outcomeSearch.press('Enter')
  await expect(page.getByRole('button', { name: /Outcome: make every prompt field easy to complete with mouse or keyboard/ })).toBeVisible()

  await page.getByRole('button', { name: /^Guardrail:/ }).click()
  const guardrailSearch = page.getByRole('combobox', { name: 'Search guardrail suggestions' })
  await guardrailSearch.fill('avoid hidden network requests')
  await guardrailSearch.press('Enter')
  await expect(page.getByRole('button', { name: /Guardrail: avoid hidden network requests/ })).toBeVisible()

  const copy = page.locator('.copy-prompt-button')
  await copy.click()
  await expect(copy).toContainText('Copied to clipboard')
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toContain('src/lib/projectAnalyzer.ts')
  expect(clipboard).toContain('make every prompt field easy to complete with mouse or keyboard')
  expect(clipboard).toContain('avoid hidden network requests')
  expect(clipboard).not.toContain('[target]')

  await page.getByRole('button', { name: 'Open prompt history, 1 entry' }).click()
  const history = page.getByRole('dialog', { name: 'Prompt history' })
  await expect(history).toContainText('Implement a feature')
  await expect(history).toContainText('src/lib/projectAnalyzer.ts')
  await history.getByRole('button', { name: 'Close prompt history' }).click()
  await expect(history).toBeHidden()
})

test('supports keyboard picker navigation and project connection dialog', async ({ page }) => {
  const firstField = page.getByRole('button', { name: /^Action:/ })
  await firstField.focus()
  await firstField.press('ArrowDown')
  const actionSearch = page.getByRole('combobox', { name: 'Search action suggestions' })
  await expect(actionSearch).toBeFocused()
  await actionSearch.press('ArrowDown')
  await actionSearch.press('Enter')
  await expect(firstField).toHaveAttribute('aria-expanded', 'false')

  await firstField.focus()
  await firstField.press('Tab')
  const targetField = page.getByRole('button', { name: /^Target:/ })
  await expect(targetField).toBeFocused()
  await targetField.press('Delete')
  await expect(page.getByRole('button', { name: /^Target: Choose file or area/ })).toBeFocused()

  await page.getByRole('button', { name: /^Target:/ }).click()
  const targetSearch = page.getByRole('combobox', { name: 'Search target suggestions' })
  for (let index = 0; index < 12; index += 1) await targetSearch.press('ArrowDown')
  const activeOptionId = await targetSearch.getAttribute('aria-activedescendant')
  expect(activeOptionId).toBeTruthy()
  const activeIsVisible = await page.evaluate((id) => {
    const active = document.getElementById(id!)
    const list = active?.parentElement
    if (!active || !list) return false
    const optionBounds = active.getBoundingClientRect()
    const listBounds = list.getBoundingClientRect()
    return optionBounds.top >= listBounds.top && optionBounds.bottom <= listBounds.bottom
  }, activeOptionId)
  expect(activeIsVisible).toBe(true)
  await targetSearch.press('Escape')

  const previewTab = page.getByRole('tab', { name: 'Preview' })
  await previewTab.focus()
  await previewTab.press('ArrowRight')
  await expect(page.getByRole('tab', { name: /Context/ })).toBeFocused()
  await expect(page.getByRole('tabpanel', { name: /Context/ })).toBeVisible()

  await page.getByRole('button', { name: /Active project turbo-prompt/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Connect a project' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Processed and stored locally')
  await expect(dialog.getByRole('button', { name: 'Choose project folder' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Clear saved data' }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm clear' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Use demo' }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: /Active project turbo-prompt/ }).click()
  await expect(dialog.getByRole('button', { name: 'Clear saved data' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Clear saved data' }).click()
  await dialog.getByRole('button', { name: 'Confirm clear' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem('turbo-prompt:workspace:v1')),
  ).toBeNull()
})

test('keeps the core workflow within a narrow viewport', async ({ page }) => {
  for (const width of [1_000, 920, 901, 850, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.reload()
    await expect(page.getByRole('button', { name: /^Target:/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New prompt' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Implement:/ })).toHaveAccessibleName(/Implement: Turn a product outcome/)
    await expect(page.getByRole('tab', { name: 'Preview' })).toBeVisible()
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    expect(overflows).toBe(false)
    const fieldsStayInComposer = await page.evaluate(() => {
      const desktop = document.querySelector('.prompt-canvas')?.getBoundingClientRect()
      const mobile = document.querySelector('.mobile-prompt-fields')?.getBoundingClientRect()
      const surface = mobile?.width ? mobile : desktop
      const fields = [...document.querySelectorAll('.inline-field__trigger')].filter(
        (field) => field.getBoundingClientRect().width > 0,
      )
      return Boolean(
        surface &&
          fields.every((field) => {
            const bounds = field.getBoundingClientRect()
            return bounds.left >= surface.left - 1 && bounds.right <= surface.right + 1
          }),
      )
    })
    expect(fieldsStayInComposer).toBe(true)

    const mobileAction = page.locator('.mobile-action-bar')
    await expect(mobileAction).toBeVisible()
    const actionBounds = await mobileAction.boundingBox()
    expect(actionBounds?.y).toBeGreaterThanOrEqual(0)
    expect((actionBounds?.y ?? 0) + (actionBounds?.height ?? 0)).toBeLessThanOrEqual(900)

    if (width <= 560) {
      await expect(page.locator('.mobile-prompt-fields')).toBeVisible()
      await expect(page.locator('.prompt-canvas')).toBeHidden()
      const targetValue = page.locator('.mobile-prompt-field .inline-field__value').nth(1)
      expect(await targetValue.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('normal')
      const actionField = page.locator('.mobile-prompt-field .inline-field__trigger').first()
      const actionCenterIsClear = await actionField.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return !document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        )?.closest('.mobile-action-bar')
      })
      expect(actionCenterIsClear).toBe(true)
    }
  }
})

test('builds a target-linked evidence pack without replacing custom wording', async ({ page }) => {
  await page.getByRole('button', { name: /^Guardrail:/ }).click()
  const guardrailSearch = page.getByRole('combobox', { name: 'Search guardrail suggestions' })
  await guardrailSearch.fill('preserve my exact custom guardrail')
  await guardrailSearch.press('Enter')

  await page.getByRole('button', { name: 'Review project evidence' }).click()
  await expect(page.getByRole('tab', { name: /Context/ })).toBeFocused()
  const evidence = page.getByRole('region', { name: 'Project evidence pack' })
  await expect(evidence).toContainText('src/components/PromptComposer.tsx')
  await expect(evidence).toContainText('src/components/InlineField.tsx')

  const guardrailProposal = evidence.locator('li').filter({ hasText: 'In-scope instruction' })
  await expect(guardrailProposal.getByRole('button', { name: 'Custom kept' })).toBeDisabled()

  const contextProposal = evidence.locator('li').filter({ hasText: 'Scope evidence' })
  await contextProposal.getByRole('button', { name: 'Use' }).click()
  await expect(contextProposal.getByRole('button', { name: 'Applied' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Context: the implementation in src\/components\/PromptComposer\.tsx/ })).toBeVisible()

  await page.getByRole('tab', { name: 'Preview' }).click()
  await expect(page.getByRole('progressbar', { name: 'Prompt quality signals: 100%' })).toHaveAttribute('value', '100')
  await expect(page.getByRole('button', { name: /Guardrail: preserve my exact custom guardrail/ })).toBeVisible()

  await page.getByRole('button', { name: /^Target:/ }).click()
  const targetSearch = page.getByRole('combobox', { name: 'Search target suggestions' })
  await targetSearch.fill('projectAnalyzer')
  await targetSearch.press('Enter')
  await expect(page.locator('.completion-badge')).toContainText('stale')
  await expect(page.locator('.copy-prompt-button')).toBeDisabled()

  await page.getByRole('tab', { name: /Context/ }).click()
  await expect(evidence).toContainText('src/lib/projectAnalyzer.ts')
  await evidence.locator('li').filter({ hasText: 'Scope evidence' }).getByRole('button', { name: 'Use' }).click()
  await page.getByRole('tab', { name: 'Preview' }).click()
  await expect(page.locator('.copy-prompt-button')).toBeEnabled()
})

test('uses exact custom wording on Enter without triggering the global copy shortcut', async ({ page }) => {
  await page.addInitScript(() => {
    const writes: string[] = []
    Object.defineProperty(window, '__clipboardWrites', { configurable: true, value: writes })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => { writes.push(value) },
        readText: async () => writes.at(-1) ?? '',
      },
    })
  })
  await page.reload()

  await page.getByRole('button', { name: /^Outcome:/ }).click()
  const outcomeSearch = page.getByRole('combobox', { name: 'Search outcome suggestions' })
  await outcomeSearch.fill('reliable')
  await outcomeSearch.press('Control+Enter')

  await expect(page.getByRole('button', { name: /Outcome: reliable/ })).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { __clipboardWrites: string[] }).__clipboardWrites)).toEqual([])

  await page.keyboard.press('Control+Enter')
  await expect.poll(() => page.evaluate(
    () => (window as typeof window & { __clipboardWrites: string[] }).__clipboardWrites.length,
  )).toBe(1)
})

test('salvages project context and history when a stored workflow is removed', async ({ page }) => {
  await page.waitForFunction(() => window.localStorage.getItem('turbo-prompt:workspace:v1'))
  await page.evaluate(() => {
    const key = 'turbo-prompt:workspace:v1'
    const stored = JSON.parse(window.localStorage.getItem(key)!)
    stored.templateId = 'removed-workflow'
    stored.project.name = 'retained-project'
    stored.recents = [{
      id: 'before-upgrade',
      title: 'Saved before upgrade',
      text: 'Preserve this prompt after a workflow change',
      preview: 'Preserve this prompt after a workflow change',
      templateId: 'implement',
      projectId: stored.project.id,
      projectName: stored.project.name,
      values: stored.values,
      createdAt: '2026-08-01T00:00:00.000Z',
    }]
    window.localStorage.setItem(key, JSON.stringify(stored))
  })
  await page.reload()

  await expect(page.getByRole('button', { name: /Active project retained-project/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Saved before upgrade/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Implement:/ })).toHaveAttribute('aria-current', 'page')
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('turbo-prompt:workspace:v1')!)
    return { templateId: stored.templateId, project: stored.project.name, recents: stored.recents.length }
  })).toEqual({ templateId: 'implement', project: 'retained-project', recents: 1 })
})

test('rejects corrupt persisted state and recovers with safe defaults', async ({ page }) => {
  await page.waitForFunction(() => window.localStorage.getItem('turbo-prompt:workspace:v1'))
  await page.evaluate(() => {
    const key = 'turbo-prompt:workspace:v1'
    const stored = JSON.parse(window.localStorage.getItem(key)!)
    stored.values.action.value = 42
    window.localStorage.setItem(key, JSON.stringify(stored))
  })
  await expect.poll(() =>
    page.evaluate(() => {
      const stored = JSON.parse(window.localStorage.getItem('turbo-prompt:workspace:v1')!)
      return stored.values.action.value
    }),
  ).toBe(42)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Shape the work before the agent starts.' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Action: Implement/ })).toBeVisible()
})

test('blocks stale project values and resolves reset defaults from the active project', async ({ page }) => {
  await page.getByRole('button', { name: /Active project turbo-prompt/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Connect a project' })
  await dialog.locator('.project-folder-input').setInputFiles('e2e/fixtures/imported-app')

  await expect(page.getByRole('button', { name: /Active project imported-app/ })).toBeVisible()
  await expect(page.locator('.completion-badge')).toContainText('stale')
  await expect(page.locator('.copy-prompt-button')).toBeDisabled()

  await page.getByRole('button', { name: /^Fix:/ }).click()
  await expect(page.locator('.copy-prompt-button')).toBeDisabled()
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByRole('button', { name: /Target: main\.ts/ })).toBeVisible()
  await expect(page.locator('.copy-prompt-button')).toBeEnabled()
})

test('applies template defaults without losing custom values hidden by another template', async ({ page }) => {
  await page.getByRole('button', { name: /^Action:/ }).click()
  const actionSearch = page.getByRole('combobox', { name: 'Search action suggestions' })
  await actionSearch.fill('Ship carefully')
  await actionSearch.press('Enter')

  await page.getByRole('button', { name: /^Review:/ }).click()
  await expect(page.getByRole('button', { name: /Outcome: identify correctness, security, and maintainability risks/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Return: prioritized findings with file references and open questions/ })).toBeVisible()

  await page.getByRole('button', { name: /^Implement:/ }).click()
  await expect(page.getByRole('button', { name: /Action: Ship carefully/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Outcome: make every prompt field easy to complete with mouse or keyboard/ })).toBeVisible()
})

test('offers undo after reset or starting a new prompt', async ({ page }) => {
  await page.getByRole('button', { name: /^Outcome:/ }).click()
  const outcomeSearch = page.getByRole('combobox', { name: 'Search outcome suggestions' })
  await outcomeSearch.fill('Respect the operator draft')
  await outcomeSearch.press('Enter')

  await page.getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: 'Undo' }).focus()
  await page.getByRole('button', { name: 'Undo' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Reset' })).toBeFocused()
  await expect(page.getByRole('button', { name: /Outcome: Respect the operator draft/ })).toBeVisible()

  await page.getByRole('button', { name: /^Review:/ }).click()
  await page.getByRole('button', { name: 'New prompt' }).click()
  await page.getByRole('button', { name: 'Undo' }).focus()
  await page.getByRole('button', { name: 'Undo' }).press('Enter')
  await expect(page.getByRole('button', { name: 'New prompt' })).toBeFocused()
  await expect(page.getByRole('button', { name: /^Review:/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: /Outcome: Respect the operator draft/ })).toBeVisible()

  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
  await page.getByRole('button', { name: /^Outcome:/ }).click()
  const nextOutcomeSearch = page.getByRole('combobox', { name: 'Search outcome suggestions' })
  await nextOutcomeSearch.fill('Keep the newer edit')
  await nextOutcomeSearch.press('Enter')
  await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden()

  await page.getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: 'Dismiss' }).focus()
  await page.getByRole('button', { name: 'Dismiss' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Reset' })).toBeFocused()
})

test('does not mark a newer draft copied when an older clipboard write resolves', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            const testWindow = window as typeof window & {
              finishClipboardWrite?: () => void
            }
            testWindow.finishClipboardWrite = resolve
          }),
        readText: async () => '',
      },
    })
  })
  await page.reload()

  await page.locator('.copy-prompt-button').click()
  await expect.poll(() =>
    page.evaluate(() => {
      const testWindow = window as typeof window & {
        finishClipboardWrite?: () => void
      }
      return typeof testWindow.finishClipboardWrite
    }),
  ).toBe('function')

  await page.getByRole('button', { name: /^Outcome:/ }).click()
  const outcomeSearch = page.getByRole('combobox', { name: 'Search outcome suggestions' })
  await outcomeSearch.fill('A newer draft')
  await outcomeSearch.press('Enter')
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      finishClipboardWrite?: () => void
    }
    testWindow.finishClipboardWrite?.()
  })

  await expect(page.locator('.copy-prompt-button')).toContainText('Copy prompt')
  await expect(page.locator('.recent-empty')).toContainText('Copied prompts will appear here')
})

test('reopens an exact historical snapshot and restores it through undo', async ({ page }) => {
  await page.locator('.copy-prompt-button').click()
  await expect(page.getByRole('button', { name: 'Open prompt history, 1 entry' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('turbo-prompt:workspace:v1')!)
    return stored.recents.length
  })).toBe(1)
  await page.evaluate(() => {
    const key = 'turbo-prompt:workspace:v1'
    const stored = JSON.parse(window.localStorage.getItem(key)!)
    stored.recents[0].text = 'Exact prompt copied before this workflow evolved.'
    stored.recents[0].textExact = true
    stored.recents[0].preview = stored.recents[0].text
    stored.recents[0].projectId = 'source-project'
    stored.recents[0].projectName = 'source-project'
    window.localStorage.setItem(key, JSON.stringify(stored))
  })
  await page.reload()

  await page.getByRole('button', { name: 'Open prompt history, 1 entry' }).click()
  await page.locator('.history-entry').click()
  await expect(page.locator('.historical-draft-note')).toContainText('Copied-text snapshot')
  await expect(page.locator('.compiled-prompt')).toHaveText('Exact prompt copied before this workflow evolved.')

  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.locator('.historical-draft-note')).toBeHidden()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('.historical-draft-note')).toBeVisible()
  await expect(page.locator('.compiled-prompt')).toHaveText('Exact prompt copied before this workflow evolved.')

  await page.getByRole('tab', { name: /Context/ }).click()
  await expect(page.getByRole('button', { name: 'History kept' }).first()).toBeDisabled()
  await page.getByRole('tab', { name: 'Preview' }).click()
  await page.locator('.copy-prompt-button').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Exact prompt copied before this workflow evolved.',
  )
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('turbo-prompt:workspace:v1')!)
    return stored.recents[0].projectName
  })).toBe('source-project')
})

test('finds late source files without letting large sibling folders exhaust indexing', async ({ page }) => {
  await page.addInitScript(() => {
    interface FakeFileHandle {
      kind: 'file'
      name: string
      getFile: () => Promise<File>
    }
    interface FakeDirectoryHandle {
      kind: 'directory'
      name: string
      entries: () => AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]>
    }
    const ignoredFile = (name: string): FakeFileHandle => ({
      kind: 'file' as const,
      name,
      getFile: async () => new File([''], name),
    })
    const directory = (
      name: string,
      entries: FakeDirectoryHandle['entries'],
    ): FakeDirectoryHandle => ({ kind: 'directory', name, entries })
    const root = directory('fair-index', async function* () {
      for (let folder = 0; folder < 99; folder += 1) {
        const name = `assets-${folder}`
        yield [
          name,
          directory(name, async function* () {
            for (let file = 0; file < 1_000; file += 1) {
              const fileName = `ignored-${file}.pem`
              yield [fileName, ignoredFile(fileName)]
            }
          }),
        ]
      }
      yield [
        'src',
        directory('src', async function* () {
          for (let file = 0; file < 600; file += 1) {
            const fileName = file === 500 ? 'main.ts' : `ignored-${file}.pem`
            yield [fileName, ignoredFile(fileName)]
          }
        }),
      ]
    })
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => root,
    })
  })
  await page.reload()

  await page.getByRole('button', { name: /Active project turbo-prompt/ }).click()
  await page.getByRole('dialog', { name: 'Connect a project' })
    .getByRole('button', { name: 'Choose project folder' })
    .click()
  await expect(page.getByRole('button', { name: /Active project fair-index/ })).toBeVisible()

  await page.getByRole('button', { name: /^Target:/ }).click()
  await page.getByRole('combobox', { name: 'Search target suggestions' }).fill('src/main.ts')
  await expect(
    page.locator('.suggestion-menu__option[data-origin="project"][title="src/main.ts"]'),
  ).toBeVisible()
})

test('keeps indexing when one project directory is unreadable', async ({ page }) => {
  await page.addInitScript(() => {
    interface FakeFileHandle {
      kind: 'file'
      name: string
      getFile: () => Promise<File>
    }
    interface FakeDirectoryHandle {
      kind: 'directory'
      name: string
      entries: () => AsyncGenerator<[string, FakeFileHandle | FakeDirectoryHandle]>
    }
    const root: FakeDirectoryHandle = {
      kind: 'directory',
      name: 'partial-project',
      entries: async function* () {
        yield ['unreadable', {
          kind: 'directory',
          name: 'unreadable',
          entries: async function* () {
            const noEntries: Array<[string, FakeFileHandle | FakeDirectoryHandle]> = []
            yield* noEntries
            throw new Error('Permission denied')
          },
        }]
        yield ['src', {
          kind: 'directory',
          name: 'src',
          entries: async function* () {
            yield ['main.ts', {
              kind: 'file',
              name: 'main.ts',
              getFile: async () => new File(['export {}'], 'main.ts'),
            }]
          },
        }]
      },
    }
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => root,
    })
  })
  await page.reload()

  await page.getByRole('button', { name: /Active project turbo-prompt/ }).click()
  await page.getByRole('dialog', { name: 'Connect a project' })
    .getByRole('button', { name: 'Choose project folder' })
    .click()

  await expect(page.getByRole('button', { name: /Active project partial-project/ })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('indexed with unreadable paths omitted')
  await page.getByRole('tab', { name: /Context/ }).click()
  await expect(page.getByText('Partial index · unreadable paths omitted')).toBeVisible()
  await page.getByRole('tab', { name: 'Preview' }).click()
  await page.getByRole('button', { name: /^Target:/ }).click()
  await page.getByRole('combobox', { name: 'Search target suggestions' }).fill('src/main.ts')
  await expect(page.locator('.suggestion-menu__option[title="src/main.ts"]')).toBeVisible()
})

test('runs as a host-bound in-progress plugin with mapped project context and theme', async ({ page }) => {
  const pluginUrl = page.url()
  await page.route('**/assets/**', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'access-control-allow-origin': '*' },
    })
  })
  await page.setContent(`
    <!doctype html>
    <html>
      <body style="margin:0">
        <script>
          const contents = {
            'package.json': JSON.stringify({
              name: 'ignored-manifest-name',
              scripts: { check: 'vitest run', dev: 'vite' },
              dependencies: { react: '19.0.0' },
            }),
            'package-lock.json': '{}',
            'AGENTS.md': '- Preserve the embedded project boundary.',
            'src/feature.ts': 'export const embedded = true',
          };
          const tree = [
            { path: 'src', name: 'src', kind: 'directory', depth: 0 },
            ...Object.entries(contents).map(([path, text]) => ({
              path,
              name: path.split('/').at(-1),
              kind: 'file',
              depth: path.includes('/') ? 1 : 0,
              size: text.length,
            })),
          ];
          const iframe = document.createElement('iframe');
          iframe.id = 'plugin';
          iframe.title = 'Turbo Prompt plugin fixture';
          iframe.setAttribute('sandbox', 'allow-scripts');
          iframe.style.cssText = 'display:block;width:100vw;height:100vh;border:0';
          iframe.addEventListener('load', () => {
            const channel = new MessageChannel();
            channel.port1.addEventListener('message', ({ data }) => {
              if (data?.kind !== 'request') return;
              let result;
              if (data.method === 'project.metadata') {
                result = {
                  id: 'embedded-fixture',
                  name: 'Embedded fixture',
                  displayPath: '/projects/embedded-fixture',
                  color: '#67d5b5',
                  branch: 'feature/plugin',
                  available: true,
                };
              } else if (data.method === 'project.tree') {
                result = tree;
              } else if (data.method === 'project.readText') {
                result = {
                  path: data.params.path,
                  text: contents[data.params.path] ?? '',
                  truncated: false,
                };
              } else {
                channel.port1.postMessage({
                  kind: 'response', id: data.id, ok: false, error: 'Unsupported fixture method',
                });
                return;
              }
              channel.port1.postMessage({ kind: 'response', id: data.id, ok: true, result });
            });
            channel.port1.start();
            iframe.contentWindow.postMessage({
              type: 'in-progress:init',
              nonce: 'fixture-nonce',
              context: {
                apiVersion: '1.0',
                capabilities: ['project.metadata', 'project.tree', 'project.readText'],
                project: {
                  id: 'embedded-fixture',
                  name: 'Embedded fixture',
                  color: '#67d5b5',
                  available: true,
                },
                theme: {
                  mode: 'dark',
                  tokens: {
                    background: '#0b0e14',
                    surface: '#121722',
                    surfaceRaised: '#18202c',
                    border: '#283142',
                    text: '#e7ecf4',
                    muted: '#909cb0',
                    accent: '#67d5b5',
                    warning: '#f2b84b',
                    danger: '#ff6b78',
                    uiFont: 'Atkinson Hyperlegible Next',
                    monoFont: 'Iosevka',
                  },
                },
              },
            }, '*', [channel.port2]);
          });
          iframe.src = ${JSON.stringify(pluginUrl)};
          document.body.append(iframe);
        </script>
      </body>
    </html>
  `)

  const plugin = page.frameLocator('#plugin')
  await expect(plugin.getByRole('heading', { name: 'Shape the work before the agent starts.' })).toBeVisible()
  await expect(plugin.getByLabel('Host project: Embedded fixture')).toContainText('feature/plugin')
  await expect(plugin.getByRole('button', { name: /Target: src\/feature\.ts/ })).toBeVisible()
  await expect(plugin.getByRole('button', { name: /Verification: npm run check/ })).toBeVisible()
  await expect(plugin.getByRole('dialog', { name: 'Connect a project' })).toHaveCount(0)
  await expect(plugin.locator('.local-badge')).toContainText('Host-bound · session history')
  expect(await plugin.locator('.brand').evaluate((element) => element.tagName)).toBe('DIV')
  expect(
    await plugin.locator('html').evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--canvas').trim(),
    ),
  ).toBe('#0b0e14')
})
