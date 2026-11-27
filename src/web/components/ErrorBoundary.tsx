import { Component, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  failed: boolean;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(): void {
    console.error(JSON.stringify({ code: 'ui_error' }));
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-3 px-4">
          <h1 className="text-2xl font-semibold">Qualcosa è andato storto</h1>
          <p className="text-muted">Ricarica la pagina. Se il problema resta, riprova più tardi.</p>
          <button
            type="button"
            className="w-fit rounded-lg bg-brand px-4 py-2 font-medium text-white"
            onClick={() => {
              window.location.reload();
            }}
          >
            Ricarica
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
