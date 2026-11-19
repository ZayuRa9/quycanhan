import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Thông báo hệ thống"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
    >
      {toasts.map((toast) => {
        const isSuccess = toast.variant === 'success';
        const isError = toast.variant === 'error';

        const containerClass = isSuccess
          ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-50'
          : isError
          ? 'bg-rose-950/95 border-rose-500/40 text-rose-50'
          : 'bg-[#0B1437]/95 border-blue-500/40 text-slate-50';

        const iconWrapClass = isSuccess
          ? 'bg-emerald-500/20 text-emerald-400'
          : isError
          ? 'bg-rose-500/20 text-rose-400'
          : 'bg-blue-500/20 text-blue-400';

        const Icon = isSuccess
          ? CheckCircle2
          : isError
          ? AlertCircle
          : Info;

        return (
          <div
            key={toast.id}
            role={isError ? 'alert' : 'status'}
            className={`pointer-events-auto animate-toast-in rounded-xl border px-4 py-3 shadow-xl backdrop-blur-md flex items-start gap-3 ${containerClass}`}
          >
            <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${iconWrapClass}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-snug">{toast.title}</p>
              {toast.message && (
                <p className="text-[11px] opacity-85 mt-0.5 leading-relaxed">
                  {toast.message}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Đóng thông báo"
              className="p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-white/10 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
