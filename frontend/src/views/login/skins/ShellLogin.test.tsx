import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShellLogin from './ShellLogin';
// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
// with two tests per file the first render would otherwise leak into the second.
afterEach(cleanup);
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, getOAuthStatus: () => Promise.resolve({ enabled: true, client_id_set: true }) };
});
const wrap = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><ShellLogin /></MemoryRouter></QueryClientProvider>);
describe('shell skin R1 contract', () => {
  it('carries every auth path', async () => {
    wrap();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    // Exact: the show/hide toggle is aria-labeled "Show password" by design,
    // so a loose /password/i would match two elements.
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /demo/i })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot/i })).toBeInTheDocument();
  });
  it('reveals the dashboard only while the peek button is held', () => {
    wrap();
    const backdrop = screen.getByTestId('shell-backdrop');
    const peek = screen.getByRole('button', { name: /peek/i });
    expect(backdrop).toHaveAttribute('data-peeking', 'false');
    fireEvent.pointerDown(peek);
    expect(backdrop).toHaveAttribute('data-peeking', 'true');
    fireEvent.pointerUp(peek);
    expect(backdrop).toHaveAttribute('data-peeking', 'false');
  });
  it('hides the hold-to-peek pill on narrow viewports (login-menu overlap)', () => {
    wrap();
    // Centered peek pill would collide with the fixed login-menu pill under
    // ~640px, so it stays hidden there.
    expect(screen.getByRole('button', { name: /peek/i }).className).toContain('max-[639px]:hidden');
  });
});
