import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(dir, file), 'utf8');

describe('Responsive & table layout polish', () => {
  it('Assets search input wrapper takes basis-full on mobile so it is never crushed at 375px', () => {
    const src = read('./Assets.tsx');
    expect(src).toContain('basis-full');
    expect(src).toContain('sm:basis-56');
  });

  it('Masters UsersTab sticky action column uses an opaque surface background instead of transparent bg-inherit', () => {
    const src = read('./Masters.tsx');
    expect(src).not.toContain('sticky right-0 w-28 border-l border-edge bg-inherit');
    expect(src).toContain('sticky right-0 w-28 border-l border-edge/60 bg-surface');
  });

  it('CMDB desktop grid gives the CI table column 420px so min-w-[380px] plus panel padding fits without permanent horizontal scroll', () => {
    const src = read('./CMDB.tsx');
    expect(src).toContain('lg:grid-cols-[420px_1fr]');
  });

  it('Labels embeds the 38x21mm specification in PageHeader so no trailing paragraph overflows the desktop viewport below DataTable', () => {
    const src = read('./Labels.tsx');
    expect(src).toContain('38×21 mm');
    // No trailing <p> after <DataTable ... />
    const afterTable = src.slice(src.indexOf('<DataTable'));
    expect(afterTable).not.toContain('<p className="text-[11px] text-muted">Labels: 38×21 mm');
  });
});
