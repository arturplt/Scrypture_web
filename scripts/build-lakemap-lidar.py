#!/usr/bin/env python3
"""Builds a high-resolution regional map for the game from Environment Agency LiDAR (1 m DTM), e.g. Coniston at 10 m per tile.
Writes <out_dir>/<name>.png (RGB: R,G = height in decimetres, B = water class 0 land / 1 lake or sea / 2 river) and <out_dir>/<name>.json.

Data (c) Environment Agency, Open Government Licence: "LIDAR Composite Digital Terrain Model 1m" (WCS, fetched in 1 km squares and averaged down).
Water (c) OpenStreetMap contributors, ODbL (an Overpass `out geom` dump saved as water.json, see WATER_QUERY in build-lakedistrict.py for the shape).

Usage:  python3 scripts/build-lakemap-lidar.py <name> <water.json> <out_dir>      (needs: numpy, pillow, rasterio)
The region is set below (British National Grid metres, a multiple of 1 km on the east and north edges).
"""
import io, json, math, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageDraw
from rasterio.io import MemoryFile
from rasterio.warp import transform, transform_bounds

NAME, WATER, OUT = sys.argv[1], sys.argv[2], sys.argv[3].rstrip('/')
E0, N1 = 323000, 501000            # north-west corner (E, N)
TILE_M = 10                        # metres per tile
GW, GH = 1400, 1500                # tiles: 14 km east-west, 15 km north-south
E1, N0 = E0 + GW * TILE_M, N1 - GH * TILE_M
COV = '13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m'
URL = ('https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs?service=WCS&version=2.0.1&request=GetCoverage'
       f'&coverageId={COV}&format=image/tiff&subset=E({{e0}},{{e1}})&subset=N({{n0}},{{n1}})')
K = 1000 // TILE_M                  # tiles per 1 km square

import os
CACHE = os.environ.get('LIDAR_CACHE')      # a .npy file: the averaged heights are kept here so a rerun (changing only the water, say) does not fetch them again
height = np.full((GH, GW), np.nan, np.float32)

def fetch(job):
    ci, cj = job                       # square column / row (row 0 is the northernmost)
    e0, n1 = E0 + ci * 1000, N1 - cj * 1000
    url = URL.format(e0=e0, e1=e0 + 1000, n0=n1 - 1000, n1=n1)
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'scrypture-dev'})
            raw = urllib.request.urlopen(req, timeout=90).read()
            with MemoryFile(raw) as mf, mf.open() as ds:
                a = ds.read(1).astype(np.float32)
                nd = ds.nodata
            if nd is not None: a[a == nd] = np.nan
            a[(a < -50) | (a > 1500)] = np.nan
            if a.shape != (1000, 1000): return ci, cj, None
            with np.errstate(all='ignore'):
                return ci, cj, np.nanmean(a.reshape(K, TILE_M, K, TILE_M), axis=(1, 3))
        except Exception as ex:
            time.sleep(2 * (attempt + 1))
    return ci, cj, None

jobs = [(ci, cj) for cj in range(GH // K) for ci in range(GW // K)]
done = 0
if CACHE and os.path.exists(CACHE):
    height[:] = np.load(CACHE)       # (a square the service failed to give is all no-data: fetch just those again)
    jobs = [(ci, cj) for ci, cj in jobs if np.isnan(height[cj * K:(cj + 1) * K, ci * K:(ci + 1) * K]).all()]
    print('refetching', len(jobs), 'missing squares', flush=True)
with ThreadPoolExecutor(2) as ex:
    for ci, cj, a in ex.map(fetch, jobs):
        done += 1
        if a is not None: height[cj * K:(cj + 1) * K, ci * K:(ci + 1) * K] = a
        if done % 20 == 0: print('fetched', done, '/', len(jobs), flush=True)

if CACHE and (not os.path.exists(CACHE) or jobs): np.save(CACHE, height)
nodata = np.isnan(height)
print('no-data tiles', int(nodata.sum()), 'of', GW * GH, flush=True)

# lon/lat -> tile (BNG metres first)
def tiles_of(lonlat):
    lons, lats = zip(*lonlat)
    es, ns = transform('EPSG:4326', 'EPSG:27700', lons, lats)
    return [((e - E0) / TILE_M, (N1 - n) / TILE_M) for e, n in zip(es, ns)]

osm = json.load(open(WATER))['elements']
water = np.zeros((GH, GW), np.uint8)
rivers = []
nlakes = 0

def fill(rings_out, rings_in):
    pts = [p for r in rings_out for p in r]
    if not pts: return None
    x0, y0 = max(0, int(min(p[0] for p in pts)) - 1), max(0, int(min(p[1] for p in pts)) - 1)
    x1, y1 = min(GW, int(max(p[0] for p in pts)) + 2), min(GH, int(max(p[1] for p in pts)) + 2)
    if x1 <= x0 or y1 <= y0: return None
    im = Image.new('1', (x1 - x0, y1 - y0), 0); d = ImageDraw.Draw(im)
    for r in rings_out: d.polygon([(x - x0, y - y0) for x, y in r], fill=1)
    for r in rings_in: d.polygon([(x - x0, y - y0) for x, y in r], fill=0)
    return np.array(im, bool), x0, y0

def stitch(ways):
    segs = [list(w) for w in ways if len(w) > 1]; rings = []
    while segs:
        cur = segs.pop()
        while cur[0] != cur[-1]:
            for i, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]
                elif s[-1] == cur[-1]: cur += s[::-1][1:]
                elif s[-1] == cur[0]: cur = s + cur[1:]
                elif s[0] == cur[0]: cur = s[::-1] + cur[1:]
                else: continue
                segs.pop(i); break
            else: break
        if cur[0] == cur[-1] and len(cur) > 3: rings.append(cur)
    return rings

def geom(g): return tiles_of([(p['lon'], p['lat']) for p in g])

def add_lake(f):
    global nlakes
    if f is None: return
    m, x0, y0 = f
    if m.sum() < 3: return
    hs, ns_, ws = height[y0:y0 + m.shape[0], x0:x0 + m.shape[1]], nodata[y0:y0 + m.shape[0], x0:x0 + m.shape[1]], water[y0:y0 + m.shape[0], x0:x0 + m.shape[1]]
    valid = m & ~ns_
    level = float(np.median(hs[valid])) if valid.sum() else float(np.nanmin(height)) if not np.isnan(height).all() else 0.0
    hs[m] = level; ws[m] = 1; nlakes += 1

for e in osm:
    tags = e.get('tags', {})
    if e['type'] == 'way' and tags.get('natural') == 'water' and 'geometry' in e:
        g = geom(e['geometry'])
        if len(g) > 3 and g[0] == g[-1]: add_lake(fill([g], []))
    elif e['type'] == 'relation' and tags.get('natural') == 'water':
        outer = [geom(m['geometry']) for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
        inner = [geom(m['geometry']) for m in e.get('members', []) if m.get('role') == 'inner' and 'geometry' in m]
        add_lake(fill(stitch(outer), stitch(inner)))
    elif e['type'] == 'way' and (tags.get('waterway') == 'river' or (tags.get('waterway') == 'stream' and tags.get('name'))) and 'geometry' in e:   # (only rivers and named becks: every little unnamed stream drew a sand-edged ribbon)
        rivers.append(geom(e['geometry']))

# left-over no-data (outside the lidar's coverage): the nearest valid height, else 0
if nodata.any():
    height[np.isnan(height)] = np.nan
    good = ~np.isnan(height)
    if good.any():
        for _ in range(60):                       # grow the valid area a ring at a time
            if good.all(): break
            pad = np.pad(height, 1, constant_values=np.nan)
            acc = np.zeros_like(height); cnt = np.zeros_like(height)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nb = pad[1 + dy:1 + dy + GH, 1 + dx:1 + dx + GW]; v = ~np.isnan(nb); acc += np.where(v, nb, 0); cnt += v
            fillm = ~good & (cnt > 0)
            height[fillm] = acc[fillm] / cnt[fillm]; good |= fillm
    height[np.isnan(height)] = 0

# rivers: a one-tile line, cut a little into the ground
im = Image.new('L', (GW, GH), 0); d = ImageDraw.Draw(im)
for r in rivers: d.line(r, fill=255, width=1)
rv = (np.array(im) > 0) & (water == 0)
water[rv] = 2
height[rv] = np.maximum(0, height[rv] - 1.5)

dm = np.clip(np.round(height * 10), 0, 65535).astype(np.uint16)
rgb = np.stack([(dm >> 8).astype(np.uint8), (dm & 255).astype(np.uint8), water], axis=-1)
Image.fromarray(rgb, 'RGB').save(f'{OUT}/{NAME}.png', optimize=True)

# lon/lat -> tile (centred on the middle of the grid) as an affine fit, so the app needs no projection code
pts = [(E0 + GW * TILE_M * fx, N1 - GH * TILE_M * fy) for fx in (0, .5, 1) for fy in (0, .5, 1)]
lon, lat = transform('EPSG:27700', 'EPSG:4326', [p[0] for p in pts], [p[1] for p in pts])
tx = [(p[0] - E0) / TILE_M - GW / 2 for p in pts]; ty = [(N1 - p[1]) / TILE_M - GH / 2 for p in pts]
A = np.column_stack([lon, lat, np.ones(len(pts))])
cx, *_ = np.linalg.lstsq(A, np.array(tx), rcond=None); cy, *_ = np.linalg.lstsq(A, np.array(ty), rcond=None)
corner_w, corner_s, corner_e, corner_n = transform_bounds('EPSG:27700', 'EPSG:4326', E0, N0, E1, N1)
json.dump({'name': NAME, 'w': GW, 'h': GH, 'tileM': TILE_M, 'bbox': [corner_w, corner_s, corner_e, corner_n], 'maxH': float(height.max()),
           'affine': [float(v) for v in (*cx, *cy)], 'unit': 'decimetres in R*256+G', 'water': 'B: 0 land, 1 lake or sea, 2 river',
           'credits': 'Contains Environment Agency LiDAR data, Open Government Licence v3. Water (c) OpenStreetMap contributors (ODbL).'},
          open(f'{OUT}/{NAME}.json', 'w'), indent=1)
print('done', GW, GH, 'max height m', float(height.max()), 'lakes', nlakes, 'rivers', len(rivers), 'water px', int((water > 0).sum()), flush=True)
