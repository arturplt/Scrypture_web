/**
 * The paper plane as a 3D model (src/assets/paper_plane.glb): one mesh with its own texture. Read straight from the binary glTF, no library:
 * the node's rotation and scale are applied, the model is centred and turned so +forward is the nose, +right the right wing and +up the
 * back, and sized to a length of 1 (the 3D view scales it). The file is y-up with the nose along -x, so right = forward x up = -z.
 */
import PLANE_URL from '../assets/paper_plane.glb?url';

export interface PlaneModel {
  /** forward, right, up per vertex, the model 1 long */
  local: Float32Array;
  uv: Float32Array;
  idx: Uint16Array;
  image: ImageBitmap;
}

interface Gltf { nodes: { rotation: number[]; scale: number[]; translation: number[] }[]; meshes: { primitives: { attributes: { POSITION: number; TEXCOORD_0: number }; indices: number }[] }[]; accessors: { bufferView: number; count: number }[]; bufferViews: { byteOffset: number; byteLength: number }[]; images: { bufferView: number; mimeType: string }[] }

let cached: Promise<PlaneModel> | null = null;
/** Loaded once; ask early so it is ready before the first frame. */
export function loadPlaneModel(): Promise<PlaneModel> { return (cached ??= readPlaneModel(PLANE_URL)); }

async function readPlaneModel(url: string): Promise<PlaneModel> {
  const buf = await (await fetch(url)).arrayBuffer(), dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb');
  const jsonLen = dv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))) as Gltf, bin = 20 + jsonLen + 8;
  const view = (i: number) => json.bufferViews[i];
  const prim = json.meshes[0].primitives[0];
  const floats = (acc: number, per: number) => { const a = json.accessors[acc], v = view(a.bufferView); return new Float32Array(buf.slice(bin + v.byteOffset, bin + v.byteOffset + a.count * per * 4)); };
  const pos = floats(prim.attributes.POSITION, 3), uv = floats(prim.attributes.TEXCOORD_0, 2);
  const ia = json.accessors[prim.indices], iv = view(ia.bufferView), idx = new Uint16Array(buf.slice(bin + iv.byteOffset, bin + iv.byteOffset + ia.count * 2));
  const n = json.nodes[0], [qx, qy, qz, qw] = n.rotation, [sx, sy, sz] = n.scale, [tx, ty, tz] = n.translation;
  const R = [[1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)], [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)], [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)]];
  const count = pos.length / 3, world = new Float32Array(pos.length), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < count; i++) {
    const p = [pos[i * 3] * sx, pos[i * 3 + 1] * sy, pos[i * 3 + 2] * sz];
    for (let r = 0; r < 3; r++) { const v = R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2] + [tx, ty, tz][r]; world[i * 3 + r] = v; lo[r] = Math.min(lo[r], v); hi[r] = Math.max(hi[r], v); }
  }
  const len = hi[0] - lo[0], cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, local = new Float32Array(pos.length);
  for (let i = 0; i < count; i++) {
    local[i * 3] = -(world[i * 3] - cx) / len;            // forward: the nose is at -x
    local[i * 3 + 1] = -(world[i * 3 + 2]) / len;         // right: -z
    local[i * 3 + 2] = (world[i * 3 + 1] - cy) / len;     // up: +y
  }
  const im = json.images[0], imv = view(im.bufferView);
  const image = await createImageBitmap(new Blob([buf.slice(bin + imv.byteOffset, bin + imv.byteOffset + imv.byteLength)], { type: im.mimeType }));
  // The file's own texture coordinates leave whole faces on single black texels (one side of the plane came out black), and diagonal stripes
  // laid flat come out different on the two wings. So the texture is read along the plane's length only, across the stripes: bands across
  // both wings, the same on each side, about eight along the length.
  const k = 0.075, planar = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { const f = local[i * 3]; planar[i * 2] = 0.5 + f * k * (image.height / image.width); planar[i * 2 + 1] = 0.5 + f * k; }
  void uv;
  return { local, uv: planar, idx, image };
}
