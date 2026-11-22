import { describe, expect, it } from 'vitest';
import { newGlider, stepGlider, type GlideEnv } from './glider';
import { MOVES, newTurnState, playTurn, previewMove, resolveMove } from './turnbased';

const still: GlideEnv = { windX: 0, windY: 0, air: () => 0 };
const settled = (heading = 0.4, z = 150) => { const g = newGlider(0, 0, heading, z); for (let i = 0; i < 240; i++) stepGlider(g, { pitch: 0, roll: 0, yaw: 0 }, still, 1 / 60); return g; };
const dPsi = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

describe('turn-based moves', () => {
  it('every card in the deck is flown to the end from a normal glide, upright and level', () => {
    for (const mv of MOVES) {
      const r = resolveMove(settled(), still, mv);
      expect(r.done, mv.id).toBe(true); expect(r.landed, mv.id).toBe(false); expect(Math.abs(r.glider.phi), mv.id).toBeLessThan(0.4);
      expect(r.path.length, mv.id).toBeGreaterThan(2); expect(Number.isFinite(r.glider.x + r.glider.y + r.glider.z), mv.id).toBe(true);
    }
  });
  it('a preview does not touch the plane, and playing it gives the same end as previewing it', () => {
    const g = settled(), before = JSON.stringify([g.x, g.y, g.z, g.psi]), mv = MOVES.find(m => m.id === 'right90')!;
    const p = previewMove(g, still, mv);
    expect(JSON.stringify([g.x, g.y, g.z, g.psi])).toBe(before);
    const { state, result } = playTurn(newTurnState(g), still, mv);
    expect(result.glider.x).toBeCloseTo(p.glider.x, 6); expect(state.turn).toBe(1); expect(state.played[0].move).toBe('right90');
  });
  it('left and right 90 turn the plane a quarter turn the right way; U-turns a half; straight stays on its heading', () => {
    const turn = (id: string) => { const g = settled(), r = resolveMove(g, still, MOVES.find(m => m.id === id)!); return dPsi(g.psi, r.glider.psi) * 180 / Math.PI; };
    expect(turn('left90')).toBeGreaterThan(75); expect(turn('left90')).toBeLessThan(105);
    expect(turn('right90')).toBeLessThan(-75); expect(turn('right90')).toBeGreaterThan(-105);
    expect(Math.abs(turn('uturnL'))).toBeGreaterThan(165); expect(Math.abs(turn('uturnR'))).toBeGreaterThan(165);
    expect(Math.abs(turn('straight'))).toBeLessThan(8);
  });
  it('several turns chain: four right 90s come back round', () => {
    let s = newTurnState(settled()); const start = s.glider.psi, mv = MOVES.find(m => m.id === 'right90')!;
    for (let i = 0; i < 4; i++) s = playTurn(s, still, mv).state;
    expect(s.turn).toBe(4); expect(Math.abs(dPsi(start, s.glider.psi))).toBeLessThan(0.35);
  });
  it('a move started too low to fly it is cut short, not flown into the ground', () => {
    const g = newGlider(0, 0, 0, 5), r = resolveMove(g, still, MOVES.find(m => m.id === 'loop')!);
    expect(r.done).toBe(false);
  });
});
