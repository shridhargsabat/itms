import { describe, expect, it } from 'vitest';
import { canScrollDown } from './Layout';

describe('canScrollDown (bottom fade scrim predicate)', () => {
  it('false when content fits (no overflow)', () => {
    expect(canScrollDown({ scrollHeight: 800, scrollTop: 0, clientHeight: 900 })).toBe(false);
  });

  it('true mid-scroll', () => {
    expect(canScrollDown({ scrollHeight: 2000, scrollTop: 500, clientHeight: 900 })).toBe(true);
  });

  it('false at true bottom, with 2px slop for subpixel zoom', () => {
    expect(canScrollDown({ scrollHeight: 2000, scrollTop: 1100, clientHeight: 900 })).toBe(false);
    expect(canScrollDown({ scrollHeight: 2000, scrollTop: 1099, clientHeight: 900 })).toBe(false);
    expect(canScrollDown({ scrollHeight: 2000, scrollTop: 1090, clientHeight: 900 })).toBe(true);
  });
});
