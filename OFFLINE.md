# Offline deployment

This `offline` branch serves a copy of react.dev on a machine with no internet connection. It differs from `main` in these ways:

- `src/styles/index.css` loads fonts from `/fonts/` on the local server instead of `https://react.dev/fonts/`.
- The Sandpack code examples use a bundler and an npm package mirror served from this machine (`sandpack-bundler/`). See [Running the code examples](#running-the-code-examples).
- This file.

Keep these changes on this branch only. Never include them in a pull request to react.dev.

## What works offline

| Feature | Offline |
| --- | --- |
| Doc pages, sidebar navigation | Works |
| Site search (hosted by Algolia) | Needs internet |
| Fonts | Works (after the font fix above) |
| Most images (`public/images/`) | Works |
| A few example images from external hosts (placecats.com, archive.org, MDN) | Broken |
| YouTube embeds, external links | Needs internet |
| Running Sandpack code examples | Works with the local bundler (see below) |
| "Open in CodeSandbox" and "Open in TypeScript Playground" buttons | Need internet |

## Branch workflow

- Docs contributions: create branches from `main`.
- Offline server: `git switch offline`.
- To pick up new docs from `main`:

  ```bash
  git switch main && git pull
  git switch offline && git rebase main
  ```

  Then rebuild (see below).

## Running on Windows

Run natively on Windows rather than in WSL:

- A native Node process is reachable from other machines on the LAN. WSL 2 sits behind a virtual network and needs port proxies or mirrored networking.
- WSL doesn't start at boot. A native `yarn start` can run as a Windows service or a scheduled task.

The site needs a running Node server (`next start`), not just static files: it uses rewrites, an API route (`/api/md`) and `llms.txt`.

### Build on Windows, not on macOS

`node_modules` contains platform-specific binaries (Next's SWC compiler, `sharp`). A build made on macOS won't run on Windows, so install and build on Windows.

Installing and building need internet. Do steps 1–4 while the machine is online:

1. Install Node 24 and Git for Windows, then install Yarn:

   ```powershell
   npm install --global yarn
   ```

2. Avoid false "modified" files from line-ending conversion, then clone and switch to this branch:

   ```powershell
   git config --global core.autocrlf false
   git clone https://github.com/<you>/react.dev.git
   cd react.dev
   git switch offline
   ```

3. Install dependencies (needs internet):

   ```powershell
   yarn
   ```

4. Build (needs internet). The fonts are git-ignored, so the build downloads them into `public/fonts/` using `curl`, which is included in Windows 10 and later:

   ```powershell
   yarn build
   ```

5. Disconnect and start the server:

   ```powershell
   yarn start
   ```

   Open http://localhost:3000.

### If the target machine can never go online

Do steps 1–4 on another Windows PC with internet and the same CPU architecture (x64 or ARM). Then copy the whole `react.dev` folder, including `node_modules` and `.next`, to the offline machine and run `yarn start` there.

### Allow access from other machines

```powershell
yarn start -H 0.0.0.0
```

Allow port 3000 through Windows Firewall when prompted.

## Running the code examples

The code examples run in an iframe served by the Sandpack bundler. On react.dev the bundler comes from CodeSandbox and loads npm packages from the CodeSandbox CDN. This branch builds that bundler from source with a patch (`sandpack-bundler/bundler.patch`) and serves it, together with a mirror of the npm packages the examples use, from this machine. The examples then need no network at all.

| Part | Command | Address |
| --- | --- | --- |
| Docs | `yarn start` | port 3000 |
| Sandpack bundler and package mirror | `yarn sandpack:serve` | port 3001 of the same host name the docs are opened with |

### 1. Build the bundler (needs internet)

```powershell
yarn sandpack:build
```

This clones CodeSandbox's `sandpack-bundler` at a pinned commit into `sandpack-bundler/.src`, applies the patch and builds `sandpack-bundler/dist`. Both folders are git-ignored. Run it again only when `bundler.patch` changes.

### 2. Download the packages (needs internet or Verdaccio)

```powershell
yarn sandpack:mirror
```

This finds the npm packages every code example declares, plus the ones the bundler always adds (`react-refresh`, `core-js`), and downloads them into `sandpack-bundler/registry` (git-ignored, about 50 MB). It also compiles their JavaScript ahead of time, so browsers don't have to. It takes about a minute.

Run it again after pulling new docs from `main`, because new examples may use new packages or React versions. `yarn sandpack:mirror --list` only prints the packages.

Packages come from npmjs.org. To download them from Verdaccio instead, for example on a network without internet, pass its address:

```powershell
yarn sandpack:mirror --from http://<host>:<port>
```

or set it once in `.env.local` at the repository root (git-ignored):

```
SANDPACK_MIRROR_FROM=http://<host>:<port>
```

### 3. Start the bundler

Next to `yarn start`, in a second terminal:

```powershell
yarn sandpack:serve
```

Allow port 3001 through Windows Firewall when prompted, if other machines open the docs. To serve the bundler from another address, set it when building the docs:

```powershell
$env:NEXT_PUBLIC_SANDPACK_BUNDLER_URL = "http://<host>:<port>"
yarn build
```

### Copying to other machines

Everything the examples need is inside the `react.dev` folder: `sandpack-bundler/dist` and `sandpack-bundler/registry`, next to `node_modules` and `.next`. Copy the whole folder to another Windows machine (see [If the target machine can never go online](#if-the-target-machine-can-never-go-online)) and run `yarn start` and `yarn sandpack:serve` there.

### Troubleshooting

- `Could not load package "x"` or `No version of "x" matches` in an example: the package isn't in the mirror. Run `yarn sandpack:mirror` again.
- An example stays blank: open DevTools → Network and check that requests to port 3001 succeed. If `yarn sandpack:serve` says `sandpack-bundler/dist is missing`, run `yarn sandpack:build`.

## Checking a build

- The build output ends with a route table and no `Build error occurred`.
- Don't run `yarn dev` while building. Both write to `.next/` and the build fails with `PageNotFoundError`.
- In the browser, open DevTools → Network, filter by "Font" and reload. The `.woff2` files should load from `/fonts/...` on the local server, not from `react.dev`.
- Every build regenerates `src/components/MDX/Sandpack/sandpack-rsc/sandbox-code/src/worker-bundle.dist.js`, so it shows as modified afterward. Don't commit it.
