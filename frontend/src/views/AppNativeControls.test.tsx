import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Reports from './Reports';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

vi.mock('@/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/client')>();
  return {
    ...mod,
    getRepeatIncidents: () => Promise.resolve([]),
    listKbArticles: () => Promise.resolve({ items: [], total: 0 }),
    listCanned: () => Promise.resolve([]),
  };
});

function qc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('App-native controls policy (#77: no native <select> or window.confirm)', () => {
  it('Reports renders app-native Select triggers instead of native <select>', () => {
    const { container } = render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter>
          <Reports />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(container.querySelectorAll('button[aria-haspopup="listbox"]')).toHaveLength(2);
  });

  it('KnowledgeBase ArticleForm uses app-native Select instead of native <select>', () => {
    const kbSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './KnowledgeBase.tsx'),
      'utf8',
    );
    expect(kbSrc).not.toMatch(/<select[\s>]/);
  });

  it('Masters VendorsTab uses DeleteButton instead of window.confirm', () => {
    const mastersSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), './Masters.tsx'),
      'utf8',
    );
    // Strip comments before checking for confirm(
    const codeOnly = mastersSrc.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/\bconfirm\s*\(/);
  });
});
