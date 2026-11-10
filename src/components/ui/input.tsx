import * as React from 'react'

import { cn } from '../../lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 w-full min-w-0 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink-800 outline-none transition-colors placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
