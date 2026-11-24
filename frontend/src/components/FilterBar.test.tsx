import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FilterBar from './FilterBar';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly.
afterEach(cleanup);

describe('FilterBar spacing contract', () => {
  it('carries no outer bottom margin — spacing parents (space-y/gap) own the gap', () => {
    // Regression: a default mb-3 here beat space-y-5 (:where, zero
    // specificity), giving every page a 12px filter→content gap — except
    // Assets, whose mb-0 override collapsed it to 0px.
    const { container } = render(
      <FilterBar>
        <span>filter</span>
      </FilterBar>,
    );
    const root = container.firstElementChild as HTMLElement;
    const classes = (root.getAttribute('class') ?? '').split(/\s+/);
    expect(classes.filter((c) => /^mb-/.test(c))).toEqual([]);
  });

  it('still merges an explicit className on top', () => {
    const { container } = render(
      <FilterBar className="mt-2">
        <span>filter</span>
      </FilterBar>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('class')).toContain('mt-2');
    expect(root.getAttribute('class')).toContain('flex');
  });
});
