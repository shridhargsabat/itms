import { Component, type ReactNode } from 'react';
import { RefreshCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Route-level error boundary. With code splitting, a lazy chunk can fail to
 * load (stale service worker precache, flaky network, 404 on an old hash) —
 * without this, the route hangs on the Suspense spinner forever and every
 * table/button on the page "disappears". Retry re-imports the chunk.
 */
export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // A failed dynamic import is retryable; re-import attempts clear the
    // module-level rejection in Vite's eager chunk registry.
    console.error('[route-chunk] load failure:', error?.message);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const failed = /dynamically imported|dynamic import|import\(|chunk|Loading/i.test(this.state.error.message);
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-base px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl glass-card">
          <TriangleAlert className="h-6 w-6 text-red-400" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-primary">
            {failed ? "This screen couldn't load" : 'Something went wrong'}
          </h2>
          <p className="mt-1 max-w-[260px] text-xs text-muted">
            {failed
              ? 'The app update may not have finished syncing on this device. Reload once to complete it.'
              : this.state.error.message.slice(0, 140)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => window.location.reload()}
            variant="secondary"
          >
            Reload
          </Button>
          <Button
            type="button"
            onClick={this.retry}
            variant="primary"
            leftIcon={<RefreshCcw className="h-3.5 w-3.5" />}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }
}
