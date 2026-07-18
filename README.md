# Turbo Prompt

Project-aware prompt completion for coding agents. Turbo Prompt turns a prompt into readable prose with typed, clickable fields: action, target, outcome, context, guardrail, verification, and return format. Each field opens a searchable menu built from the active project plus safe defaults; every choice remains editable and compiles to plain text.

## What works

- Five reusable workflows: implement, fix, review, refactor, test
- Mouse + keyboard picker operation, custom values, source provenance, stale-project copy protection
- Local folder import through the File System Access API, folder upload, or drag-and-drop; bounded and cancellable indexing
- Bounded, fair project analysis: files/directories, shell-safe manifest scripts, stack signals, project instructions, visible cap status
- Exact plain-text preview, revision-safe clipboard feedback, recent prompts, size-capped validated persistence with a clear-data control
- Undo-safe reset/new actions and desktop-to-320 px responsive layouts

Project files remain in the browser. The index skips dependency, Git, build, cache, secret-like, and oversized configuration content. Suggested commands are text - the app never runs project code.

## Run

Requires Node 20.19+.

```sh
npm install
npm run dev
```

Open the shown local URL. The bundled demo is immediately interactive; choose the active project in the top bar to index another folder.

## Verify

```sh
npm run check
npm run test:e2e
```

`check` runs lint, domain/security tests, type-checking, and a production build. Browser tests exercise that production build with the installed `chromiumfish` executable and cover suggestion selection, custom wording, keyboard navigation, delayed clipboard writes, adversarial folder ordering, malformed-draft recovery, stale-project protection, lossless template changes, undo, and layouts from 320-1000 px.

## Design

The core stays independent from React:

- `src/domain/types.ts` - versioned template, slot, suggestion, project-index types
- `src/lib/compilePrompt.ts` - pure template + selections → text + diagnostics
- `src/lib/suggestionEngine.ts` - deterministic providers, filtering, ranking, deduplication
- `src/lib/projectAnalyzer.ts` - bounded, local folder metadata extraction
- `src/data/templates.ts` - built-in prompt workflows; add a template without changing the UI

The app is a static Vite build. It has no server, account, telemetry, model dependency, or agent lock-in.
