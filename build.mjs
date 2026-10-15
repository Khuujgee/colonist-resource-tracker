import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/content.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'dist/content.js',
});
await copyFile('manifest.json', 'dist/manifest.json');
console.log('Built dist/ — load it in edge://extensions with "Load unpacked".');
