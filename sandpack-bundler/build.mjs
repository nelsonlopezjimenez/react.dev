/**
 * Builds the Sandpack bundler for offline use.
 *
 * It checks out CodeSandbox's sandpack-bundler at a pinned commit, applies
 * bundler.patch and builds it into sandpack-bundler/dist. The patch makes the
 * bundler load npm packages from /registry on its own server (the mirror that
 * mirror.mjs creates) instead of the CodeSandbox CDN and unpkg.
 *
 *   node sandpack-bundler/build.mjs
 *
 * Needs git, yarn and internet access.
 */

import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = 'https://github.com/codesandbox/sandpack-bundler.git';
const COMMIT = 'a323f46fd38442bb2dbc76fecd262e1435aca5bd';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '.src');

// Arguments are fixed relative paths without spaces, so they can be joined
// into one command for the shell (needed on Windows to run yarn.cmd).
function run(cmd, args, cwd) {
  const command = `${cmd} ${args.join(' ')}`;
  console.log(`> ${command}`);
  const result = spawnSync(command, {cwd, stdio: 'inherit', shell: true});
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(src)) {
  // Keep LF line endings so bundler.patch applies on Windows too.
  run('git', ['clone', '-c', 'core.autocrlf=false', REPO, '.src'], here);
}
const hasCommit =
  spawnSync('git', ['cat-file', '-e', `${COMMIT}^{commit}`], {cwd: src})
    .status === 0;
if (!hasCommit) {
  run('git', ['fetch', '--quiet', 'origin'], src);
}
run('git', ['checkout', '--quiet', '--force', '--detach', COMMIT], src);
// Remove files added by a previous run of the patch. Ignored files such as
// node_modules stay, so rebuilding doesn't reinstall everything.
run('git', ['clean', '--quiet', '-d', '--force'], src);
// The bundler's sources have LF line endings. A checkout with
// core.autocrlf=true may give the patch CRLF ones, so normalize it first.
console.log('> git apply ../bundler.patch');
const patch = readFileSync(join(here, 'bundler.patch'), 'utf8').replace(
  /\r\n/g,
  '\n'
);
const applied = spawnSync('git', ['apply', '-'], {
  cwd: src,
  input: patch,
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (applied.status !== 0) {
  process.exit(applied.status ?? 1);
}

run('yarn', ['install', '--frozen-lockfile', '--ignore-scripts'], src);

// Parcel's cache assumes its earlier output is still in dist and only writes
// changed bundles, so clear both or dist ends up incomplete.
rmSync(join(here, 'dist'), {recursive: true, force: true});
rmSync(join(src, '.parcel-cache'), {recursive: true, force: true});
run(
  'yarn',
  [
    'parcel',
    'build',
    'src/index.html',
    '--no-scope-hoist',
    '--dist-dir',
    '../dist',
  ],
  src
);

console.log('\nBuilt sandpack-bundler/dist.');
console.log(
  'Next: yarn sandpack:mirror (downloads the packages), then yarn sandpack:serve'
);
