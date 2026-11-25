import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OfflineBanner from './OfflineBanner';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);

const realOnLine = navigator.onLine;

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: realOnLine, configurable: true });
});

describe('OfflineBanner', () => {
  it('announces politely with status semantics', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(<OfflineBanner />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(/you're offline/i);
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('hides after a successful fetch even if an offline event fired', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    render(<OfflineBanner />);
    expect(screen.queryByRole('status')).toBeNull();

    // Stale offline signal arrives (e.g. captive portal blip, SW hiccup).
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    // A real API response succeeded afterwards — trust the fetch, not the event.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('itms:request-success'));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders nothing while online', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
