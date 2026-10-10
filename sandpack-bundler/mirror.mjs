/**
 * Downloads the npm packages the doc sandboxes use into
 * sandpack-bundler/registry: a small read-only npm registry that serve.mjs
 * serves at /registry, next to the bundler. With it, the code examples need
 * no network access at all.
 *
 *   node sandpack-bundler/mirror.mjs [--from http://host:port] [--list]
 *
 * Packages come from npmjs.org unless --from (or SANDPACK_MIRROR_FROM, see
 * registry.mjs) names another registry, such as a local Verdaccio.
 * --list only prints the dependency sets the sandboxes use.
 *
 * To find the exact versions to download, it installs each distinct set of
 * sandbox dependencies with npm (without running any package scripts) and
 * records every package npm installed. Each version is then stored as
 * <name>-<version>.json with its JavaScript precompiled (see prepare.mjs),
 * next to package metadata trimmed to the mirrored versions. Run it again
 * after pulling new docs.
 */

import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePackage} from './prepare.mjs';
import {getSourceRegistry} from './registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const output = join(here, 'registry');
// Built here and swapped in at the end, so a failed run keeps the old mirror.
const staging = join(here, '.registry-new');
const listOnly = process.argv.includes('--list');

// Same rules as the bundler (src/bundler/module-registry/build-dep.ts):
// build tools in a sandbox's package.json are never downloaded.
const BUILD_DEPS = new Set([
  'parcel',
  'parcel-bundler',
  'vite',
  '@babel/core',
  'react-scripts',
]);
const BUILD_DEP_REGEXES = [
  /babel-plugin.*/,
  /@babel\/plugin.*/,
  /babel-preset.*/,
  /@babel\/preset.*/,
  /.*parcel-plugin.*/,
];
const isBuildDep = (name) =>
  BUILD_DEPS.has(name) || BUILD_DEP_REGEXES.some((re) => re.test(name));

// Like the bundler's React preset, which adds these to every sandbox.
function withPresetDeps(deps) {
  const result = {...deps};
  result['react-refresh'] ??= '^0.11.0';
  result['core-js'] = '3.22.7';
  return result;
}

function collectFromDocs(dir, sets) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collectFromDocs(path, sets);
    } else if (path.endsWith('.md')) {
      const source = readFileSync(path, 'utf8');
      for (const [, json] of source.matchAll(
        /```json package\.json[^\n]*\n([\s\S]*?)```/g
      )) {
        try {
          const pkg = JSON.parse(json);
          sets.push({...pkg.dependencies, ...pkg.devDependencies});
        } catch {
          console.warn(`Skipping invalid package.json in ${path}`);
        }
      }
    }
  }
}

function collectFromTemplate(file, sets) {
  const source = readFileSync(join(root, file), 'utf8');
  const block = source.match(/dependencies:\s*\{([\s\S]*?)\}/);
  if (!block) {
    throw new Error(`No dependencies found in ${file}`);
  }
  const deps = {};
  for (const [, name, version] of block[1].matchAll(
    /['"]?([@\w/.-]+)['"]?\s*:\s*['"]([^'"]+)['"]/g
  )) {
    deps[name] = version;
  }
  sets.push(deps);
}

function collectDependencySets() {
  const rawSets = [];
  collectFromTemplate('src/components/MDX/Sandpack/template.ts', rawSets);
  collectFromTemplate('src/components/MDX/Sandpack/templateRSC.ts', rawSets);
  collectFromDocs(join(root, 'src/content'), rawSets);

  const sets = new Map();
  for (const raw of rawSets) {
    const deps = withPresetDeps(
      Object.fromEntries(
        Object.entries(raw)
          .filter(([name]) => !isBuildDep(name))
          .sort()
      )
    );
    sets.set(JSON.stringify(deps), deps);
  }
  console.log(
    `${sets.size} distinct dependency sets from ${rawSets.length} sandboxes and templates.`
  );
  return [...sets.values()];
}

const describe = (deps) =>
  Object.entries(deps)
    .map(([name, version]) => `${name}@${version}`)
    .join(' ');

// Records name@version of every package in a node_modules folder, nested ones included.
function collectInstalled(nodeModules, found) {
  if (!existsSync(nodeModules)) {
    return;
  }
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith('.')) {
      continue;
    }
    const dirs = entry.startsWith('@')
      ? readdirSync(join(nodeModules, entry)).map((name) =>
          join(nodeModules, entry, name)
        )
      : [join(nodeModules, entry)];
    for (const dir of dirs) {
      const packageJson = join(dir, 'package.json');
      if (existsSync(packageJson)) {
        const {name, version} = JSON.parse(readFileSync(packageJson, 'utf8'));
        if (name && version) {
          (found.get(name) ?? found.set(name, new Set()).get(name)).add(
            version
          );
        }
      }
      collectInstalled(join(dir, 'node_modules'), found);
    }
  }
}

function install(deps, dir, registry) {
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({name: 'mirror', private: true, dependencies: deps})
  );
  // One command string: getSourceRegistry() only allows URLs, and a shell is
  // needed on Windows to run npm.cmd.
  const command = `npm install "--registry=${registry}" --ignore-scripts --no-audit --no-fund --package-lock=false --loglevel=error`;
  const options = {cwd: dir, shell: true, encoding: 'utf8'};
  if (spawnSync(command, options).status === 0) {
    return true;
  }
  // Some sandboxes pair a React prerelease with a library whose peer range
  // excludes it, which npm only accepts with --force.
  const result = spawnSync(`${command} --force`, options);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    return false;
  }
  return true;
}

async function fetchOk(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response;
}

function checkIntegrity(bytes, dist, label) {
  const sri = dist.integrity?.split(/\s+/).find((s) => s.startsWith('sha512-'));
  if (sri) {
    const actual =
      'sha512-' + createHash('sha512').update(bytes).digest('base64');
    if (actual !== sri) {
      throw new Error(`Integrity check failed for ${label}`);
    }
  } else if (dist.shasum) {
    if (createHash('sha1').update(bytes).digest('hex') !== dist.shasum) {
      throw new Error(`Checksum failed for ${label}`);
    }
  }
}

// Writes one package: each version prepared for the bundler, and a packument
// trimmed to those versions.
async function mirrorPackage(name, versions, registry, target) {
  const packument = await (
    await fetchOk(`${registry}/${name.replace('/', '%2f')}`, {
      headers: {Accept: 'application/json'},
    })
  ).json();

  const dir = join(target, ...name.split('/'));
  mkdirSync(join(dir, '-'), {recursive: true});
  const basename = name.split('/').pop();
  const kept = {};
  for (const version of versions) {
    const meta = packument.versions?.[version];
    if (!meta?.dist?.tarball) {
      throw new Error(`${name}@${version} is not in ${registry}`);
    }
    // Some registries advertise a host only they can reach (Verdaccio
    // without `url_prefix` says localhost), so keep the path and use ours.
    const tarball = new URL(meta.dist.tarball);
    const source = new URL(registry);
    tarball.protocol = source.protocol;
    tarball.host = source.host;
    const bytes = Buffer.from(await (await fetchOk(tarball)).arrayBuffer());
    checkIntegrity(bytes, meta.dist, `${name}@${version}`);
    const {failed, ...prepared} = preparePackage(bytes, `${name}@${version}`);
    if (failed) {
      console.warn(
        `  ${name}@${version}: ${failed} file(s) couldn't be precompiled; the browser will transpile them`
      );
    }
    writeFileSync(
      join(dir, '-', `${basename}-${version}.json`),
      JSON.stringify(prepared)
    );

    kept[version] = {
      name,
      version,
      dependencies: meta.dependencies,
      optionalDependencies: meta.optionalDependencies,
      peerDependencies: meta.peerDependencies,
      peerDependenciesMeta: meta.peerDependenciesMeta,
    };
  }

  const distTags = Object.fromEntries(
    Object.entries(packument['dist-tags'] ?? {}).filter(([, v]) => kept[v])
  );
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({name, 'dist-tags': distTags, versions: kept})
  );
}

async function main() {
  const sets = collectDependencySets();
  if (listOnly) {
    for (const deps of sets) {
      console.log('-', describe(deps));
    }
    return;
  }

  const registry = getSourceRegistry();
  console.log(`Downloading from ${registry}\n`);

  const work = mkdtempSync(join(tmpdir(), 'sandpack-mirror-'));
  try {
    const found = new Map();
    const failed = [];
    sets.forEach((deps, i) => {
      console.log(`[${i + 1}/${sets.length}] ${describe(deps)}`);
      const dir = join(work, String(i));
      if (install(deps, dir, registry)) {
        collectInstalled(join(dir, 'node_modules'), found);
      } else {
        failed.push(describe(deps));
      }
    });
    if (failed.length) {
      throw new Error(
        `npm install failed for ${failed.length} set(s):\n- ${failed.join(
          '\n- '
        )}`
      );
    }

    rmSync(staging, {recursive: true, force: true});
    const names = [...found.keys()].sort();
    let count = 0;
    for (let i = 0; i < names.length; i += 8) {
      await Promise.all(
        names.slice(i, i + 8).map(async (name) => {
          await mirrorPackage(name, found.get(name), registry, staging);
          count += found.get(name).size;
        })
      );
    }

    rmSync(output, {recursive: true, force: true});
    renameSync(staging, output);
    console.log(
      `\nMirrored ${count} versions of ${names.length} packages into sandpack-bundler/registry.`
    );
  } finally {
    rmSync(work, {recursive: true, force: true});
    rmSync(staging, {recursive: true, force: true});
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
