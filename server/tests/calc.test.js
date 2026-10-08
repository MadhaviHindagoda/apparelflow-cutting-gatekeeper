import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { expectedComponentQty, expectedFabricYards, wastagePct, trafficLight, summarize } =
  require('../src/services/calc');

describe('multiplier engine', () => {
  it('50 garments x 2 cuffs = 100 expected cuffs', () => {
    expect(expectedComponentQty(50, 2)).toBe(100);
  });
  it('expected fabric = qty x std yards', () => {
    expect(expectedFabricYards(50, 1.8)).toBe(90);
  });
});

describe('wastage %', () => {
  it('94.5 yds used vs 90 expected = 5%', () => {
    expect(wastagePct(94.5, 90)).toBe(5);
  });
  it('can be negative when less fabric is used', () => {
    expect(wastagePct(85, 100)).toBe(-15);
  });
});

describe('traffic light', () => {
  it('GREEN / YELLOW / RED / uncounted', () => {
    expect(trafficLight(100, 100)).toBe('GREEN');
    expect(trafficLight(100, 120)).toBe('YELLOW');
    expect(trafficLight(100, 99)).toBe('RED');
    expect(trafficLight(100, 0)).toBe('RED');
    expect(trafficLight(100, null)).toBeNull();
  });
});

describe('gatekeeper summary', () => {
  it('blocks approval when any component is RED', () => {
    const s = summarize([
      { expected_qty: 10, actual_qty: 10 },
      { expected_qty: 20, actual_qty: 19 },
    ]);
    expect(s.has_red).toBe(true);
    expect(s.can_approve).toBe(false);
  });
  it('blocks approval when any component is uncounted', () => {
    const s = summarize([
      { expected_qty: 10, actual_qty: 10 },
      { expected_qty: 20, actual_qty: null },
    ]);
    expect(s.can_approve).toBe(false);
  });
  it('allows GREEN + YELLOW', () => {
    const s = summarize([
      { expected_qty: 10, actual_qty: 10 },
      { expected_qty: 20, actual_qty: 25 },
    ]);
    expect(s.can_approve).toBe(true);
  });
});