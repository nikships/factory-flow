import { rmSync } from 'node:fs';

// TypeScript leaves outputs for deleted source files behind. Never ship an earlier runtime.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
