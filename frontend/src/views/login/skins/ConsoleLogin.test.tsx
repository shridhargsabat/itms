import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import ConsoleLogin from './ConsoleLogin';
vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return { ...mod, getOAuthStatus: () => Promise.resolve({ enabled: true, client_id_set: true }) };
});
const wrap = () => render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><ConsoleLogin /></MemoryRouter></QueryClientProvider>);
describe('console skin R1 contract', () => {
  it('carries every auth path', async () => {
    wrap();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /authenticate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /demo/i })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot/i })).toBeInTheDocument();
  });
});
