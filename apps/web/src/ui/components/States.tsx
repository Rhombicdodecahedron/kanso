import Link from 'next/link';

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: { label: string; href?: string; onClick?: () => void } }) {
  return (
    <div className="state">
      <p className="state-title">{title}</p>
      {body ? <p className="state-body">{body}</p> : null}
      {action ? (
        action.href ? (
          <Link className="btn btn-primary" href={action.href}>
            {action.label}
          </Link>
        ) : (
          <button className="btn btn-primary" onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state">
      <p className="state-title">Could not load this</p>
      <p className="state-body state-error">{message}</p>
      {onRetry ? (
        <button className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
