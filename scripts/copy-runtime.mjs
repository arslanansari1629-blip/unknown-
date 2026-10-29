import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'node_modules/pyodide');
const target = path.join(root, 'public/runtime');
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of ['pyodide.mjs', 'pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
  await cp(path.join(source, file), path.join(target, file));
}
console.log('Python runtime assets copied locally. No CDN is required.');
