import { describe, expect, it } from 'vitest';
import {
  defineConfig,
  getDefaultDesignSystem,
  getDesignSystems,
  withDefaults,
} from '../src/config.ts';

describe('config helpers', () => {
  describe('getDesignSystems', () => {
    it('wraps a single ref in an array', () => {
      const config = defineConfig({
        framework: 'svelte',
        devUrl: 'http://localhost',
        routesDir: 'src/routes',
        designSystem: { name: 'Solo', id: 'a' },
      });
      expect(getDesignSystems(config)).toEqual([{ name: 'Solo', id: 'a' }]);
    });

    it('passes an array through unchanged', () => {
      const config = defineConfig({
        framework: 'svelte',
        devUrl: 'http://localhost',
        routesDir: 'src/routes',
        designSystem: [
          { name: 'A', id: '1' },
          { name: 'B', id: '2' },
        ],
      });
      expect(getDesignSystems(config)).toHaveLength(2);
    });
  });

  describe('getDefaultDesignSystem', () => {
    it('returns the only ref when given a single', () => {
      const config = defineConfig({
        framework: 'svelte',
        devUrl: 'http://localhost',
        routesDir: 'src/routes',
        designSystem: { name: 'Solo', id: 'a' },
      });
      expect(getDefaultDesignSystem(config).name).toBe('Solo');
    });

    it('returns the first ref when given an array', () => {
      const config = defineConfig({
        framework: 'svelte',
        devUrl: 'http://localhost',
        routesDir: 'src/routes',
        designSystem: [
          { name: 'First', id: '1' },
          { name: 'Second', id: '2' },
        ],
      });
      expect(getDefaultDesignSystem(config).name).toBe('First');
    });
  });

  describe('withDefaults', () => {
    it('fills in defaults when not provided', () => {
      const config = defineConfig({
        framework: 'svelte',
        devUrl: 'http://localhost',
        routesDir: 'src/routes',
        designSystem: { name: 'Solo' },
      });
      const resolved = withDefaults(config);
      expect(resolved.loopsDir).toBe('design-loops');
      expect(resolved.breakpoints).toEqual([1280, 768, 375]);
      expect(resolved.settleMs).toBe(3000);
      expect(resolved.excludeRoutes).toEqual([]);
      expect(resolved.contextSources).toEqual([]);
    });

    it('preserves explicit values', () => {
      const config = defineConfig({
        framework: 'svelte',
        devUrl: 'http://localhost',
        routesDir: 'src/routes',
        designSystem: { name: 'Solo' },
        loopsDir: 'custom-loops',
        breakpoints: [1920],
        excludeRoutes: ['/admin'],
      });
      const resolved = withDefaults(config);
      expect(resolved.loopsDir).toBe('custom-loops');
      expect(resolved.breakpoints).toEqual([1920]);
      expect(resolved.excludeRoutes).toEqual(['/admin']);
    });

    it('does not mutate the input', () => {
      const config = defineConfig({
        framework: 'svelte',
        devUrl: 'http://localhost',
        routesDir: 'src/routes',
        designSystem: { name: 'Solo' },
      });
      const before = JSON.stringify(config);
      withDefaults(config);
      expect(JSON.stringify(config)).toBe(before);
    });
  });
});
