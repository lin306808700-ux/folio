import React from 'react'

interface PageShellProps {
  title: string
  description?: React.ReactNode
  count?: React.ReactNode
  actions?: React.ReactNode
  toolbar?: React.ReactNode
  children: React.ReactNode
  contentClassName?: string
}

export function PageShell({
  title,
  description,
  count,
  actions,
  toolbar,
  children,
  contentClassName = '',
}: PageShellProps) {
  return (
    <section className="relative z-10 flex h-full min-w-0 flex-col text-text-secondary">
      <header className="shrink-0 border-b border-border-subtle/50 px-6 pb-4 pt-5">
        <div className="flex min-h-10 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
              {count !== undefined && <span className="text-xs text-text-faint">{count}</span>}
            </div>
            {description && <div className="mt-1 text-xs text-text-muted">{description}</div>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
        {toolbar && <div className="mt-4 flex min-w-0 items-center gap-3">{toolbar}</div>}
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto px-6 py-5 scroll-container ${contentClassName}`}>
        {children}
      </div>
    </section>
  )
}

export default PageShell
