#!/usr/bin/env python3
"""Builds public/assets/lakedistrict/roads.json: the real roads of both Lake District maps, as lines the game draws into the ground as dark sand.

Data (run once, commit the output, not the inputs): OpenStreetMap, two Overpass `out geom tags` dumps  (c) OpenStreetMap contributors, ODbL
  lakes:    way["highway"~"^(motorway|trunk|primary|secondary)$"](54.00,-3.70,54.80,-2.60);out geom tags;
  coniston: way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"](54.2638,-3.1876,54.4006,-2.9688);out geom tags;

Usage:  python3 scripts/build-roads.py <roads_lakes.json> <roads_coniston.json> <out_dir>

Each way becomes {ref, kind, pts: [[lon, lat], ...]}, simplified to about a third of a tile of the map it is for (Douglas-Peucker), points to 5 decimals.
Ways with no ref get their name (or nothing); only the M6 is used by name in the game (its flyover achievement).
"""
import json, math, sys

def simplify(pts, tol):  # Douglas-Peucker on (x, y) in metres
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]; vx, vy = bx - ax, by - ay; l2 = vx * vx + vy * vy
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / l2)) if l2 else 0.0
            d = math.hypot(ax + vx * t - px, ay + vy * t - py)
            if d > worst: worst, wi = d, i
        if worst > tol:
            keep[wi] = True; stack += [(a, wi), (wi, b)]
    return [p for p, k in zip(pts, keep) if k]

def convert(path, tile_m):
    els = json.load(open(path))['elements']
    out = []
    for e in els:
        if e.get('type') != 'way' or 'geometry' not in e: continue
        tags = e.get('tags', {}); kind = tags.get('highway', '')
        ref = (tags.get('ref') or tags.get('name') or '').split(';')[0].strip()
        g = e['geometry']
        mid = sum(p['lat'] for p in g) / len(g)
        kx, ky = 111320 * math.cos(math.radians(mid)), 110570
        xy = [(p['lon'] * kx, p['lat'] * ky) for p in g]
        keep = simplify(xy, tile_m / 3)
        pts = [[round(x / kx, 5), round(y / ky, 5)] for x, y in keep]
        if len(pts) >= 2: out.append({'ref': ref, 'kind': kind, 'pts': pts})
    return out

lakes, con, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
res = {'lakes': convert(lakes, 50.0), 'coniston': convert(con, 10.0)}
with open(f'{outdir}/roads.json', 'w') as f:
    json.dump(res, f, separators=(',', ':'))
for k, v in res.items():
    print(k, len(v), 'roads', sum(len(r['pts']) for r in v), 'points')
