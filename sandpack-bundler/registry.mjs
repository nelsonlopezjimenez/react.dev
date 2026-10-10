/**
 * The npm registry that mirror.mjs downloads packages from. In order of
 * priority:
 *
 *   1. --from http://host:port on the command line
 *   2. SANDPACK_MIRROR_FROM in the environment
 *   3. SANDPACK_MIRROR_FROM in .env.local or .env at the repository root
 *   4. https://registry.npmjs.org
 *
 * A local Verdaccio works too, for example on a network without internet.
 */

import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function getSourceRegistry() {
  // Files loaded first win; existing environment variables are never overwritten.
  for (const file of ['.env.local', '.env']) {
    const path = join(root, file);
    if (existsSync(path)) {
      process.loadEnvFile(path);
    }
  }

  const flag = process.argv.indexOf('--from');
  const registry = (
    flag > -1
      ? process.argv[flag + 1] ?? ''
      : process.env.SANDPACK_MIRROR_FROM || DEFAULT_REGISTRY
  ).replace(/\/+$/, '');

  // Strict, because mirror.mjs passes it to npm through a shell.
  if (!/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(registry)) {
    console.error(
      `Invalid registry URL "${registry}". Expected something like http://192.168.1.27:3005`
    );
    process.exit(1);
  }
  return registry;
}
