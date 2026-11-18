#!/usr/bin/env python3
"""Builds public/assets/lakedistrict/{lakedistrict.png,meta.json}: the English Lake District as a game grid (1 tile = 50 m).

Data (run once, commit the output, not the inputs):
  - elevation: Copernicus GLO-30 DEM, read straight from the public COG tiles (only the window needed is fetched)
  - water: OpenStreetMap, an Overpass `out geom` dump saved as water.json (see WATER_QUERY below)  (c) OpenStreetMap contributors, ODbL
  - Contains Copernicus DEM data (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.

Usage:  python3 scripts/build-lakedistrict.py <water.json> <out_dir>      (needs: numpy, pillow, rasterio)

The PNG is 8-bit RGB (so a canvas reads it back exactly): R,G = height in decimetres (R high byte); B = water class (0 land, 1 lake or sea, 2 river).
"""
import json, sys, math
import numpy as np
from PIL import Image, ImageDraw
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import reproject, Resampling
from rasterio.enums import Resampling as R

WATER_QUERY = '''[out:json][timeout:180];(way["natural"="water"](54.00,-3.70,54.80,-2.60);relation["natural"="water"](54.00,-3.70,54.80,-2.60);way["waterway"="river"](54.00,-3.70,54.80,-2.60);way["natural"="coastline"](53.95,-3.75,54.85,-2.55););out geom;'''
W0, E0, S0, N0 = -3.70, -2.60, 54.00, 54.80   # west of Whitehaven, south to Lancaster and Morecambe Bay, east to the M6, north past Caldbeck
TILE_M = 50.0
mid = (S0 + N0) / 2
KM_LON, KM_LAT = 111.32 * math.cos(math.radians(mid)), 110.57
GW, GH = round((E0 - W0) * KM_LON * 1000 / TILE_M), round((N0 - S0) * KM_LAT * 1000 / TILE_M)
DX, DY = (E0 - W0) / GW, (N0 - S0) / GH
dst_tf = from_origin(W0, N0, DX, DY)

def dem_tile(lat, lon):  # south-west corner of the 1 degree tile, e.g. (54, -4)
    ns, ew = ('N' if lat >= 0 else 'S') + f'{abs(lat):02d}', ('E' if lon >= 0 else 'W') + f'{abs(lon):03d}'
    name = f'Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM'
    return f'/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif'

height = np.full((GH, GW), np.nan, np.float32)
for lon in (-4, -3):
    with rasterio.open(dem_tile(54, lon)) as ds:
        tmp = np.full((GH, GW), np.nan, np.float32)
        reproject(rasterio.band(ds, 1), tmp, src_transform=ds.transform, src_crs=ds.crs, dst_transform=dst_tf, dst_crs='EPSG:4326',
                  resampling=Resampling.average, dst_nodata=np.nan, init_dest_nodata=True)
        m = ~np.isnan(tmp)
        height[m] = tmp[m]
sea = np.isnan(height) | (height <= 0.5)
height = np.where(np.isnan(height), 0, height)

def px(lon, lat): return ((lon - W0) / DX, (N0 - lat) / DY)

osm = json.load(open(sys.argv[1]))['elements']
water = np.zeros((GH, GW), np.uint8)   # 0 land, 1 lake, 2 river
water[sea] = 1

def fill(rings_out, rings_in):
    """Rasterise a polygon: outer rings on, inner rings (islands) off. Returns (mask, x0, y0): a boolean mask of just the polygon's bounding box and where that sits on the grid."""
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
    """Join open member ways into closed rings by their end points."""
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

def geom(g): return [px(p['lon'], p['lat']) for p in g]
rivers = []
nlakes = 0

def add_lake(f):
    """A lake is flat at its surface (the median of the DEM under it, which Copernicus already flattens); under 3 tiles it is left out."""
    global nlakes
    if f is None: return
    m, x0, y0 = f
    if m.sum() < 3: return
    hs, ss, ws = height[y0:y0 + m.shape[0], x0:x0 + m.shape[1]], sea[y0:y0 + m.shape[0], x0:x0 + m.shape[1]], water[y0:y0 + m.shape[0], x0:x0 + m.shape[1]]
    land = m & ~ss
    if land.sum() == 0: return
    hs[m] = float(np.median(hs[land])); ws[m] = 1; nlakes += 1

for e in osm:
    tags = e.get('tags', {})
    if e['type'] == 'way' and tags.get('natural') == 'water' and 'geometry' in e:
        g = geom(e['geometry'])
        if len(g) > 3 and g[0] == g[-1]: add_lake(fill([g], []))
    elif e['type'] == 'relation' and tags.get('natural') == 'water':
        outer = [geom(m['geometry']) for m in e.get('members', []) if m.get('role') == 'outer' and 'geometry' in m]
        inner = [geom(m['geometry']) for m in e.get('members', []) if m.get('role') == 'inner' and 'geometry' in m]
        add_lake(fill(stitch(outer), stitch(inner)))
    elif e['type'] == 'way' and tags.get('waterway') == 'river' and 'geometry' in e:
        rivers.append(geom(e['geometry']))

# rivers: a one-tile line, cut a little into the ground
im = Image.new('L', (GW, GH), 0); d = ImageDraw.Draw(im)
for r in rivers: d.line(r, fill=255, width=1)
rv = np.array(im) > 0
rv &= (water == 0)
water[rv] = 2
height[rv] = np.maximum(0, height[rv] - 3)

dm = np.clip(np.round(height * 10), 0, 65535).astype(np.uint16)
rgb = np.stack([(dm >> 8).astype(np.uint8), (dm & 255).astype(np.uint8), water], axis=-1)
out = sys.argv[2].rstrip('/')
Image.fromarray(rgb, 'RGB').save(f'{out}/lakedistrict.png', optimize=True)
json.dump({'bbox': [W0, S0, E0, N0], 'w': GW, 'h': GH, 'tileM': TILE_M, 'maxH': float(height.max()), 'unit': 'decimetres in R*256+G', 'water': 'B: 0 land, 1 lake or sea, 2 river',
           'credits': 'Contains Copernicus DEM data (c) DLR e.V. and Airbus Defence and Space GmbH, provided under COPERNICUS by the EU and ESA. Water (c) OpenStreetMap contributors (ODbL).'},
          open(f'{out}/meta.json', 'w'), indent=1)
print('grid', GW, GH, 'max height m', float(height.max()), 'lakes', nlakes, 'rivers', len(rivers), 'water px', int((water > 0).sum()))
