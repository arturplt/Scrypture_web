// Dev/build helper: serves /sprites.json (every image under public/assets), accepts uploads
// into public/assets/sprites/, and re-crops 9-slice frames when new *.9.png files appear.
import sharp from 'sharp';
import { readdirSync, statSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, basename } from 'node:path';
import { prepareFrames } from './prepare-frames.mjs';
import { addFrame } from './frame-collection.mjs';

const ROOT = 'public/assets';
const IMG = new Set(['.png', '.gif', '.webp', '.jpg', '.jpeg']);

function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function manifest() {
  const files = walk(ROOT).filter(p => IMG.has(extname(p).toLowerCase()));
  const out = [];
  for (const p of files) {
    let w = 0, h = 0;
    try { ({ width: w, height: h } = await sharp(p).metadata()); } catch {}
    const rel = p.slice('public'.length).replaceAll('\\', '/');
    const folder = rel.split('/').slice(2, -1).join('/') || '(root)';
    out.push({ path: rel, name: basename(p), folder, w, h, bytes: statSync(p).size });
  }
  return out.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}

export default function spritesPlugin() {
  return {
    name: 'scrypture-sprites',
    async buildStart() { await prepareFrames(() => {}); },
    configureServer(server) {
      server.watcher.add(ROOT);
      server.middlewares.use('/sprites.json', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(await manifest()));
      });
      // Vite only learns about files in public/ when it starts, so a frame generated while it runs would be answered with index.html
      // (an empty frame). Serve the generated frame images straight from disk.
      server.middlewares.use((req, res, next) => {
        const url = decodeURI((req.url || '').split('?')[0]);
        if (!/^\/assets\/frames[\w-]*\/[\w.-]+\.png$/.test(url) || !existsSync(`public${url}`)) return next();
        res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(`public${url}`));
      });
      // "Add to collection" from the frame editor / Pixelite: a 50x50 PNG becomes public/assets/raw/<name>.9.png and a Theme manager option
      server.middlewares.use('/__frames/add', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        const name = new URL(req.url, 'http://x').searchParams.get('name') || '';
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
          const r = await addFrame(name, Buffer.concat(chunks), { prepare: () => prepareFrames(() => {}) });
          res.statusCode = r.status ?? 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(r));
        });
      });
      server.middlewares.use('/__sprites/upload', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        const name = basename(new URL(req.url, 'http://x').searchParams.get('name') || '').replace(/[^\w.\-]/g, '_');
        if (!IMG.has(extname(name).toLowerCase())) { res.statusCode = 400; return res.end('images only'); }
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', async () => {
          mkdirSync(`${ROOT}/sprites`, { recursive: true });
          writeFileSync(`${ROOT}/sprites/${name}`, Buffer.concat(chunks));
          if (name.endsWith('.9.png')) await prepareFrames(() => {});
          res.end('ok');
        });
      });
    },
    async handleHotUpdate({ file }) {
      if (file.endsWith('.9.png')) await prepareFrames(() => {});
    },
    async generateBundle(_opts, bundle) {
      // Service worker: precache the app shell + every sprite the app can draw (not dev-only folders / raw 9-slice sources)
      const skip = /\/(atlas|sprites)\/|\.9\.png$/;
      const files = walk(ROOT).map(p => '/' + p.slice('public/'.length).replaceAll('\\', '/')).filter(u => !skip.test(u));
      const precache = ['/', '/manifest.webmanifest', ...walk('public/icons').map(p => '/' + p.slice('public/'.length)), ...Object.keys(bundle).map(n => '/' + n), ...files]
        .filter((u, i, a) => u !== '/index.html' && a.indexOf(u) === i);
      const version = createHash('sha1').update(precache.join('|')).digest('hex').slice(0, 10);
      const src = readFileSync('scripts/sw-template.js', 'utf8').replaceAll('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}
