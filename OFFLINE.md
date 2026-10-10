# Offline deployment

This `offline` branch serves a copy of react.dev on a machine with no internet connection. It differs from `main` in only two ways:

- `src/styles/index.css` loads fonts from `/fonts/` on the local server instead of `https://react.dev/fonts/`.
- This file.

Keep both changes on this branch only. Never include them in a pull request to react.dev.

## What works offline

| Feature | Offline |
| --- | --- |
| Doc pages, sidebar navigation | Works |
| Site search (hosted by Algolia) | Needs internet |
| Fonts | Works (after the font fix above) |
| Most images (`public/images/`) | Works |
| A few example images from external hosts (placecats.com, archive.org, MDN) | Broken |
| YouTube embeds, external links | Needs internet |
| Running Sandpack code examples | Needs internet (code is still readable) |

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

## Checking a build

- The build output ends with a route table and no `Build error occurred`.
- Don't run `yarn dev` while building. Both write to `.next/` and the build fails with `PageNotFoundError`.
- In the browser, open DevTools → Network, filter by "Font" and reload. The `.woff2` files should load from `/fonts/...` on the local server, not from `react.dev`.
- Every build regenerates `src/components/MDX/Sandpack/sandpack-rsc/sandbox-code/src/worker-bundle.dist.js`, so it shows as modified afterward. Don't commit it.
