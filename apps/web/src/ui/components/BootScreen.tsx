export function BootScreen({ error, retry = true }: { error?: string; retry?: boolean }) {
  return (
    <main className="boot">
      <div className="boot-mark" aria-hidden="true">
        간
      </div>
      {error ? (
        <>
          <p className="boot-error">{error}</p>
          {retry ? (
            <button className="btn btn-secondary" onClick={() => location.reload()}>
              Try again
            </button>
          ) : null}
        </>
      ) : (
        <p className="boot-hint">Opening your library</p>
      )}
    </main>
  );
}
