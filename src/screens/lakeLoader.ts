import { lakeReady, lakeData, setLakeData, setLakeRoads, LAKE_MAPS, type LakeMapId, type RoadLine } from '../domain';

const loading = new Map<LakeMapId, Promise<void>>();
/** Load a Lake District map (public/assets/lakedistrict): an RGB image read back through a canvas (no alpha, so the values come out exactly). Only one map is held at a time: loading another replaces it. */
export function loadLakeDistrict(map: LakeMapId = 'lakes'): Promise<void> {
  if (lakeReady(map)) return Promise.resolve();
  let p = loading.get(map);
  if (!p) {
    const def = LAKE_MAPS[map];
    p = (async () => {
      const [meta, img, roads] = await Promise.all([
        fetch(`/assets/lakedistrict/${def.json}`).then(r => r.json() as Promise<{ w: number; h: number; credits: string }>),
        new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('lake map')); i.src = `/assets/lakedistrict/${def.png}`; }),
        fetch('/assets/lakedistrict/roads.json').then(r => (r.ok ? (r.json() as Promise<Partial<Record<LakeMapId, RoadLine[]>>>) : ({} as Partial<Record<LakeMapId, RoadLine[]>>))).catch(() => ({} as Partial<Record<LakeMapId, RoadLine[]>>)),   // (the real roads: without them the map keeps its stand-in ones)
      ]);
      if (roads[map]) setLakeRoads(map, roads[map]!);
      const cv = document.createElement('canvas'); cv.width = meta.w; cv.height = meta.h;
      const c = cv.getContext('2d', { willReadFrequently: true })!; c.drawImage(img, 0, 0);
      setLakeData(meta.w, meta.h, c.getImageData(0, 0, meta.w, meta.h).data, meta.credits, map);
      overview = null;
    })().catch(e => { loading.delete(map); throw e; });
    loading.set(map, p);
  }
  return p;
}

let overview: HTMLCanvasElement | null = null;
/** The whole Lake District drawn once, one pixel per tile: water, and the land tinted by height with the light from the north-west, so the minimap can show it all and where you are. */
export function lakeOverview(): HTMLCanvasElement | null {
  const d = lakeData();
  if (!d) return null;
  if (overview) return overview;
  const cv = document.createElement('canvas'); cv.width = d.w; cv.height = d.h;
  const g = cv.getContext('2d')!, img = g.createImageData(d.w, d.h), px = img.data;
  const ramp: [number, number, number, number][] = [[0, 70, 120, 50], [150, 96, 140, 58], [350, 150, 150, 80], [600, 170, 140, 100], [800, 200, 190, 175], [1000, 245, 245, 245]];   // metres -> colour
  const col = (m: number): [number, number, number] => {
    for (let i = 1; i < ramp.length; i++) if (m <= ramp[i][0] || i === ramp.length - 1) { const a = ramp[i - 1], b = ramp[i], k = Math.max(0, Math.min(1, (m - a[0]) / (b[0] - a[0]))); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k]; }
    return [255, 255, 255];
  };
  for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
    const i = y * d.w + x, o = i * 4, w = d.water[i];
    if (w === 1) { px[o] = 30; px[o + 1] = 100; px[o + 2] = 170; px[o + 3] = 255; continue; }
    if (w === 2) { px[o] = 70; px[o + 1] = 140; px[o + 2] = 200; px[o + 3] = 255; continue; }
    const h = d.heightM[i], hx = d.heightM[y * d.w + Math.min(d.w - 1, x + 1)] - d.heightM[y * d.w + Math.max(0, x - 1)], hy = d.heightM[Math.min(d.h - 1, y + 1) * d.w + x] - d.heightM[Math.max(0, y - 1) * d.w + x];
    const shade = Math.max(0.55, Math.min(1.35, 1 + (-hx - hy) * 0.006)), c = col(h);
    px[o] = Math.min(255, c[0] * shade); px[o + 1] = Math.min(255, c[1] * shade); px[o + 2] = Math.min(255, c[2] * shade); px[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (overview = cv);
}
