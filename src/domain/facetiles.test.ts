import { describe, it, expect } from 'vitest';
import { tiledIndices, tileCaps, tileShown, sphereInView, gridTileBounds, ringTileShown, type EyeFrame } from './facetiles';
import { farIndices } from './terrace';
import { FACES, netToDir, setCubeSize, eyeFrame, CUBE_N, cubeRadius, type V3 } from './cube';

const tri = (idx: ArrayLike<number>) => { const s: string[] = []; for (let i = 0; i < idx.length; i += 3) s.push([idx[i], idx[i + 1], idx[i + 2]].join(',')); return s.sort(); };

describe('tiledIndices', () => {
  it('holds the same triangles as the plain grid, grouped by tile', () => {
    for (const cols of [11, 33, 211]) {
      const T = Math.ceil((cols - 1) / 5), t = tiledIndices(cols, T);
      expect(tri(t.idx)).toEqual(tri(farIndices(cols)));
      expect(t.starts[t.nt * t.nt]).toBe(t.idx.length);
      for (let k = 0; k < t.nt * t.nt; k++) expect(t.starts[k + 1]).toBeGreaterThanOrEqual(t.starts[k]);
    }
  });
});

/** A perspective view-projection matrix (column-major) looking from `eye` along `fwd` with `up` as the screen's up. */
function viewProj(eye: V3, fwd: V3, upv: V3, fovY: number, aspect: number, near: number, far: number): number[] {
  const n = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
  const cr = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const f = n(fwd), r = n(cr(f, upv)), u = cr(r, f), d = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const V = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -d(r, eye), -d(u, eye), d(f, eye), 1];
  const t = 1 / Math.tan(fovY / 2), P = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const M = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r2 = 0; r2 < 4; r2++) for (let k = 0; k < 4; k++) M[c * 4 + r2] += P[k * 4 + r2] * V[c * 4 + k];
  return M;
}

describe('sphereInView', () => {
  const vp = viewProj([0, 0, 0], [1, 0, 0], [0, 0, 1], 1, 1.5, 0.1, 1000);
  it('keeps what is ahead and drops what is behind or far to the side', () => {
    expect(sphereInView(vp, 100, 0, 0, 1)).toBe(true);
    expect(sphereInView(vp, -100, 0, 0, 1)).toBe(false);
    expect(sphereInView(vp, 100, 500, 0, 1)).toBe(false);
    expect(sphereInView(vp, 100, 500, 0, 600)).toBe(true);   // (a big sphere reaches in)
    expect(sphereInView(vp, 5000, 0, 0, 1)).toBe(false);
  });
});

describe('tileShown against the vertex shader\'s own maths', () => {
  it('never skips a tile that has a vertex on screen', () => {
    setCubeSize(CUBE_N);
    const R = cubeRadius(CUBE_N), hill = 0.06 * R, cols = 71, T = Math.ceil((cols - 1) / 5);
    let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const out = [0, 0, 0]; let culled = 0, drawn = 0;
    // a face's grid in net coordinates, like terraceFarMesh makes it
    const meshes = FACES.map(F => { const pos = new Float32Array(cols * cols * 3); for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) { const k = (j * cols + i) * 3; pos[k] = F.ix * CUBE_N + ((i / (cols - 1)) - 0.5) * CUBE_N * 0.98; pos[k + 1] = F.iy * CUBE_N + ((j / (cols - 1)) - 0.5) * CUBE_N * 0.98; pos[k + 2] = -rnd() * 40; } return pos; });
    const caps = meshes.map(pos => tileCaps(pos, cols, 5, T, netToDir));
    for (let trial = 0; trial < 100; trial++) {
      const ex = (rnd() - 0.5) * CUBE_N * 0.9, ey = (rnd() - 0.5) * CUBE_N * 0.9, fr0 = eyeFrame(ex, ey)!; const fr: EyeFrame = fr0;
      const h = rnd() * rnd() * 3 * R + 5, ang = rnd() * Math.PI * 2, pitch = (rnd() - 0.6) * 1.2;
      const eyeW: V3 = [ex, ey, -h], fwd: V3 = [Math.cos(ang) * Math.cos(pitch), Math.sin(ang) * Math.cos(pitch), -Math.sin(pitch)];
      const vp = viewProj(eyeW, fwd, [0, 0, -1], 0.5 + rnd(), 1.78, 0.5, 40 * R);
      for (let f = 0; f < 6; f++) for (let ty = 0; ty < 5; ty++) for (let tx = 0; tx < 5; tx++) {
        const k = ty * 5 + tx, c: V3 = [caps[f][k * 4], caps[f][k * 4 + 1], caps[f][k * 4 + 2]], shown = tileShown(c, caps[f][k * 4 + 3], fr, R, h, hill, ex, ey, vp);
        if (shown) { drawn++; continue; } culled++;
        for (let j = ty * T; j <= Math.min(cols - 1, (ty + 1) * T); j++) for (let i = tx * T; i <= Math.min(cols - 1, (tx + 1) * T); i++) {
          const v = (j * cols + i) * 3, pz = meshes[f][v + 2]; netToDir(meshes[f][v], meshes[f][v + 1], out);
          const wx = out[0] * (R - pz) - fr.up[0] * R, wy = out[1] * (R - pz) - fr.up[1] * R, wz = out[2] * (R - pz) - fr.up[2] * R;   // (the vertex shader: w, then q)
          const q = [ex + wx * fr.east[0] + wy * fr.east[1] + wz * fr.east[2], ey + wx * fr.south[0] + wy * fr.south[1] + wz * fr.south[2], -(wx * fr.up[0] + wy * fr.up[1] + wz * fr.up[2])];
          // a vertex hidden by the ball itself is not a loss (the horizon test is for those): the eye -> vertex segment must clear the ball
          { const E = [fr.up[0] * (R + h), fr.up[1] * (R + h), fr.up[2] * (R + h)], P = [out[0] * (R - pz), out[1] * (R - pz), out[2] * (R - pz)], d = [P[0] - E[0], P[1] - E[1], P[2] - E[2]], dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
            const tt = Math.max(0, Math.min(1, -(E[0] * d[0] + E[1] * d[1] + E[2] * d[2]) / dd)); if (Math.hypot(E[0] + d[0] * tt, E[1] + d[1] * tt, E[2] + d[2] * tt) < R - 1e-6) continue; }
          // vertices the shader would not put on the ball are nearer than 0.4 R and their tile is always drawn
          const clip = [0, 1, 2, 3].map(r => vp[r] * q[0] + vp[4 + r] * q[1] + vp[8 + r] * q[2] + vp[12 + r]);
          const onScreen = clip[3] > 0 && Math.abs(clip[0]) <= clip[3] && Math.abs(clip[1]) <= clip[3] && Math.abs(clip[2]) <= clip[3];
          expect(onScreen).toBe(false);
        }
      }
    }
    expect(culled).toBeGreaterThan(150); expect(drawn).toBeGreaterThan(150);
    setCubeSize(0);
  });
});

describe('ringTileShown against the vertex and fragment shaders', () => {
  it('never skips a tile with a vertex that is in the ring and on screen', () => {
    let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const cols = 65, T = Math.ceil((cols - 1) / 8), step = 32, half = (cols - 1) / 2 * step, pad = 7 * 0.45;
    let culled = 0, drawn = 0;
    for (let trial = 0; trial < 60; trial++) {
      const cx = (rnd() - 0.5) * 3000, cy = (rnd() - 0.5) * 3000, ex = cx + (rnd() - 0.5) * 1500, ey = cy + (rnd() - 0.5) * 1500, h = 5 + rnd() * rnd() * 3000;
      const pos = new Float32Array(cols * cols * 3); for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) { const k = (j * cols + i) * 3; pos[k] = cx - half + i * step; pos[k + 1] = cy - half + j * step; pos[k + 2] = -rnd() * 60; }
      const b = gridTileBounds(pos, cols, 8, T), curveC = rnd() < 0.5 ? 0 : rnd() * 2e-4;
      const ang = rnd() * Math.PI * 2, pitch = (rnd() - 0.5) * 1.4, vp = viewProj([ex, ey, -h], [Math.cos(ang) * Math.cos(pitch), Math.sin(ang) * Math.cos(pitch), -Math.sin(pitch)], [0, 0, -1], 0.5 + rnd(), 1.78, 0.2, 60000);
      const s0 = rnd() < 0.3 ? 0 : rnd() * 600, e0 = s0 + 100 + rnd() * 2500;
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) {
        const shown = ringTileShown(b, (ty * 8 + tx) * 6, ex, ey, s0, e0, vp, curveC, pad); if (shown) { drawn++; continue; } culled++;
        for (let j = ty * T; j <= Math.min(cols - 1, (ty + 1) * T); j++) for (let i = tx * T; i <= Math.min(cols - 1, (tx + 1) * T); i++) {
          const k = (j * cols + i) * 3, d2 = (pos[k] - ex) ** 2 + (pos[k + 1] - ey) ** 2, d = Math.sqrt(d2);
          if (d < s0 || d > e0) continue;   // (the fragment shader throws it away)
          for (const sink of [0, pad]) {
            const q = [pos[k], pos[k + 1], pos[k + 2] + curveC * d2 + sink];
            const clip = [0, 1, 2, 3].map(r => vp[r] * q[0] + vp[4 + r] * q[1] + vp[8 + r] * q[2] + vp[12 + r]);
            expect(clip[3] > 0 && Math.abs(clip[0]) <= clip[3] && Math.abs(clip[1]) <= clip[3] && Math.abs(clip[2]) <= clip[3]).toBe(false);
          }
        }
      }
    }
    expect(culled).toBeGreaterThan(800); expect(drawn).toBeGreaterThan(200);
  });
});

describe('chunkShown (the real chunks round the eye)', () => {
  it('never skips a chunk with a vertex in view, on the planet (flat chart, the ball, and in between) and on an endless world, and does skip a good share', async () => {
    const { chunkShown } = await import('./facetiles');
    const { chartDir, cubeRadius, CUBE_N, eyeFrame } = await import('./cube');
    setCubeSize(CUBE_N);
    try {
      const R = cubeRadius(CUBE_N), T = 16;
      let s = 77; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
      let seen = 0, skipped = 0, total = 0;
      const clipIn = (m: number[], x: number, y: number, z: number) => { const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cz = m[2] * x + m[6] * y + m[10] * z + m[14], cw = m[3] * x + m[7] * y + m[11] * z + m[15]; return cw > 0 && Math.abs(cx) <= cw && Math.abs(cy) <= cw && Math.abs(cz) <= cw; };
      for (let trial = 0; trial < 150; trial++) {
        const planet = trial % 4 !== 3;   // (three in four on the planet, the rest on an endless world with a paraboloid)
        const ex = Math.round((rnd() - 0.5) * (trial % 5 === 0 ? 3000 : 400)), ey = Math.round((rnd() - 0.5) * (trial % 5 === 0 ? 3000 : 400)), h = 2 + rnd() * rnd() * 500;
        const fr = planet ? eyeFrame(ex, ey) : null; if (planet && !fr) continue;
        const yaw = rnd() * Math.PI * 2, pitch = -0.05 - rnd() * 1.4, fwd: V3 = [Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch)];   // (z is down: a negative pitch looks down, +z)
        const vp = viewProj([ex, ey, -h], fwd, [0, 0, -1], (40 + rnd() * 40) * Math.PI / 180, 1 + rnd() * 0.8, 0.5 + h * 0.05, 3000);
        const curveC = planet ? 0 : 1 / (2 * R);
        for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) {
          const x = (Math.floor(ex / T) + i + 0.5) * T, y = (Math.floor(ey / T) + j + 0.5) * T, zMin = -(rnd() * 40), zMax = zMin + rnd() * 25;
          let inView = false;
          for (let a = 0; a <= 8 && !inView; a++) for (let b = 0; b <= 8 && !inView; b++) for (let c = 0; c <= 2 && !inView; c++) {
            const px = x - T / 2 + (a / 8) * T, py = y - T / 2 + (b / 8) * T, pz = zMin + (c / 2) * (zMax - zMin);
            const cands: V3[] = [[px, py, pz]];
            if (planet) {
              const d = [0, 0, 0]; if (!chartDir(px, py, d)) continue;
              const wv: V3 = [d[0] * (R - pz) - fr!.up[0] * R, d[1] * (R - pz) - fr!.up[1] * R, d[2] * (R - pz) - fr!.up[2] * R], dt = (u: V3) => wv[0] * u[0] + wv[1] * u[1] + wv[2] * u[2];
              const q: V3 = [ex + dt(fr!.east), ey + dt(fr!.south), -dt(fr!.up)];
              for (const k of [0.5, 1]) cands.push([px + (q[0] - px) * k, py + (q[1] - py) * k, pz + (q[2] - pz) * k]);
            } else cands.push([px, py, pz + curveC * ((px - ex) ** 2 + (py - ey) ** 2)]);
            for (const q of cands) if (clipIn(vp, q[0], q[1], q[2])) inView = true;
          }
          const shown = chunkShown(vp, x, y, zMin, zMax, T, ex, ey, planet ? R : 0, curveC);
          total++; if (inView && !shown) console.log('MISS', JSON.stringify({ trial, planet, ex, ey, h, i, j, zMin, zMax, x, y, d: Math.hypot(x - ex, y - ey) }));
          if (inView) { seen++; expect(shown, `trial ${trial} chunk ${i},${j}`).toBe(true); } else if (!shown) skipped++;
        }
      }
      expect(seen).toBeGreaterThan(500);
      expect(skipped / total).toBeGreaterThan(0.3);
      console.log(`CHUNKSHOWN total ${total}, in view ${seen}, skipped ${skipped} (${(100 * skipped / total).toFixed(0)}%)`);
    } finally { setCubeSize(0); }
  }, 60000);
});
