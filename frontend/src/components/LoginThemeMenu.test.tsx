import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginThemeMenu from './LoginThemeMenu';
import Login from '@/views/Login';
// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
// with several tests per file one render would otherwise leak into the next.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, getOAuthStatus: () => Promise.resolve({ enabled: false, client_id_set: false }) };
});
const fetchSpy = vi.spyOn(globalThis, 'fetch');
describe('login theme menu', () => {
  it('switches theme locally without any network call', () => {
    render(<LoginThemeMenu />);
    fireEvent.click(screen.getByRole('button', { name: /login theme/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Terminal/ }));
    expect(localStorage.getItem('itms_theme')).toBe('terminal');
    expect(document.documentElement.classList.contains('theme-terminal')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it('lists all 12 themes grouped new/classic, legacy included', () => {
    render(<LoginThemeMenu />);
    fireEvent.click(screen.getByRole('button', { name: /login theme/i }));
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Classic')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(12);
    ['Paper', 'Console', 'Bold', 'Shell', 'Terminal', 'Liquid Glass Light', 'Liquid Glass Dark',
      'Ledgerly Light', 'Clarity Dark'].forEach((label) =>
      expect(screen.getByRole('menuitemradio', { name: new RegExp(label) })).toBeInTheDocument());
    // Exact-string matches: 'Liquid Glass (Auto)' contains regex-significant
    // parens, and /Ledgerly/ would also match 'Ledgerly Light'.
    // Same for /Clarity/ vs 'Clarity Dark'.
    expect(screen.getByRole('menuitemradio', { name: 'Liquid Glass (Auto)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Ledgerly' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Clarity' })).toBeInTheDocument();
  });
  it('selecting a legacy theme stays local with no network call', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<LoginThemeMenu />);
    fireEvent.click(screen.getByRole('button', { name: /login theme/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Liquid Glass Dark' }));
    expect(localStorage.getItem('itms_theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-terminal')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('chip is theme-agnostic and fixed to the corner', () => {
    render(<LoginThemeMenu />);
    const trigger = screen.getByRole('button', { name: /login theme/i });
    // Fixed corner placement…
    expect(trigger.className).toContain('fixed');
    expect(trigger.className).toContain('bottom-4');
    expect(trigger.className).toContain('right-4');
    // …with fixed dark-chip colors, never theme tokens (readable on every skin).
    expect(trigger.className).toContain('bg-zinc-900');
    expect(trigger.className).toContain('text-zinc-100');
    expect(trigger.className).not.toContain('bg-surface');
    expect(trigger.className).not.toContain('text-primary');
  });
  it('selecting a theme re-routes the login skin', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><Login /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /login theme/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Terminal/ }));
    expect(await screen.findByRole('button', { name: /signin\.sh/i })).toBeInTheDocument();
  });
});
