import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaperLogin from './PaperLogin';
import ConsoleLogin from './ConsoleLogin';
import ClarityLogin from './ClarityLogin';
// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, getOAuthStatus: () => Promise.resolve({ enabled: true, client_id_set: true }) };
});
const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
// Final-review regression: CTA labels must render WITHOUT literal quote
// characters (Paper/Console once rendered 'Sign in' / 'Authenticate' as JSX
// text with quotes). Exact accessible-name matches pin this.
describe('skin submit-button accessible names', () => {
  it('paper submit is exactly "Sign in"', () => {
    wrap(<PaperLogin />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
  });
  it('paper demo is exactly "Use demo account"', () => {
    wrap(<PaperLogin />);
    expect(screen.getByRole('button', { name: 'Use demo account' })).toBeInTheDocument();
  });
  it('console submit is exactly "Authenticate ↵"', () => {
    wrap(<ConsoleLogin />);
    expect(screen.getByRole('button', { name: 'Authenticate ↵' })).toHaveAttribute('type', 'submit');
  });
  it('clarity submit is exactly "Sign in"', () => {
    wrap(<ClarityLogin />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
  });
  it('clarity demo is exactly "Use demo account"', () => {
    wrap(<ClarityLogin />);
    expect(screen.getByRole('button', { name: 'Use demo account' })).toBeInTheDocument();
  });
});
