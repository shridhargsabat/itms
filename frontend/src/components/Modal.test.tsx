import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Modal from './Modal';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);

describe('Modal dialog semantics and focus trap (task 11)', () => {
  it('exposes dialog semantics and labelledby title', () => {
    render(
      <Modal title="Create asset" onClose={() => {}}>
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Create asset');
  });

  it('traps focus inside and restores it on close', () => {
    // NOTE: trigger is focused BEFORE the modal mounts — focus restore
    // captures document.activeElement at mount time.
    render(<button>trigger</button>);
    const trigger = screen.getByText('trigger') as HTMLElement;
    trigger.focus();

    const modal = render(
      <Modal title="M" onClose={() => {}}>
        <button>inner</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    // initial focus moves inside the dialog on mount
    expect(dialog.contains(document.activeElement)).toBe(true);

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    const inner = screen.getByRole('button', { name: 'inner' });

    // Tab on the last element wraps to the first (stays inside)
    inner.focus();
    fireEvent.keyDown(inner, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Shift+Tab on the first element wraps to the last
    fireEvent.keyDown(closeBtn, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(inner);

    // unmount restores focus to the trigger
    modal.unmount();
    expect(document.activeElement).toBe(trigger);
  });

  it('skips trap handling while a select listbox is open', () => {
    render(
      <>
        <div role="listbox">
          <div role="option" aria-selected="true">
            x
          </div>
        </div>
        <Modal title="M" onClose={() => {}}>
          <button>inner</button>
        </Modal>
      </>,
    );
    const inner = screen.getByRole('button', { name: 'inner' });
    inner.focus();
    fireEvent.keyDown(inner, { key: 'Tab' });
    // trap skipped: focus is left alone instead of wrapping to Close
    expect(document.activeElement).toBe(inner);
  });
});
