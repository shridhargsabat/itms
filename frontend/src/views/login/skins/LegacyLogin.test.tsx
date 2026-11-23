// skins/LegacyLogin.test.tsx
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { setThemeModeLocal } from '@/lib/theme';
import { LIQUID_GLASS_FILTER_ID } from '@/components/LiquidGlass';
import LegacyLogin from './LegacyLogin';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
describe('legacy login freeze + Apple Liquid Glass upgrade', () => {
  it('renders the exact legacy structure', () => {
    const { container } = wrap(<LegacyLogin />);
    expect(screen.getByRole('heading', { name: 'ITMS' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
    expect(container.querySelector('.glass-card')).not.toBeNull();
    expect(container.querySelector('.animate-pulse-ring')).not.toBeNull();
    expect(screen.getByText(/argon2 hashes/)).toBeInTheDocument();
  });

  it('activates rdev/liquid-glass-react SVG filter bank and specular surface when in Liquid Glass theme', () => {
    setThemeModeLocal('light');
    const { container } = wrap(<LegacyLogin />);
    expect(container.querySelector(`filter#${LIQUID_GLASS_FILTER_ID}`)).not.toBeNull();
    const card = container.querySelector('.glass-card');
    expect(card).toHaveAttribute('data-liquid-glass', 'active');
  });
});
