import { describe, expect, it } from 'vitest';
import {
  computeDirectionalScale,
  computeSpecularAngle,
  computeSpecularGradient,
  generateLiquidDisplacementMap,
  liquidGlassFragment,
  roundedRectSDF,
} from './liquid-glass-shader';

describe('liquid-glass-shader (rdev/liquid-glass-react port)', () => {
  it('computes roundedRectSDF negatively inside and positively outside', () => {
    expect(roundedRectSDF(0, 0, 0.3, 0.2, 0.1)).toBeLessThan(0);
    expect(roundedRectSDF(0.9, 0.9, 0.3, 0.2, 0.1)).toBeGreaterThan(0);
  });

  it('keeps center UV stationary (0.5, 0.5) and warps X/Y edges symmetrically in liquidGlassFragment', () => {
    const center = liquidGlassFragment({ x: 0.5, y: 0.5 });
    expect(center.x).toBeCloseTo(0.5, 4);
    expect(center.y).toBeCloseTo(0.5, 4);

    // Symmetric 0.38 x 0.38 SDF box ensures top/bottom and left/right rims warp equally
    const leftEdge = liquidGlassFragment({ x: 0.05, y: 0.5 });
    const topEdge = liquidGlassFragment({ x: 0.5, y: 0.05 });
    expect(Math.abs(leftEdge.x - 0.05)).toBeCloseTo(Math.abs(topEdge.y - 0.05), 4);
  });

  it('returns a valid data:image/ URI from generateLiquidDisplacementMap even in jsdom', () => {
    const uri = generateLiquidDisplacementMap(64, 64);
    expect(uri.startsWith('data:image/')).toBe(true);
    expect(generateLiquidDisplacementMap(64, 64)).toBe(uri);
  });

  it('computes specular gradient angle and stops from normalized mouseOffset', () => {
    const neutral = computeSpecularAngle({ x: 0, y: 0 });
    expect(neutral.angleDeg).toBe(135);
    expect(neutral.stop1Pct).toBe(33);
    expect(neutral.stop2Pct).toBe(66);

    const shifted = computeSpecularAngle({ x: 25, y: -20 });
    expect(shifted.angleDeg).toBe(165);
    expect(shifted.stop1Opacity).toBeGreaterThan(neutral.stop1Opacity);
  });

  it('generates distinct dark-mode white specular rim and light-mode indigo/sky prism rim', () => {
    const darkGrad = computeSpecularGradient({ x: 10, y: -10 }, true);
    const lightGrad = computeSpecularGradient({ x: 10, y: -10 }, false);
    expect(darkGrad).toContain('rgba(255,255,255,');
    expect(lightGrad).toContain('rgba(79,70,229,');
    expect(lightGrad).toContain('rgba(14,165,233,');
  });

  it('returns scale(1) outside 200px activation zone and directional scaleX/Y inside', () => {
    const rect = { left: 100, top: 100, width: 200, height: 80 } as DOMRect;
    expect(computeDirectionalScale({ x: 900, y: 900 }, rect, 0.15)).toBe('scale(1)');
    const inside = computeDirectionalScale({ x: 320, y: 140 }, rect, 0.25);
    expect(inside).toMatch(/^scaleX\(0\.\d+|1\.\d+\) scaleY\(0\.\d+|1\.\d+\)$/);
  });
});
