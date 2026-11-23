import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnimatedBackground from './AnimatedBackground';
import BentoCard from './BentoCard';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Glass theme per the brief: localStorage itms_theme=light + light matchMedia. */
function mockGlassLightTheme() {
  localStorage.setItem('itms_theme', 'light');
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('GlassShell (task 4: ambient orbs + BentoCard geometry)', () => {
  it('renders 3 glass orbs', () => {
    mockGlassLightTheme();
    render(<AnimatedBackground />);
    expect(screen.getAllByTestId('glass-orb')).toHaveLength(3);
  });

  it('BentoCard carries glass geometry + active liquid glass in a glass theme', () => {
    mockGlassLightTheme();
    render(<BentoCard data-testid="bento">hi</BentoCard>);
    const card = screen.getByTestId('bento');
    expect(card).toHaveClass('liquid-glass-panel');
    expect(card).toHaveClass('rounded-[26px]');
    expect(card).toHaveClass('hover:-translate-y-0.5');
    expect(card).toHaveAttribute('data-liquid-glass', 'active');
  });
});
