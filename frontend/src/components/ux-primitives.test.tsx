import { cleanup, render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import EmptyState from './EmptyState';
import FilterBar from './FilterBar';
import PageHeader from './PageHeader';

// RTL auto-cleanup needs globals (off in this repo), so clean up explicitly:
afterEach(cleanup);

describe('PageHeader', () => {
  it('renders title, description, and actions', () => {
    render(
      <PageHeader
        title="Assets"
        description="Track every device in one place."
        actions={<button type="button">Add asset</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Assets' })).toBeInTheDocument();
    expect(screen.getByText('Track every device in one place.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add asset' })).toBeInTheDocument();
  });
});

describe('FilterBar', () => {
  it('renders filter children', () => {
    render(
      <FilterBar>
        <input aria-label="Search" placeholder="Search…" />
        <button type="button">Apply</button>
      </FilterBar>,
    );
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders icon, title, description, and action', () => {
    const { container } = render(
      <EmptyState
        icon={Search}
        title="No results"
        description="Try adjusting your filters."
        action={<button type="button">Clear filters</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No results' })).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
