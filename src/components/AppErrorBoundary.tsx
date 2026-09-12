import { Component, ErrorInfo, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error?: Error };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SprayLab UI crashed safely:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <section className="mx-auto max-w-2xl rounded-3xl border border-red-400/30 bg-red-950/30 p-6 shadow-2xl shadow-black/40">
          <p className="text-sm uppercase tracking-[0.28em] text-red-200">Recovered from a UI error</p>
          <h1 className="mt-3 text-2xl font-semibold">The trainer hit a runtime error instead of going black.</h1>
          <p className="mt-3 text-sm text-red-100/80">
            Refresh the page to continue. Your local progress is kept when possible. Open the browser console and send the red error text if this happens again.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-2xl bg-slate-950/80 p-4 text-xs text-red-100/80">
            {this.state.error.message}
          </pre>
          <button className="primary-button mt-5" onClick={() => window.location.reload()}>
            Reload trainer
          </button>
        </section>
      </main>
    );
  }
}
