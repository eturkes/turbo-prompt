import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { Clock3, History, Trash2, X } from 'lucide-react'

import type { RecentPrompt } from '../domain/types'
import { relativeTime } from '../lib/promptHistory'

interface HistoryDialogProps {
  open: boolean
  recents: RecentPrompt[]
  onClose: () => void
  onSelect: (recent: RecentPrompt) => void
  onDelete: (recent: RecentPrompt) => void
  onClear: () => void
}

export function HistoryDialog({
  open,
  recents,
  onClose,
  onSelect,
  onDelete,
  onClear,
}: HistoryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const deleteRefs = useRef<Array<HTMLButtonElement | null>>([])
  const titleId = useId()
  const descriptionId = useId()
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog) return

    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    closeRef.current?.focus()

    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      previouslyFocused?.focus()
    }
  }, [open])

  if (!open) return null

  const closeHistory = () => {
    setConfirmClear(false)
    onClose()
  }

  const handleBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      closeHistory()
  }

  return (
    <dialog
      className="history-dialog"
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        closeHistory()
      }}
      onClick={handleBackdrop}
    >
      <div className="history-dialog-panel">
        <header className="history-dialog-header">
          <span className="history-dialog-icon" aria-hidden="true">
            <History size={20} />
          </span>
          <div>
            <h2 id={titleId}>Prompt history</h2>
            <p id={descriptionId}>
              Reopen local copied prompts; persistence depends on browser storage. Legacy entries
              restore saved fields.
            </p>
          </div>
          <button
            className="icon-button"
            ref={closeRef}
            type="button"
            aria-label="Close prompt history"
            onClick={closeHistory}
          >
            <X size={18} />
          </button>
        </header>

        {recents.length ? (
          <ul className="history-list">
            {recents.map((recent, index) => (
              <li key={recent.id}>
                <button
                  className="history-entry"
                  type="button"
                  onClick={() => {
                    onSelect(recent)
                    closeHistory()
                  }}
                >
                  <span className="history-entry-title">
                    <strong>{recent.title}</strong>
                    <time dateTime={recent.createdAt}>
                      <Clock3 size={12} />
                      {relativeTime(recent.createdAt)}
                    </time>
                  </span>
                  <span className="history-entry-preview">{recent.preview}</span>
                  <small>{recent.projectName}</small>
                </button>
                <button
                  className="history-delete"
                  ref={(element) => {
                    deleteRefs.current[index] = element
                  }}
                  type="button"
                  aria-label={`Delete ${recent.title} for ${recent.projectName}: ${recent.preview}`}
                  onClick={() => {
                    onDelete(recent)
                    requestAnimationFrame(() => {
                      const nextIndex = Math.min(index, recents.length - 2)
                      const nextDelete = deleteRefs.current[nextIndex]
                      if (nextDelete?.isConnected) nextDelete.focus()
                      else closeRef.current?.focus()
                    })
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="history-empty">
            <History size={24} />
            <h3>No copied prompts yet</h3>
            <p>Copy a finished prompt and it will appear here for quick reuse.</p>
          </div>
        )}

        <footer className="history-dialog-footer">
          <span>
            {recents.length} prompt{recents.length === 1 ? '' : 's'} in history · local only
          </span>
          {recents.length ? (
            <button
              className={confirmClear ? 'is-confirming' : ''}
              type="button"
              onClick={() => {
                if (confirmClear) {
                  onClear()
                  setConfirmClear(false)
                  requestAnimationFrame(() => closeRef.current?.focus())
                } else setConfirmClear(true)
              }}
            >
              <Trash2 size={14} />
              {confirmClear ? 'Confirm clear' : 'Clear history'}
            </button>
          ) : null}
        </footer>
      </div>
    </dialog>
  )
}
