/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Offline builds serve their own Sandpack bundler (see sandpack-bundler/ and
// OFFLINE.md). By default it runs on port 3001 of the host the docs were
// opened from, so it works from any machine on the network.
const BUNDLER_PORT = 3001;

export function getBundlerURL(): string | undefined {
  if (process.env.NEXT_PUBLIC_SANDPACK_BUNDLER_URL) {
    return process.env.NEXT_PUBLIC_SANDPACK_BUNDLER_URL;
  }
  if (typeof window === 'undefined') {
    return undefined;
  }
  return `${window.location.protocol}//${window.location.hostname}:${BUNDLER_PORT}`;
}
