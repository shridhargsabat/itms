// skins/LegacyLogin.test.tsx
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import LegacyLogin from './LegacyLogin';
const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
describe('legacy login freeze', () => {
  it('renders the exact legacy structure', () => {
    const { container } = wrap(<LegacyLogin />);
    expect(screen.getByRole('heading', { name: 'ITMS' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
    expect(container.querySelector('.glass-card')).not.toBeNull();
    expect(container.querySelector('.animate-pulse-ring')).not.toBeNull();
    expect(screen.getByText(/argon2 hashes/)).toBeInTheDocument();
  });
});
