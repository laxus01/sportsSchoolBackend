import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const roots = ['src', 'scripts', 'test'];
const files = [];

async function collectJavaScriptFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectJavaScriptFiles(path);
    } else if (entry.isFile() && path.endsWith('.js')) {
      files.push(path);
    }
  }
}

for (const root of roots) await collectJavaScriptFiles(root);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.info(`Syntax checked ${files.length} JavaScript files.`);
