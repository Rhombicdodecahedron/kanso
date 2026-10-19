'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { Sheet } from './Sheet';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirm: string;
  danger?: boolean;
}
interface Toast {
  text: string;
  action?: { label: string; onClick: () => void };
}
interface Feedback {
  confirm(o: ConfirmOptions): Promise<boolean>;
  toast(t: Toast): void;
}

const Ctx = createContext<Feedback | null>(null);

/** Confirmations and short notices (the web counterpart of the iPhone's alerts and snackbar). */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), []);
  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), t.action ? 6000 : 3500);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };

  return (
    <Ctx.Provider value={{ confirm, toast: showToast }}>
      {children}
      <Sheet
        open={!!ask}
        onClose={() => answer(false)}
        title={ask?.title ?? ''}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => answer(false)}>
              Cancel
            </button>
            <button className={`btn ${ask?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)} autoFocus>
              {ask?.confirm}
            </button>
          </>
        }
      >
        {ask?.body ? <p className="muted">{ask.body}</p> : null}
      </Sheet>
      <div className="toast-region" aria-live="polite">
        {toast ? (
          <div className="toast">
            <span>{toast.text}</span>
            {toast.action ? (
              <button
                className="toast-action"
                onClick={() => {
                  toast.action!.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Ctx.Provider>
  );
}

export function useFeedback(): Feedback {
  const f = useContext(Ctx);
  if (!f) throw new Error('useFeedback must be used inside FeedbackProvider.');
  return f;
}
