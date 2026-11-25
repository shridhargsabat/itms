import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import PaginationFooter from './PaginationFooter';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
afterEach(cleanup);

describe('pagination footer ghost nav (task-15 sweep)', () => {
  it('disabled nav stays ghost-transparent, never accent-filled', () => {
    // The nav buttons document ghost intent (bordered, transparent) but
    // Button's default variant=primary leaked bg-accent through twMerge,
    // filling them with accent @30% and washing out the labels in
    // paper/shell/terminal. They must not carry the primary fill.
    // NOTE scope: single-page fixture, both buttons disabled. The ENABLED
    // Next (multi-page) is intentionally primary — see next case.
    render(<PaginationFooter page={1} pageSize={20} total={5} rowsLength={5} />);
    for (const name of ['Previous page', 'Next page']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.className).not.toMatch(/bg-accent(?!\/)/);
      expect(btn.className).toContain('border-edge2');
    }
  });
  it('enabled Next keeps the intentional accent fill with legible on-accent ink', () => {
    // Forward-CTA design: with a next page available, Next is primary
    // (accent-filled) on purpose. The fill must pair with text-on-accent
    // so the label stays legible (white-on-lime failed in bold).
    render(<PaginationFooter page={1} pageSize={20} total={100} rowsLength={20} />);
    const next = screen.getByRole('button', { name: 'Next page' });
    expect(next.className).toMatch(/bg-accent(?!\/)/);
    expect(next.className).toContain('text-on-accent');
    const prev = screen.getByRole('button', { name: 'Previous page' });
    expect(prev.className).not.toMatch(/bg-accent(?!\/)/);
    expect(prev.className).toContain('border-edge2');
  });
  it('static variant renders in normal flow without sticky classes', () => {
    const { container } = render(
      <PaginationFooter page={1} pageSize={20} total={45} rowsLength={20} variant="static" />,
    );
    const footer = container.firstChild as HTMLElement;
    expect(footer.className).not.toMatch(/sticky/);
    expect(footer.className).toMatch(/mt-4/);
  });
  it('sticky variant (default) keeps TABLE_SPEC.footer classes', () => {
    const { container } = render(
      <PaginationFooter page={1} pageSize={20} total={45} rowsLength={20} />,
    );
    expect((container.firstChild as HTMLElement).className).toMatch(/sticky/);
  });
  it('renders nothing when total is 0', () => {
    const { container } = render(
      <PaginationFooter page={1} pageSize={20} total={0} rowsLength={0} />,
    );
    expect(container.innerHTML).toBe('');
  });
  it('page-size select has an accessible label', () => {
    render(<PaginationFooter page={1} pageSize={20} total={45} rowsLength={20} />);
    expect(screen.getByLabelText('Rows per page')).toBeInTheDocument();
  });
});
