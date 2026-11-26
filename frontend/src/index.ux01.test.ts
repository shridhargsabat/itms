import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// UX-01 (#175): MEDIUM (text-yellow-700) and OPEN (text-blue-700) pills must
// be distinguishable by color as well as text — the glass overrides must not
// map both to the same Apple blue.
describe('glass badge pills (UX-01, issue 175)', () => {
  // NOTE: fileURLToPath resolution (not `new URL(..., import.meta.url)`)
  // because Vite rewrites that pattern as a bundled-asset import.
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), './index.css'),
    'utf8',
  );

  /** Bodies of the `.ring-inset.<tail> { ... }` rules (light first, dark second). */
  function blocks(tail: string): string[] {
    const re = new RegExp(`\\.ring-inset\\.${tail}\\s*\\{([^}]*)\\}`, 'g');
    return [...css.matchAll(re)].map((m) => m[1]);
  }

  it('maps MEDIUM (text-yellow-700) to AA-safe amber, not blue, in light and dark', () => {
    const yellow = blocks('text-yellow-700');
    expect(yellow).toHaveLength(2);
    const [light, dark] = yellow;
    expect(light).not.toContain('#007AFF');
    expect(light).not.toContain('0 122 255');
    expect(light).toContain('#92400E');
    expect(dark).not.toContain('#0A84FF');
    expect(dark).not.toContain('10 132 255');
    expect(dark).toContain('#FBBF24');
  });

  it('keeps OPEN (text-blue-700) on Apple blue in light and dark', () => {
    const blue = blocks('text-blue-700');
    expect(blue).toHaveLength(2);
    expect(blue[0]).toContain('#007AFF');
    expect(blue[1]).toContain('#0A84FF');
  });

  it('gives MEDIUM and OPEN distinct ink in both modes', () => {
    const ink = (block: string) => block.match(/^\s*color:\s*([^;]+);/m)?.[1].trim();
    const yellow = blocks('text-yellow-700');
    const blue = blocks('text-blue-700');
    expect(yellow).toHaveLength(2);
    expect(blue).toHaveLength(2);
    expect(ink(yellow[0])).toBeTruthy();
    expect(ink(yellow[0])).not.toBe(ink(blue[0]));
    expect(ink(yellow[1])).not.toBe(ink(blue[1]));
  });
});
