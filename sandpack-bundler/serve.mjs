/**
 * Serves the Sandpack bundler for offline use: the built bundler
 * (sandpack-bundler/dist) and, at /registry, the npm package mirror the
 * bundler loads packages from (sandpack-bundler/registry).
 *
 *   node sandpack-bundler/serve.mjs [--port 3001] [--host 0.0.0.0]
 *
 * The docs expect it on port 3001 of the same host name the docs are opened
 * with, unless NEXT_PUBLIC_SANDPACK_BUNDLER_URL was set when building them.
 */

import {createReadStream, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {dirname, extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGzip} from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const registry = join(here, 'registry');

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const port = Number(flag('--port', process.env.PORT || 3001));
const host = flag('--host', '0.0.0.0');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function fileAt(base, relativePath) {
  const file = resolve(base, '.' + relativePath);
  if (!file.startsWith(base + sep)) {
    return null;
  }
  try {
    return statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function exists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

if (!exists(join(dist, 'index.html'))) {
  console.error('sandpack-bundler/dist is missing. Run: yarn sandpack:build');
  process.exit(1);
}
if (!exists(registry)) {
  console.warn(
    'sandpack-bundler/registry is missing, so code examples will fail to load packages. Run: yarn sandpack:mirror'
  );
}

// Requests under /registry/ follow the npm registry layout:
//   /registry/<name>                        package metadata (<name>/index.json)
//   /registry/<name>/-/<name>-<version>.json package files, precompiled (prepare.mjs)
// Scoped names arrive as @scope%2fname, which decoding turns into @scope/name.
function registryFile(pathname) {
  const path = pathname.slice('/registry'.length);
  if (path.includes('/-/')) {
    return fileAt(registry, path);
  }
  return fileAt(registry, path.replace(/\/+$/, '') + '/index.json');
}

createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  let file;
  let cacheControl;
  if (pathname.startsWith('/registry/')) {
    file = registryFile(pathname);
    if (!file) {
      res.writeHead(404, {'Content-Type': 'application/json'});
      res.end(
        JSON.stringify({error: `Not in the package mirror: ${pathname}`})
      );
      return;
    }
    // Package metadata changes when the mirror is updated; versions never do.
    cacheControl = pathname.includes('/-/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
  } else {
    // The bundler is a single-page app: unknown paths get index.html. A
    // missing script or other asset is a 404, so a broken build is visible.
    file = fileAt(dist, pathname);
    if (!file && extname(pathname) && extname(pathname) !== '.html') {
      res.writeHead(404).end();
      return;
    }
    file ??= join(dist, 'index.html');
    // Every file except index.html has a content hash in its name.
    cacheControl =
      extname(file) === '.html'
        ? 'no-cache'
        : 'public, max-age=31536000, immutable';
  }

  // Packages are large text files (react-dom is about 8 MB), so compress
  // text when the browser accepts it. It matters when many laptops load from
  // one server over Wi-Fi.
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const gzip =
    /^(text\/|application\/json)/.test(type) &&
    /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': cacheControl,
    Vary: 'Accept-Encoding',
    ...(gzip ? {'Content-Encoding': 'gzip'} : {}),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
}).listen(port, host, () => {
  console.log(`Sandpack bundler: http://${host}:${port}`);
});
