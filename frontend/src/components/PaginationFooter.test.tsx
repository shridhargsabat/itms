import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PaginationFooter from './PaginationFooter';

describe('pagination footer ghost nav (task-15 sweep)', () => {
  it('prev/next stay ghost-transparent, never accent-filled', () => {
    // The nav buttons document ghost intent (bordered, transparent) but
    // Button's default variant=primary leaked bg-accent through twMerge,
    // filling them with accent @30% and washing out the labels in
    // paper/shell/terminal. They must not carry the primary fill.
    render(<PaginationFooter page={1} pageSize={20} total={5} rowsLength={5} />);
    for (const name of ['Previous page', 'Next page']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.className).not.toMatch(/bg-accent(?!\/)/);
      expect(btn.className).toContain('border-edge2');
    }
  });
});
