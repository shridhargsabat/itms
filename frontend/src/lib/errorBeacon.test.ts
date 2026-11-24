import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beaconPageUrl, reportClientError } from './errorBeacon';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
  // @ts-expect-error test cleanup: remove the stubbed sendBeacon
  delete navigator.sendBeacon;
});

describe('beaconPageUrl (Wave 2-C)', () => {
  it('strips query and hash — reset tokens never leave the browser', () => {
    window.history.replaceState({}, '', '/reset-password?token=abc123#frag');
    expect(beaconPageUrl()).toBe(`${window.location.origin}/reset-password`);
  });

  it('keeps origin+pathname intact for plain routes', () => {
    window.history.replaceState({}, '', '/assets');
    expect(beaconPageUrl()).toBe(`${window.location.origin}/assets`);
  });
});

describe('reportClientError payload', () => {
  it('stores + beacons origin+pathname only', async () => {
    window.history.replaceState({}, '', '/oauth/callback?code=S3CR3T&x=1#h');
    vi.stubEnv('VITE_ERROR_BEACON_URL', 'https://beacon.example/err');
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      configurable: true,
      writable: true,
    });

    reportClientError('error', new Error('boom'));

    // sessionStorage entry is the exact string handed to sendBeacon
    const stored = JSON.parse(sessionStorage.getItem('itms_last_error') ?? '{}') as {
      url?: string;
    };
    expect(stored.url).toBe(`${window.location.origin}/oauth/callback`);
    expect(JSON.stringify(stored)).not.toContain('S3CR3T');

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe('https://beacon.example/err');
    const blob = sendBeacon.mock.calls[0][1] as Blob;
    const text = await blob.text();
    expect(JSON.parse(text).url).toBe(`${window.location.origin}/oauth/callback`);
    expect(text).not.toContain('S3CR3T');
  });

  it('still records locally when no beacon endpoint is configured', () => {
    window.history.replaceState({}, '', '/tickets?search=secret#h');
    reportClientError('unhandledrejection', 'plain-string failure');
    const stored = JSON.parse(sessionStorage.getItem('itms_last_error') ?? '{}') as {
      url?: string;
      message?: string;
    };
    expect(stored.url).toBe(`${window.location.origin}/tickets`);
    expect(stored.message).toBe('plain-string failure');
  });
});
