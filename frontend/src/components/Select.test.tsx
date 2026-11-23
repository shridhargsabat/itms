import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Select from './Select';

afterEach(() => {
  cleanup();
});

// jsdom lacks Element.scrollIntoView (Select.toggle calls it on open).
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('Select menu readability', () => {
  it('renders the open menu as an opaque solid surface (no translucent glass-chrome)', () => {
    render(
      <Select
        value="MEDIUM"
        onChange={vi.fn()}
        options={[
          { value: 'LOW', label: 'LOW' },
          { value: 'MEDIUM', label: 'MEDIUM' },
          { value: 'HIGH', label: 'HIGH' },
          { value: 'URGENT', label: 'URGENT' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const menu = document.body.querySelector('[role="listbox"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.className).toContain('bg-surface');
    expect(menu.className).not.toContain('glass-chrome');
    expect(screen.getByText('URGENT')).toBeInTheDocument();
  });
});
