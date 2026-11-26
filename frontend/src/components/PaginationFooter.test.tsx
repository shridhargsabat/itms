import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    // Tables-audit de-stickied TABLE_SPEC.footer (sticky was dead outside the
    // scroll container), so pin the footer-spec marker classes instead.
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toContain('rounded-b-2xl');
    expect(cls).not.toContain('mt-4');
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

describe('pagination footer jump controls (UX-09 #183)', () => {
  const gotoValue = () => (screen.getByLabelText('Go to page') as HTMLInputElement).value;

  it('First and Last jump to the ends', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationFooter page={3} pageSize={20} total={100} rowsLength={20} onPageChange={onPageChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(onPageChange).toHaveBeenNthCalledWith(1, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 5);
  });

  it('First is disabled on page 1, Last on the last page — both stay ghost', () => {
    const { rerender } = render(
      <PaginationFooter page={1} pageSize={20} total={100} rowsLength={20} />,
    );
    const first = screen.getByRole('button', { name: 'First page' });
    expect(first).toBeDisabled();
    expect(first.className).not.toMatch(/bg-accent(?!\/)/);
    // Last stays ghost even when ENABLED (only Next gets the CTA fill).
    const last = screen.getByRole('button', { name: 'Last page' });
    expect(last).not.toBeDisabled();
    expect(last.className).not.toMatch(/bg-accent(?!\/)/);
    rerender(<PaginationFooter page={5} pageSize={20} total={100} rowsLength={20} />);
    expect(screen.getByRole('button', { name: 'Last page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'First page' })).not.toBeDisabled();
  });

  it('jump cluster hides when the page count is unknown', () => {
    // rowsLength-only mode (no total): Last/go-to have no target, so the old
    // Prev/Next-only UI renders exactly as before.
    render(<PaginationFooter page={1} pageSize={20} rowsLength={20} />);
    expect(screen.queryByRole('button', { name: 'First page' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Last page' })).toBeNull();
    expect(screen.queryByLabelText('Go to page')).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument();
  });

  it('go-to commits on Enter', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationFooter page={3} pageSize={20} total={100} rowsLength={20} onPageChange={onPageChange} />,
    );
    expect(gotoValue()).toBe('3');
    fireEvent.change(screen.getByLabelText('Go to page'), { target: { value: '5' } });
    fireEvent.keyDown(screen.getByLabelText('Go to page'), { key: 'Enter' });
    expect(onPageChange).toHaveBeenCalledWith(5);
  });

  it('go-to clamps out-of-range input into [1, pages]', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationFooter page={3} pageSize={20} total={100} rowsLength={20} onPageChange={onPageChange} />,
    );
    const box = () => screen.getByLabelText('Go to page');
    fireEvent.change(box(), { target: { value: '999' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.change(box(), { target: { value: '0' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.change(box(), { target: { value: '-3' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPageChange).toHaveBeenNthCalledWith(1, 5);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 1);
    expect(onPageChange).toHaveBeenNthCalledWith(3, 1);
  });

  it('go-to garbage and empty input navigate nowhere and revert', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationFooter page={3} pageSize={20} total={100} rowsLength={20} onPageChange={onPageChange} />,
    );
    const box = () => screen.getByLabelText('Go to page');
    fireEvent.change(box(), { target: { value: 'abc' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.change(box(), { target: { value: '' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    // Typing the page we're already on is a silent no-op too.
    fireEvent.change(box(), { target: { value: '3' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(gotoValue()).toBe('3');
  });

  it('Go button commits the draft', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationFooter page={3} pageSize={20} total={100} rowsLength={20} onPageChange={onPageChange} />,
    );
    fireEvent.change(screen.getByLabelText('Go to page'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('Escape reverts the draft without navigating', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationFooter page={3} pageSize={20} total={100} rowsLength={20} onPageChange={onPageChange} />,
    );
    fireEvent.change(screen.getByLabelText('Go to page'), { target: { value: '5' } });
    fireEvent.keyDown(screen.getByLabelText('Go to page'), { key: 'Escape' });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(gotoValue()).toBe('3');
  });
});
