# Project memory

- Product = local-first prompt workbench. Typed inline slots compile to portable plain text for any coding agent.
- Repository content is untrusted display data. Analysis stays in-browser; suggestions expose provenance; commands are copied, never executed.
- Manifest script suggestions accept shell-safe names only. Folder traversal rotates across directories, retains high-signal paths within hard caps, and marks partial indexes.
- Stack = React + TypeScript + Vite; pure domain modules isolate templates, compilation, project analysis, ranking.
- Project switch preserves draft wording; missing project-bound selections become stale and block copy. Template switches preserve operator/project choices but refresh built-in defaults; hidden template fields stay parked. Reset/new actions expose undo.
- Persisted metadata is runtime-validated before render and clearable in the project dialog. Writes prune oldest recents to stay reloadable; the active draft wins.
- Clipboard success is bound to a draft revision/operation token; edits invalidate pending feedback and history insertion.
