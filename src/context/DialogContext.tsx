import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Button, buttonVariants } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'

export interface ConfirmOptions {
  /** Heading shown above the message. Defaults to “Please confirm”. */
  title?: ReactNode
  /** Body copy explaining what will happen. */
  description?: ReactNode
  /** Label for the confirmation button. Defaults to “Confirm”. */
  confirmLabel?: string
  /** Label for the cancel button. Defaults to “Cancel”. */
  cancelLabel?: string
  /** Style the confirmation button as a dangerous action. Defaults to true. */
  destructive?: boolean
}

export interface AlertOptions {
  /** Heading shown above the message. Defaults to a hidden “Notice”. */
  title?: ReactNode
  /** Body copy shown to the user. */
  description?: ReactNode
  /** Label for the dismissal button. Defaults to “OK”. */
  confirmLabel?: string
}

export interface PromptOptions {
  /** Heading shown above the input. */
  title?: ReactNode
  /** Body copy shown above the input. */
  description?: ReactNode
  /** Accessible label for the text input. */
  label?: string
  /** Initial value of the input. */
  defaultValue?: string
  /** Placeholder for the input. */
  placeholder?: string
  /** Label for the submit button. Defaults to “OK”. */
  confirmLabel?: string
  /** Label for the cancel button. Defaults to “Cancel”. */
  cancelLabel?: string
}

type DialogRequest =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'alert'; options: AlertOptions; resolve: () => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

interface QueuedDialog {
  id: number
  settled: boolean
  request: DialogRequest
}

interface DialogsApi {
  /** Opens a shadcn/ui AlertDialog asking the user to confirm. Resolves true when confirmed. */
  confirm(options: ConfirmOptions | string): Promise<boolean>
  /** Opens a shadcn/ui AlertDialog with a single acknowledgement button. Resolves once dismissed. */
  alert(options: AlertOptions | string): Promise<void>
  /** Opens a shadcn/ui Dialog with a text input. Resolves the entered value, or null when cancelled. */
  prompt(options: PromptOptions | string): Promise<string | null>
}

const DialogsContext = createContext<DialogsApi | null>(null)

let nextDialogId = 0

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedDialog[]>([])
  const [promptValue, setPromptValue] = useState('')

  const active = queue[0] ?? null

  const enqueue = useCallback((request: DialogRequest) => {
    setQueue((current) => [...current, { id: ++nextDialogId, settled: false, request }])
  }, [])

  /** Resolves the dialog promise exactly once and advances the queue. */
  const settle = useCallback((dialog: QueuedDialog, resolve: () => void) => {
    if (dialog.settled) return
    dialog.settled = true
    resolve()
    setQueue((current) => (current[0] === dialog ? current.slice(1) : current.filter((item) => item !== dialog)))
  }, [])

  const api = useMemo<DialogsApi>(
    () => ({
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          enqueue({
            kind: 'confirm',
            options: typeof options === 'string' ? { description: options } : options,
            resolve,
          })
        }),
      alert: (options) =>
        new Promise<void>((resolve) => {
          enqueue({
            kind: 'alert',
            options: typeof options === 'string' ? { description: options } : options,
            resolve,
          })
        }),
      prompt: (options) =>
        new Promise<string | null>((resolve) => {
          enqueue({
            kind: 'prompt',
            options: typeof options === 'string' ? { title: options } : options,
            resolve,
          })
        }),
    }),
    [enqueue],
  )

  // Seed the input whenever a prompt becomes the active dialog.
  useEffect(() => {
    if (active?.request.kind === 'prompt') setPromptValue(active.request.options.defaultValue ?? '')
  }, [active])

  function renderActiveDialog() {
    if (!active) return null
    const { request } = active

    if (request.kind === 'confirm') {
      const { options } = request
      const destructive = options.destructive !== false
      return (
        <AlertDialog
          key={active.id}
          open
          onOpenChange={(open) => {
            if (!open) settle(active, () => request.resolve(false))
          }}
        >
          <AlertDialogContent variant={destructive ? 'destructive' : 'default'} className="max-w-md">
            <div className="flex items-start gap-3">
              {destructive ? (
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              ) : null}
              <div className="grid min-w-0 gap-2">
                <AlertDialogTitle>{options.title ?? 'Please confirm'}</AlertDialogTitle>
                <AlertDialogDescription className="text-left">
                  {options.description ?? 'Are you sure you want to continue?'}
                </AlertDialogDescription>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{options.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
              <AlertDialogAction variant={destructive ? 'destructive' : 'default'} onClick={() => settle(active, () => request.resolve(true))}>
                {options.confirmLabel ?? 'Confirm'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )
    }

    if (request.kind === 'alert') {
      const { options } = request
      return (
        <AlertDialog
          key={active.id}
          open
          onOpenChange={(open) => {
            if (!open) settle(active, () => request.resolve())
          }}
        >
          <AlertDialogContent className="max-w-md">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              <div className="grid min-w-0 gap-2">
                <AlertDialogTitle className={options.title ? '' : 'sr-only'}>
                  {options.title ?? 'Notice'}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-left">{options.description ?? ''}</AlertDialogDescription>
              </div>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className={buttonVariants()}>{options.confirmLabel ?? 'OK'}</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )
    }

    const { options } = request
    return (
      <Dialog
        key={active.id}
        open
        onOpenChange={(open) => {
          if (!open) settle(active, () => request.resolve(null))
        }}
      >
        <DialogContent className="max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              settle(active, () => request.resolve(promptValue))
            }}
          >
            <DialogHeader>
              <DialogTitle>{options.title ?? 'Input required'}</DialogTitle>
              {options.description ? (
                <DialogDescription className="text-left">{options.description}</DialogDescription>
              ) : null}
            </DialogHeader>
            <div className="mt-4">
              {options.label ? (
                <label htmlFor="dialogs-prompt-input" className="mb-1.5 block text-sm font-medium text-ink-800">
                  {options.label}
                </label>
              ) : null}
              <Input
                id="dialogs-prompt-input"
                autoFocus
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                placeholder={options.placeholder}
              />
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => settle(active, () => request.resolve(null))}>
                {options.cancelLabel ?? 'Cancel'}
              </Button>
              <Button type="submit">{options.confirmLabel ?? 'OK'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <DialogsContext.Provider value={api}>
      {children}
      {renderActiveDialog()}
    </DialogsContext.Provider>
  )
}

export function useDialogs(): DialogsApi {
  const context = useContext(DialogsContext)
  if (!context) throw new Error('useDialogs must be used within a <DialogProvider>')
  return context
}
