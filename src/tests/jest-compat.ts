/**
 * Pre-setup file: inject jest as a global alias for vi so that jest-canvas-mock
 * (and any other legacy jest-dependent packages) can reference it at module load time.
 *
 * This file must be listed BEFORE src/tests/setup.ts in vitest.config.ts setupFiles.
 */
import { vi } from 'vitest'

// Vitest globals:true injects these into the test scope, but side-effect imports
// like jest-canvas-mock that reference `jest` at module evaluation time need it on globalThis.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).jest = vi
