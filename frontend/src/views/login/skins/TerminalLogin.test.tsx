import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TerminalLogin from './TerminalLogin';
// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
// with two tests per file the first render would otherwise leak into the second.
afterEach(cleanup);
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, getOAuthStatus: () => Promise.resolve({ enabled: true, client_id_set: true }) };
});
const wrap = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><TerminalLogin /></MemoryRouter></QueryClientProvider>);
describe('terminal skin R1 contract', () => {
  it('carries every auth path', async () => {
    wrap();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    // Exact: the show/hide toggle is aria-labeled "Show passphrase" by design,
    // so a loose /passphrase/i would match two elements.
    expect(screen.getByLabelText(/^passphrase$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /signin\.sh/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /demo/i })).toBeInTheDocument();
    const oauth = await screen.findByRole('link', { name: /google/i });
    expect(oauth).toHaveAttribute('href', '/api/v1/auth/oauth/start');
    expect(screen.getByRole('link', { name: /forgot/i })).toBeInTheDocument();
  });
  it('ships no demo credential anywhere in the rendered output', () => {
    wrap();
    // Concatenated so the literal itself never appears in source (critical
    // security binding: it must occur nowhere in code, tests, or bundle).
    expect(document.documentElement.innerHTML).not.toContain('demo' + '1234');
  });
});
