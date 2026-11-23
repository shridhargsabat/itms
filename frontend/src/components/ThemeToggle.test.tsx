import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ThemeToggle from './ThemeToggle';
vi.mock('@/api/client', () => ({ setThemePref: () => Promise.resolve() }));
afterEach(cleanup);
describe('theme dropdown', () => {
  it('lists all 12 themes grouped, applies on click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /theme/i }));
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Classic')).toBeInTheDocument();
    ['Paper','Console','Bold','Shell','Terminal','Liquid Glass Light','Liquid Glass Dark',
     'Ledgerly Light','Clarity Dark'].forEach((label) =>
      expect(screen.getByRole('menuitemradio', { name: new RegExp(label) })).toBeInTheDocument());
    // Exact-string matches: 'Liquid Glass (Auto)' contains regex-significant
    // parens (new RegExp would never match the literal label), and /Ledgerly/
    // would also match 'Ledgerly Light' (getByRole throws on multiple).
    // Same for /Clarity/ vs 'Clarity Dark'.
    expect(screen.getByRole('menuitemradio', { name: 'Liquid Glass (Auto)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Ledgerly' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Clarity' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Console/ }));
    expect(localStorage.getItem('itms_theme')).toBe('console');
  });
  it('opens downward by default, upward with direction="up"', () => {
    const { unmount } = render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /theme/i }));
    const down = screen.getByRole('menu');
    expect(down.className).toContain('top-full');
    expect(down.className).toContain('right-0');
    unmount();
    render(<ThemeToggle direction="up" />);
    fireEvent.click(screen.getByRole('button', { name: /theme/i }));
    const up = screen.getByRole('menu');
    expect(up.className).toContain('bottom-full');
    expect(up.className).toContain('left-0');
  });
});
