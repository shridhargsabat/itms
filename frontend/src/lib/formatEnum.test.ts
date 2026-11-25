import { describe, expect, it } from 'vitest';
import { formatEnum } from './formatEnum';

describe('formatEnum', () => {
  it('title-cases underscore enums', () => {
    expect(formatEnum('SERVICE_REQUEST')).toBe('Service Request');
    expect(formatEnum('NETWORK_DEVICE')).toBe('Network Device');
  });
  it('passes through already-clean strings', () => {
    expect(formatEnum('Article')).toBe('Article');
  });
});
