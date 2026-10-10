/**
 * Turns an npm tarball into the package format the patched bundler loads
 * (see bundler.patch): the package's files with JavaScript already compiled
 * to CommonJS, and the require() specifiers of each JavaScript file.
 *
 * This does in Node, once, what the browser would otherwise do for every
 * sandbox with Babel, which is too slow for large files such as react-dom.
 * It uses the Babel packages react.dev already depends on.
 */

import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const require = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
);
const babel = require('@babel/core');
const {parse} = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const commonjsPlugin = require.resolve(
  '@babel/plugin-transform-modules-commonjs'
);

// Only files a sandbox can load. Docs, type definitions, source maps and
// binary files are left out.
const KEEP = /\.(c|m)?jsx?$|\.json$|\.css$/;
const JS = /\.(c|m)?jsx?$/;

function readString(bytes, start, length) {
  let end = start;
  while (end < start + length && bytes[end] !== 0) {
    end++;
  }
  return bytes.toString('utf8', start, end);
}

/** The regular files of a .tgz, without the top-level folder (usually `package/`). */
function untar(tgz) {
  const bytes = gunzipSync(tgz);
  const files = new Map();
  let offset = 0;
  let longPath = null;

  while (offset + 512 <= bytes.length) {
    const name = readString(bytes, offset, 100);
    if (!name) {
      break;
    }
    const size = parseInt(readString(bytes, offset + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(bytes[offset + 156]);
    const prefix = readString(bytes, offset + 257, 6).startsWith('ustar')
      ? readString(bytes, offset + 345, 155)
      : '';
    const data = bytes.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      // PAX header: a long path is stored as "<length> path=<path>\n".
      const match = data.toString('utf8').match(/\d+ path=([^\n]*)\n/);
      longPath = match ? match[1] : longPath;
      continue;
    }
    if (type === 'L') {
      longPath = readString(data, 0, size);
      continue;
    }
    if (type === 'g') {
      continue;
    }

    const path = longPath ?? (prefix ? `${prefix}/${name}` : name);
    longPath = null;
    if (type === '0' || type === '\0' || type === '7') {
      files.set(path.replace(/^\.?\/?[^/]+\//, ''), data);
    }
  }
  return files;
}

function parseScript(code) {
  const options = {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: false,
  };
  try {
    return parse(code, options);
  } catch {
    // A few packages ship JSX in .js files.
    return parse(code, {...options, plugins: ['jsx']});
  }
}

/** Compiles a file to CommonJS and lists its require() specifiers, or returns null if it can't. */
function compile(code, filename) {
  let ast;
  try {
    ast = parseScript(code);
  } catch {
    return null;
  }

  if (ast.program.sourceType === 'module') {
    const result = babel.transformFromAstSync(ast, code, {
      filename,
      babelrc: false,
      configFile: false,
      sourceType: 'module',
      plugins: [commonjsPlugin],
      ast: true,
      code: true,
    });
    code = result.code;
    ast = result.ast;
  }

  const deps = new Set();
  traverse(ast, {
    CallExpression(path) {
      const {callee, arguments: args} = path.node;
      if (
        callee.type !== 'Identifier' ||
        callee.name !== 'require' ||
        path.scope.hasBinding('require')
      ) {
        return;
      }
      const arg = args[0];
      if (arg?.type === 'StringLiteral') {
        deps.add(arg.value);
      } else if (arg?.type === 'TemplateLiteral' && !arg.expressions.length) {
        deps.add(arg.quasis[0].value.cooked);
      }
    },
  });
  return {code, deps: [...deps]};
}

/**
 * @returns {{files: Record<string, string>, deps: Record<string, string[]>}}
 * `deps` has an entry for every JavaScript file that compiled. Files without
 * one are transpiled by the bundler in the browser, as before.
 */
export function preparePackage(tgz, label) {
  const files = {};
  const deps = {};
  let failed = 0;
  for (const [path, data] of untar(tgz)) {
    if (!KEEP.test(path)) {
      continue;
    }
    const content = data.toString('utf8');
    files[path] = content;
    if (JS.test(path)) {
      const compiled = compile(content, `${label}/${path}`);
      if (compiled) {
        files[path] = compiled.code;
        deps[path] = compiled.deps;
      } else {
        failed++;
      }
    }
  }
  return {files, deps, failed};
}
