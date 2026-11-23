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

describe('Select mobile viewport clamping (Bug #2)', () => {
  it('clamps left so a wide menu from a right-column trigger never overflows a 375px viewport', () => {
    // 375px viewport (iPhone SE-class), trigger in a right-hand column.
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 667, configurable: true });
    const rect = {
      left: 195,
      top: 100,
      right: 355,
      bottom: 140,
      width: 160,
      height: 40,
      x: 195,
      y: 100,
      toJSON: () => {},
    } as DOMRect;
    const gbr = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    // Wide menu content: the measured menu is 300px wide.
    const origOW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return 300;
      },
    });
    try {
      render(
        <Select
          value=""
          onChange={vi.fn()}
          options={[{ value: 'A', label: 'A very long option label' }]}
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      const menu = document.body.querySelector('[role="listbox"]') as HTMLElement;
      expect(menu).not.toBeNull();
      const left = parseFloat(menu.style.left);
      // Menu must stay 8px inside the right edge: left + width <= 375 - 8.
      expect(left + 300).toBeLessThanOrEqual(375 - 8);
      // And it must actually have moved left of the trigger x=195.
      expect(left).toBeLessThan(195);
    } finally {
      gbr.mockRestore();
      if (origOW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOW);
      delete (window as unknown as Record<string, unknown>).innerWidth;
      delete (window as unknown as Record<string, unknown>).innerHeight;
    }
  });
});

describe('Select Escape layering (Bug #3)', () => {
  it('Escape closes ONLY the Select menu and does not invoke a parent window keydown listener', () => {
    const parentClose = vi.fn();
    window.addEventListener('keydown', parentClose);
    try {
      render(
        <Select
          value=""
          onChange={vi.fn()}
          options={[{ value: 'A', label: 'A' }]}
        />,
      );
      fireEvent.click(screen.getByRole('button'));
      expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
      // Dispatch from the page body so the event travels the real path:
      // window (capture: Select) -> ... -> body -> bubble back to window (parent).
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(document.body.querySelector('[role="listbox"]')).toBeNull();
      expect(parentClose).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', parentClose);
    }
  });
});
