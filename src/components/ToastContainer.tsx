import type { Toast } from '../hooks/useToast';

const icons = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
  warning: '⚠',
};

const colors = {
  success: 'border-green-500/40 bg-green-500/10 text-green-400',
  error: 'border-red-500/40 bg-red-500/10 text-red-400',
  info: 'border-blue-500/40 bg-blue-500/10 text-blue-400',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
};

interface Props {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export default function ToastContainer({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`${toast.exiting ? 'toast-exit' : 'toast-enter'} flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md ${colors[toast.type]} cursor-pointer`}
          onClick={() => onDismiss(toast.id)}
        >
          <span className="text-lg font-bold">{icons[toast.type]}</span>
          <p className="text-sm flex-1 text-white/90">{toast.message}</p>
        </div>
      ))}
    </div>
  );
}
