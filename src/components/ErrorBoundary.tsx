import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#1e2130] border border-red-500/30 rounded-2xl p-8 text-center space-y-5">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-xl font-bold text-white">Ein Fehler ist aufgetreten</h1>
          <p className="text-sm text-[#9ca3af] leading-relaxed">
            Die App ist auf ein unerwartetes Problem gestoßen. Das passiert manchmal bei
            bestimmten Kartendaten. Meist hilft ein einfaches Neuladen.
          </p>
          <details className="text-left">
            <summary className="text-xs text-[#6b7280] cursor-pointer hover:text-[#9ca3af] transition-colors">
              Fehlerdetails anzeigen
            </summary>
            <pre className="mt-2 text-[10px] text-red-400/80 bg-[#0f1117] rounded-xl p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
              {error.message}
              {'\n'}
              {error.stack?.slice(0, 600)}
            </pre>
          </details>
          <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 text-sm font-semibold transition-colors"
            >
              🔄 Seite neu laden
            </button>
            <button
              onClick={() => {
                // Clear potentially corrupt persisted state that might have triggered the crash
                try {
                  sessionStorage.removeItem('sebi_ai_page');
                  localStorage.removeItem('library_filters');
                } catch { /* ignore */ }
                window.location.reload();
              }}
              className="px-5 py-2.5 rounded-xl bg-[#252840] border border-[#2d3148] text-[#9ca3af] hover:text-white text-sm font-medium transition-colors"
            >
              🧹 Cache leeren & neu laden
            </button>
          </div>
        </div>
      </div>
    );
  }
}
