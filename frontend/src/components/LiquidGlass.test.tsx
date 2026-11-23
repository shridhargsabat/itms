import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setThemeModeLocal } from '@/lib/theme';
import {
  LIQUID_GLASS_FILTER_ID,
  LiquidGlassFilterBank,
  LiquidGlassSurface,
} from './LiquidGlass';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('LiquidGlassFilterBank + LiquidGlassSurface', () => {
  it('mounts the 3-channel RGB chromatic aberration SVG filter when active theme is glass (light/dark)', () => {
    setThemeModeLocal('light');
    const { container } = render(<LiquidGlassFilterBank />);
    const filter = container.querySelector(`filter#${LIQUID_GLASS_FILTER_ID}`);
    expect(filter).not.toBeNull();
    expect(filter?.querySelectorAll('feDisplacementMap').length).toBe(3);
  });

  it('omits the SVG filter bank when active theme is non-glass (paper)', () => {
    setThemeModeLocal('paper');
    const { container } = render(<LiquidGlassFilterBank />);
    expect(container.querySelector(`filter#${LIQUID_GLASS_FILTER_ID}`)).toBeNull();
  });

  it('renders specular xor-masked border layers in glass theme and updates gradient angle on pointermove', () => {
    setThemeModeLocal('dark');
    render(
      <LiquidGlassSurface data-testid="lg-box" className="rounded-2xl p-4">
        <span>Refractive Content</span>
      </LiquidGlassSurface>,
    );
    const box = screen.getByTestId('lg-box');
    expect(box).toHaveAttribute('data-liquid-glass', 'active');
    const specular = box.querySelector('[data-testid="liquid-glass-specular"]') as HTMLElement;
    expect(specular).not.toBeNull();
    const initialBg = specular.style.background;

    fireEvent.pointerMove(box, { clientX: 250, clientY: 40 });
    expect(specular.style.background).not.toBe(initialBg);
  });

  it('short-circuits to a plain container with no specular layers or transforms in paper theme', () => {
    setThemeModeLocal('paper');
    render(
      <LiquidGlassSurface data-testid="lg-paper" className="rounded-2xl p-4">
        <span>Paper Content</span>
      </LiquidGlassSurface>,
    );
    const box = screen.getByTestId('lg-paper');
    expect(box).not.toHaveAttribute('data-liquid-glass', 'active');
    expect(box.querySelector('[data-testid="liquid-glass-specular"]')).toBeNull();
    expect(box.style.transform).toBe('');
  });
});
