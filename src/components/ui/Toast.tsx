import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon, SparkIcon } from '../icons';

export type ToastTone = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** ms before auto-dismiss; default 5000. */
  durationMs?: number;
}

interface ToastRecord {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  durationMs: number;
  leaving: boolean;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_ICON: Record<ToastTone, ReactNode> = {
  default: <SparkIcon size={16} />,
  success: <CheckIcon size={16} />,
  error: <AlertIcon size={16} />,
  warning: <AlertIcon size={16} />,
  info: <InfoIcon size={16} />,
};

/** Access app-wide toasts: `const { toast } = useToast();` */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

const DEFAULT_DURATION = 5000;
/** Grace period after hover-leave before a hovered toast auto-dismisses. */
const RESUME_DELAY = 900;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const beginExit = useCallback(
    (id: number) => {
      setToasts((current) =>
        current.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
      );
      window.setTimeout(() => remove(id), 220);
    },
    [remove],
  );

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((current) => [
        ...current.slice(-4),
        {
          id,
          title: options.title,
          description: options.description,
          tone: options.tone ?? 'default',
          durationMs: options.durationMs ?? DEFAULT_DURATION,
          leaving: false,
        },
      ]);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="lf-toaster" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <ToastItem
            key={t.id}
            record={t}
            onExit={() => beginExit(t.id)}
            onGone={() => remove(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  record,
  onExit,
  onGone,
}: {
  record: ToastRecord;
  onExit: () => void;
  onGone: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const hoveredRef = useRef(false);

  useEffect(() => {
    if (record.leaving) {
      timerRef.current = window.setTimeout(onGone, 220);
      return () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
      };
    }
    // Auto-dismiss unless the user is hovering (timer paused on hover).
    timerRef.current = window.setTimeout(() => {
      if (!hoveredRef.current) onExit();
    }, record.durationMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [record.leaving, record.durationMs, onExit, onGone]);

  return (
    <div
      className={`lf-toast lf-toast--${record.tone}${record.leaving ? ' lf-toast--leaving' : ''}`}
      role="status"
      onMouseEnter={() => {
        hoveredRef.current = true;
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        if (!record.leaving) {
          if (timerRef.current) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(onExit, RESUME_DELAY);
        }
      }}
    >
      <span className="lf-toast__icon">{TONE_ICON[record.tone]}</span>
      <div className="lf-toast__content">
        <div className="lf-toast__title">{record.title}</div>
        {record.description ? (
          <div className="lf-toast__description">{record.description}</div>
        ) : null}
      </div>
      <button
        type="button"
        className="lf-iconbtn lf-toast__close"
        aria-label="Dismiss notification"
        onClick={() => {
          if (timerRef.current) window.clearTimeout(timerRef.current);
          onExit();
        }}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
