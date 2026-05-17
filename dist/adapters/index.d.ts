import { F as Framework, A as Adapter } from '../types-CtrgrBZ8.js';

/**
 * Adapter registry. To add a framework: write `<name>.ts` exporting an
 * Adapter, then add it to the registry below.
 */

declare function getAdapter(framework: Framework): Adapter;

export { Adapter, getAdapter };
