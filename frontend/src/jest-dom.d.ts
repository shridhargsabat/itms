// Applies jest-dom's vitest Assertion augmentation (toBeInTheDocument etc.)
// to everything under src. Runtime registration lives in vitest.setup.ts
// (root, outside tsconfig include) so tsc needs this explicit import.
import '@testing-library/jest-dom/vitest';
