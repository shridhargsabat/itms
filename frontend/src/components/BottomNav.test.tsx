import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import BottomNav from './BottomNav';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);
afterEach(() => {
  localStorage.clear();
  document.documentElement.style.scrollPaddingBottom = '';
});

function setUser() {
  localStorage.setItem(
    'itms_user',
    JSON.stringify({ id: 'u1', email: 'a@itms.local', name: 'A User', role: 'ADMIN', department: 'IT' }),
  );
}

describe('BottomNav scroll clearance (UX-45, issue 219)', () => {
  it('sets bottom scroll-padding while mounted so mid-scroll content clears the capsule', () => {
    setUser();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <BottomNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(document.documentElement.style.scrollPaddingBottom).toBe('6rem');

    unmount();
    expect(document.documentElement.style.scrollPaddingBottom).toBe('');
  });
});
