import '@testing-library/jest-dom/vitest';

// jsdom lacks window.matchMedia; theme.ts (watchSystemTheme) and several
// components call it on mount. Provide the standard minimal stub.
if (!window.matchMedia) {
  window.matchMedia = ((query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
