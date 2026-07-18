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
    const fieldsStayInCanvas = await page.evaluate(() => {
      const canvas = document.querySelector('.prompt-canvas')?.getBoundingClientRect()
      const fields = [...document.querySelectorAll('.inline-field__trigger')]
      return Boolean(
        canvas &&
          fields.every((field) => field.getBoundingClientRect().right <= canvas.right + 1),
      )
    })
    expect(fieldsStayInCanvas).toBe(true)
  }
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
