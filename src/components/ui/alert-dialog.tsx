import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'
import { buttonVariants } from './button'

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal

function AlertDialogOverlay({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-dialog-overlay-in data-[state=closed]:animate-dialog-overlay-out',
        className,
      )}
      {...props}
    />
  )
}

const alertDialogContentVariants = cva(
  'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-line bg-surface p-6 shadow-2xl outline-none data-[state=open]:animate-dialog-content-in data-[state=closed]:animate-dialog-content-out',
  {
    variants: {
      variant: {
        default: '',
        destructive: 'border-rose-200 dark:border-rose-900/60',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function AlertDialogContent({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & VariantProps<typeof alertDialogContentVariants>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(alertDialogContentVariants({ variant }), className)}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-dialog-header" className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn('text-lg font-semibold text-ink-950 dark:text-slate-100', className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, children, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  // Rendered as a <div> (not the Radix default <p>) because descriptions may
  // contain block-level JSX such as lists or nested paragraphs.
  return (
    <AlertDialogPrimitive.Description asChild {...props}>
      <div data-slot="alert-dialog-description" className={cn('text-sm text-ink-600', className)}>
        {children}
      </div>
    </AlertDialogPrimitive.Description>
  )
}

function AlertDialogAction({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & VariantProps<typeof buttonVariants>) {
  return (
    <AlertDialogPrimitive.Action className={cn(buttonVariants({ variant }), className)} {...props} />
  )
}

function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: 'outline' }), className)} {...props} />
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
