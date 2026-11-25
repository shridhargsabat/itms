import { describe, expect, it } from 'vitest';
import { formatDetailValue } from './formatValue';

describe('formatDetailValue', () => {
  it('passes primitives through', () => {
    expect(formatDetailValue('hello')).toBe('hello');
    expect(formatDetailValue(42)).toBe('42');
    expect(formatDetailValue(true)).toBe('true');
  });
  it('joins string arrays', () => {
    expect(formatDetailValue(['a', 'b'])).toBe('a, b');
  });
  it('extracts names from object arrays without [object Object]', () => {
    expect(formatDetailValue([{ name: 'Mouse' }, { label: 'Keyboard' }])).toBe('Mouse, Keyboard');
    expect(formatDetailValue([{ a: 1 }])).not.toMatch(/object Object/);
  });
  it('renders nested objects as key/value pairs', () => {
    expect(formatDetailValue({ ram: '16GB', cpu: 'i7' })).toBe('ram: 16GB, cpu: i7');
  });
  it('returns empty string for nullish/empty', () => {
    expect(formatDetailValue(null)).toBe('');
    expect(formatDetailValue(undefined)).toBe('');
    expect(formatDetailValue('')).toBe('');
  });
});
