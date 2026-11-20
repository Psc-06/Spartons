import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#080E1A] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0F172A] border border-[#1E2D45] rounded-md p-6 space-y-3">
            <h1 className="text-sm font-semibold text-white">
              MuleShield Workspace Recovery
            </h1>
            <p className="text-xs text-slate-400">
              {this.state.error.message || 'An unexpected rendering error occurred.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3.5 py-2 rounded-md text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950"
            >
              Reload Investigation Workspace
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

