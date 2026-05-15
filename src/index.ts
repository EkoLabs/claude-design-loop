/**
 * @ekolabs/claude-design-loop
 *
 * Public API. Per-repo `.design-loop.config.ts` files import `defineConfig`
 * from here. Most callers use the CLI (`design-loop` — see README), but the
 * same primitives are exported for programmatic use (e.g. CI / custom tooling).
 */

export {
  defineConfig,
  getDefaultDesignSystem,
  getDesignSystems,
  loadConfig,
} from './config.ts';
export type {
  DesignLoopConfig,
  DesignSystemRef,
  Framework,
} from './config.ts';

export { runBrief } from './lib/brief.ts';
export { runPull } from './lib/pull.ts';
export { runApply } from './lib/apply.ts';
export { runVerify } from './lib/verify.ts';
export { runSubmit } from './lib/submit.ts';
export { runResume } from './lib/resume.ts';
export { runFetch } from './lib/fetch.ts';
export { runWizard } from './lib/wizard.ts';
export {
  loginInteractive,
  defaultAuthPaths,
  listDesignSystems,
} from './lib/claude-design.ts';
export type { DiscoveredDesignSystem } from './lib/claude-design.ts';

export type { Adapter, DiscoveredRoute } from './adapters/types.ts';
