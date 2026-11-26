import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { clampPage, useClientPagination, useServerPagination } from './usePagination';

describe('clampPage (UX-09 #183)', () => {
  it('passes in-range pages through', () => {
    expect(clampPage(1, 5)).toBe(1);
    expect(clampPage(3, 5)).toBe(3);
    expect(clampPage(5, 5)).toBe(5);
  });
  it('clamps below 1 up to 1', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-3)).toBe(1);
  });
  it('clamps above the page count down to it', () => {
    expect(clampPage(6, 5)).toBe(5);
    expect(clampPage(999, 5)).toBe(5);
  });
  it('leaves high pages alone when the count is unknown or degenerate', () => {
    expect(clampPage(9)).toBe(9);
    expect(clampPage(9, 0)).toBe(9);
    expect(clampPage(9, -2)).toBe(9);
    expect(clampPage(9, Number.NaN)).toBe(9);
  });
  it('maps NaN and non-finite input to page 1', () => {
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(Number.POSITIVE_INFINITY, 5)).toBe(1);
    expect(clampPage(Number.NaN)).toBe(1);
  });
  it('floors fractional pages', () => {
    expect(clampPage(2.9, 5)).toBe(2);
    expect(clampPage(2.2)).toBe(2);
  });
});

describe('useServerPagination goToPage (UX-09 #183)', () => {
  it('jumps to a clamped page', () => {
    const { result } = renderHook(() => useServerPagination(20));
    act(() => {
      result.current.goToPage(3, 5);
    });
    expect(result.current.page).toBe(3);
    act(() => {
      result.current.goToPage(99, 5);
    });
    expect(result.current.page).toBe(5);
    act(() => {
      result.current.goToPage(-2, 5);
    });
    expect(result.current.page).toBe(1);
    act(() => {
      result.current.goToPage(Number.NaN, 5);
    });
    expect(result.current.page).toBe(1);
  });
  it('keeps the existing reset-on-page-size and offset behavior', () => {
    const { result } = renderHook(() => useServerPagination(20));
    act(() => {
      result.current.setPage(3);
    });
    expect(result.current.offset).toBe(40);
    act(() => {
      result.current.setPageSize(10);
    });
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(10);
    expect(result.current.offset).toBe(0);
    act(() => {
      result.current.setPage(4);
      result.current.reset();
    });
    expect(result.current.page).toBe(1);
  });
});

describe('useClientPagination passthrough', () => {
  it('still slices rows and derives the total', () => {
    const rows = [1, 2, 3, 4, 5];
    const { result } = renderHook(() => useClientPagination(rows, 2));
    expect(result.current.total).toBe(5);
    expect(result.current.pageRows).toEqual([1, 2]);
    act(() => {
      result.current.goToPage(3, 3);
    });
    expect(result.current.pageRows).toEqual([5]);
  });
});
