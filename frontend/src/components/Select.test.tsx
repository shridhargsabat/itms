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

describe('Select aria-label wiring (TFE-33)', () => {
  const options = [
    { value: 'LOW', label: 'LOW' },
    { value: 'MEDIUM', label: 'MEDIUM' },
  ];

  it('forwards ariaLabel to the trigger button as its accessible name', () => {
    render(<Select ariaLabel="Ticket priority" value="MEDIUM" onChange={vi.fn()} options={options} />);
    const trigger = screen.getByRole('button', { name: 'Ticket priority' });
    expect(trigger).toBeInTheDocument();
    expect(trigger.getAttribute('aria-label')).toBe('Ticket priority');
  });

  it("supports the 'aria-label' alias", () => {
    render(<Select aria-label="Rows per page" value="" onChange={vi.fn()} options={options} />);
    expect(screen.getByRole('button', { name: 'Rows per page' })).toBeInTheDocument();
  });
});

describe('Select keyboard model (FE-08, issue 152)', () => {
  const options = [
    { value: 'LOW', label: 'LOW' },
    { value: 'MEDIUM', label: 'MEDIUM' },
    { value: 'HIGH', label: 'HIGH' },
    { value: 'URGENT', label: 'URGENT' },
  ];

  function openMenu(value = 'MEDIUM', onChange = vi.fn()) {
    render(<Select ariaLabel="Priority" value={value} onChange={onChange} options={options} />);
    const trigger = screen.getByRole('button', { name: 'Priority' });
    fireEvent.click(trigger);
    const menu = document.body.querySelector('[role="listbox"]') as HTMLElement;
    expect(menu).not.toBeNull();
    return { trigger, menu, onChange };
  }

  function activeOption(menu: HTMLElement) {
    const id = menu.getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    return document.getElementById(id as string) as HTMLElement;
  }

  it('moves focus into the portaled menu on open and exposes the selection via aria-activedescendant', () => {
    const { menu } = openMenu();
    expect(document.activeElement).toBe(menu);
    expect(menu.getAttribute('tabindex')).toBe('-1');
    // Selected MEDIUM (index 1) is the initial active option.
    expect(activeOption(menu)).toHaveTextContent('MEDIUM');
    // Options stay out of the tab order — arrows, not Tab, move between them.
    for (const opt of screen.getAllByRole('option')) {
      expect(opt.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('ArrowDown/ArrowUp move the active option without selecting', () => {
    const { menu, onChange } = openMenu();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(activeOption(menu)).toHaveTextContent('HIGH');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(activeOption(menu)).toHaveTextContent('URGENT');
    // Clamps at the last option.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(activeOption(menu)).toHaveTextContent('URGENT');
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(activeOption(menu)).toHaveTextContent('HIGH');
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('Home/End jump to the first/last option', () => {
    const { menu } = openMenu();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(activeOption(menu)).toHaveTextContent('URGENT');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(activeOption(menu)).toHaveTextContent('LOW');
  });

  it('Enter selects the active option, closes, and returns focus to the trigger', () => {
    const { menu, trigger, onChange } = openMenu();
    fireEvent.keyDown(menu, { key: 'ArrowDown' }); // MEDIUM -> HIGH
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('HIGH');
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Space selects the active option', () => {
    const { menu, onChange } = openMenu('LOW');
    fireEvent.keyDown(menu, { key: 'End' });
    fireEvent.keyDown(menu, { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('URGENT');
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
  });

  it('Escape closes and returns focus to the trigger', () => {
    const { menu, trigger, onChange } = openMenu();
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('Escape with focus outside the menu closes without stealing focus (drawer traps keep working)', () => {
    const { menu } = openMenu();
    // Focus moved elsewhere (e.g. tabbed to another drawer control).
    menu.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('Tab closes and resumes the tab order from the trigger', () => {
    const { menu, trigger } = openMenu();
    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('ArrowDown on a closed trigger opens the menu and focuses it', () => {
    render(<Select ariaLabel="Priority" value="" onChange={vi.fn()} options={options} />);
    const trigger = screen.getByRole('button', { name: 'Priority' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = document.body.querySelector('[role="listbox"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(document.activeElement).toBe(menu);
    // No selection → first option active.
    expect(activeOption(menu)).toHaveTextContent('LOW');
  });

  it('ArrowUp on a closed trigger opens with the last option active', () => {
    render(<Select ariaLabel="Priority" value="" onChange={vi.fn()} options={options} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Priority' }), { key: 'ArrowUp' });
    const menu = document.body.querySelector('[role="listbox"]') as HTMLElement;
    expect(activeOption(menu)).toHaveTextContent('URGENT');
  });

  it('mouse hover syncs the active option (aria-activedescendant follows)', () => {
    const { menu } = openMenu();
    fireEvent.mouseEnter(screen.getByRole('option', { name: 'LOW' }));
    expect(activeOption(menu)).toHaveTextContent('LOW');
  });
});

describe('Select id passthrough (UX-02, issue 176)', () => {
  it('forwards id to the trigger button so a <label htmlFor> can target it', () => {
    render(
      <Select
        id="new-ticket-priority"
        value="MEDIUM"
        onChange={vi.fn()}
        options={[{ value: 'MEDIUM', label: 'MEDIUM' }]}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('id', 'new-ticket-priority');
  });
});

describe('Select searchable filter (UX-04, issue 178)', () => {
  const options = [
    { value: 'LOW', label: 'LOW' },
    { value: 'MEDIUM', label: 'MEDIUM' },
    { value: 'HIGH', label: 'HIGH' },
    { value: 'URGENT', label: 'URGENT' },
  ];

  function openSearchable(onChange = vi.fn()) {
    render(<Select ariaLabel="Assignee" value="" onChange={onChange} options={options} searchable />);
    fireEvent.click(screen.getByRole('button', { name: 'Assignee' }));
    const menu = document.body.querySelector('[role="listbox"]') as HTMLElement;
    expect(menu).not.toBeNull();
    return { menu, onChange };
  }

  function filterInput() {
    return screen.getByRole('textbox', { name: 'Filter options' });
  }

  it('renders no filter input by default (searchable defaults to false)', () => {
    render(<Select ariaLabel="Priority" value="" onChange={vi.fn()} options={options} />);
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Filter options' })).not.toBeInTheDocument();
  });

  it('renders a filter input in the menu when searchable and focuses it on open', () => {
    const { menu } = openSearchable();
    const input = filterInput();
    expect(menu.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('filters options by label, case-insensitively', () => {
    openSearchable();
    fireEvent.change(filterInput(), { target: { value: 'urg' } });
    expect(screen.getByRole('option', { name: 'URGENT' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'LOW' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'MEDIUM' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'HIGH' })).not.toBeInTheDocument();
  });

  it('clearing the filter restores all options', () => {
    openSearchable();
    const input = filterInput();
    fireEvent.change(input, { target: { value: 'urg' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('Space typed in the filter is filter text, not "select"', () => {
    const { onChange } = openSearchable();
    const input = filterInput() as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'UR ' } });
    fireEvent.keyDown(input, { key: ' ' });
    expect(input.value).toBe('UR ');
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('ArrowDown/Enter operate on the filtered list and return focus to the trigger', () => {
    const { onChange } = openSearchable();
    const input = filterInput();
    fireEvent.change(input, { target: { value: 'g' } }); // HIGH, URGENT
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // HIGH -> URGENT
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('URGENT');
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Assignee' }));
  });

  it('Escape from the filter closes without selecting', () => {
    const { onChange } = openSearchable();
    const input = filterInput();
    fireEvent.change(input, { target: { value: 'urg' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Tab from the filter closes and resumes the tab order from the trigger', () => {
    openSearchable();
    fireEvent.keyDown(filterInput(), { key: 'Tab' });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Assignee' }));
  });

  it('shows an empty state when nothing matches and Enter selects nothing', () => {
    const { onChange } = openSearchable();
    const input = filterInput();
    fireEvent.change(input, { target: { value: 'zzz-no-match' } });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByText('No matching options')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it('resets the filter on close so reopening shows all options', () => {
    openSearchable();
    fireEvent.change(filterInput(), { target: { value: 'urg' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(filterInput(), { key: 'Escape' });
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Assignee' }));
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect((filterInput() as HTMLInputElement).value).toBe('');
  });
});
