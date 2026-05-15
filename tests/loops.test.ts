import { describe, expect, it } from 'vitest';
import { makeLoopId, prettyProjectName, slugifyRoute } from '../src/lib/loops.ts';

describe('loops helpers', () => {
  describe('slugifyRoute', () => {
    it('returns "root" for the root route', () => {
      expect(slugifyRoute('/')).toBe('root');
    });

    it('lower-cases and dash-separates path segments', () => {
      expect(slugifyRoute('/Some/PATH/here')).toBe('some-path-here');
    });

    it('strips leading and trailing slashes', () => {
      expect(slugifyRoute('///canonical///')).toBe('canonical');
    });

    it('squashes non-alphanumeric runs into a single dash', () => {
      expect(slugifyRoute('/foo--bar__baz')).toBe('foo-bar-baz');
    });
  });

  describe('makeLoopId', () => {
    it('produces a sortable timestamp-prefixed id', () => {
      const date = new Date('2026-05-15T14:16:34.489Z');
      expect(makeLoopId('/media', date)).toBe('2026-05-15T14-16-34-489-media');
    });

    it('uses "root" for the root route', () => {
      const date = new Date('2026-05-15T00:00:00.000Z');
      expect(makeLoopId('/', date)).toBe('2026-05-15T00-00-00-000-root');
    });
  });

  describe('prettyProjectName', () => {
    it('formats the route + local date/time for human display', () => {
      // Use a constant Date so the test is timezone-stable: we read the local
      // representation of midnight UTC, which is fine — we only assert the
      // shape of the string.
      const name = prettyProjectName('/canonical', new Date(2026, 4, 15, 14, 16));
      expect(name).toBe('/canonical \u2014 2026-05-15 14:16');
    });
  });
});
