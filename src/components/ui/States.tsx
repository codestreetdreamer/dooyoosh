import type { ReactNode } from "react";

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h2 className="text-3xl">{title}</h2>
      {children ? <div className="mt-3 text-muted">{children}</div> : null}
      {action ? <div className="mt-8">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="mx-auto max-w-md border border-line bg-surface px-6 py-10 text-center">
      <h2 className="text-2xl">{title}</h2>
      {children ? <div className="mt-3 text-muted">{children}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-3 text-sm text-muted">
      <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-taupe border-t-ink" />
      {label}
    </span>
  );
}

export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="aspect-[4/5] animate-pulse bg-line" />
          <div className="mt-3 h-4 w-2/3 animate-pulse bg-line" />
          <div className="mt-2 h-4 w-1/3 animate-pulse bg-line" />
        </div>
      ))}
    </div>
  );
}
