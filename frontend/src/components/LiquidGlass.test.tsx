import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setThemeModeLocal } from '@/lib/theme';
import Modal from './Modal';
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
  it('mounts the 3-channel RGB chromatic aberration SVG filter with yChannelSelector="G" and default scale 18', () => {
    setThemeModeLocal('light');
    const { container } = render(<LiquidGlassFilterBank />);
    const filter = container.querySelector(`filter#${LIQUID_GLASS_FILTER_ID}`);
    expect(filter).not.toBeNull();
    const maps = filter?.querySelectorAll('feDisplacementMap') ?? [];
    expect(maps.length).toBe(3);
    maps.forEach((m) => {
      expect(m.getAttribute('xChannelSelector')).toBe('R');
      expect(m.getAttribute('yChannelSelector')).toBe('G');
    });
    expect(maps[0].getAttribute('scale')).toBe('18');
  });

  it('omits the SVG filter bank when active theme is non-glass (paper)', () => {
    setThemeModeLocal('paper');
    const { container } = render(<LiquidGlassFilterBank />);
    expect(container.querySelector(`filter#${LIQUID_GLASS_FILTER_ID}`)).toBeNull();
  });

  it('renders white specular border in dark mode and iridescent indigo/sky prism rim in light mode', () => {
    setThemeModeLocal('dark');
    const { unmount } = render(
      <LiquidGlassSurface data-testid="lg-dark" className="rounded-2xl p-4">
        <span>Dark Content</span>
      </LiquidGlassSurface>,
    );
    const darkBox = screen.getByTestId('lg-dark');
    const darkSpec = darkBox.querySelector('[data-testid="liquid-glass-specular"]') as HTMLElement;
    expect(darkSpec.style.background.replace(/\s/g, '')).toContain('rgba(255,255,255,');
    const initialBg = darkSpec.style.background;
    fireEvent.pointerMove(darkBox, { clientX: 250, clientY: 40 });
    expect(darkSpec.style.background).not.toBe(initialBg);
    unmount();

    setThemeModeLocal('light');
    render(
      <LiquidGlassSurface data-testid="lg-light" className="rounded-2xl p-4">
        <span>Light Content</span>
      </LiquidGlassSurface>,
    );
    const lightSpec = screen
      .getByTestId('lg-light')
      .querySelector('[data-testid="liquid-glass-specular"]') as HTMLElement;
    expect(lightSpec.style.background.replace(/\s/g, '')).toContain('rgba(79,70,229,');
    expect(lightSpec.style.background.replace(/\s/g, '')).toContain('rgba(14,165,233,');
  });

  it('respects prefers-reduced-motion: reduce by skipping pointer-tracking state updates', () => {
    setThemeModeLocal('dark');
    const origMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    try {
      render(
        <LiquidGlassSurface data-testid="lg-rm" elastic className="rounded-2xl p-4">
          <span>Reduced Motion</span>
        </LiquidGlassSurface>,
      );
      const box = screen.getByTestId('lg-rm');
      const spec = box.querySelector('[data-testid="liquid-glass-specular"]') as HTMLElement;
      const before = spec.style.background;
      fireEvent.pointerMove(box, { clientX: 300, clientY: 50 });
      expect(spec.style.background).toBe(before);
      expect(box.style.transform).toBe('');
    } finally {
      window.matchMedia = origMatchMedia;
    }
  });

  it('upgrades Modal dialog container with LiquidGlassSurface in glass themes', () => {
    setThemeModeLocal('dark');
    render(
      <Modal title="Liquid Modal" onClose={() => {}}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = document.body.querySelector('.glass-chrome');
    expect(dialog).not.toBeNull();
    expect(dialog).toHaveAttribute('data-liquid-glass', 'active');
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
