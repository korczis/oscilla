# spike/gl (Y001, never merged)

Throwaway measurement code for plan issue Y001 on the branch `spike/gl-views`. Nothing here is
built, shipped or imported by `src/`; the branch is never opened for merge. The numbers go to
ADR 0016 (`### <date>: where WebGL pays`) and the curated record `webgl-in-the-gate-browsers`.

Run from the worktree root. Each script writes JSON to `--out <dir>` and records
`os.loadavg()` beside every timing (timings on a loaded machine are inflated).

| Script | What | Command |
| --- | --- | --- |
| `probe.cjs` + `probe.html` | WebGL capabilities and the live-context limit per browser and mode | `node spike/gl/probe.cjs --out <dir>` |
| `bench.cjs` + `backends.html` + `backends/*.js` | raw WebGL, p5 WEBGL, Canvas 2D: main-thread time, readback-synced time, draw calls, bytes allocated per frame (chromium) | `node spike/gl/bench.cjs --out <dir>` |
| `gzip.cjs` | minified + gzip -9 cost of each backend module, standalone and inside dist; p5 WEBGL presence | `node spike/gl/gzip.cjs --out <dir>` |
| `uplot-spectrum.cjs` | the live spectrum's uPlot sync + paint time per frame in dist/index.html | `node spike/gl/uplot-spectrum.cjs --out <dir>` |

Options: `--browsers chromium,firefox,webkit`; probe `--modes headless,headed` (headed only on
darwin) and `--max-contexts 64`; bench `--modes`, `--backends raw-gl,p5gl,canvas2d`,
`--scenes ring,xy`, `--frames 300`, `--warm 60`, `--sampling-interval 1024`; uplot `--dpr 1,2`.

linux-x64 legs (the CI image, emulated on Apple silicon: capabilities are meaningful, timings
are not). Dependencies go into a container volume, never into the mounted tree:

```sh
docker volume create oscilla-y001-deps
docker run --rm --platform linux/amd64 -v oscilla-y001-deps:/deps -w /deps \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  sh -c 'npm init -y >/dev/null && npm i --no-audit --no-fund playwright@1.63.0 p5@1.11.3'
docker volume create oscilla-y001-out
docker run --rm --platform linux/amd64 --ipc=host \
  -v "$PWD":/work:ro -v oscilla-y001-deps:/deps:ro -v oscilla-y001-out:/out \
  -e NODE_PATH=/deps/node_modules -w /work mcr.microsoft.com/playwright:v1.63.0-noble \
  node spike/gl/probe.cjs --out /out --commit "$(git rev-parse HEAD)"
docker run --rm -v oscilla-y001-out:/out alpine tar -C /out -cf - . | tar -C <dir> -xf -
```
