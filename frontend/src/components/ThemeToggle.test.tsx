import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ThemeToggle from './ThemeToggle';
vi.mock('@/api/client', () => ({ setThemePref: () => Promise.resolve() }));
describe('theme dropdown', () => {
  it('lists all 10 themes grouped, applies on click', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: /theme/i }));
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Classic')).toBeInTheDocument();
    ['Paper','Console','Bold','Shell','Terminal','Liquid Glass Light','Liquid Glass Dark',
     'Ledgerly Light'].forEach((label) =>
      expect(screen.getByRole('menuitemradio', { name: new RegExp(label) })).toBeInTheDocument());
    // Exact-string matches: 'Liquid Glass (Auto)' contains regex-significant
    // parens (new RegExp would never match the literal label), and /Ledgerly/
    // would also match 'Ledgerly Light' (getByRole throws on multiple).
    expect(screen.getByRole('menuitemradio', { name: 'Liquid Glass (Auto)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Ledgerly' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Console/ }));
    expect(localStorage.getItem('itms_theme')).toBe('console');
  });
});
