/**
 * 灭火器保护半径覆盖验收用例（验收标准：10 组，未覆盖面积与人工核算一致，误差 ≤ 10%）
 *
 * 覆盖判定为 0.5m 格心采样：格心在保护圆内则整格视为已覆盖。
 * 面积 = 格数 × 0.25㎡，边界抖动 ≤ 半格/格，以下区间按 ±10% 人工核算值给出。
 */
import { describe, it, expect } from 'vitest';
import { mkRoom, rect, mkFloor, ruleWith, DEFAULT_RULES, validateFloor } from './helpers';
import { computeCoverage } from '../src/lib/engine';
import { MM_PER_M } from '../src/lib/geometry';
import type { Pt, Room } from '../src/model';

const M = 1000;
const pt = (x: number, y: number): Pt => ({ x: x * M, y: y * M });

function cov(rooms: Room[], pts: [number, number][], radiusM: number) {
  return computeCoverage(rooms, pts.map(([x, y]) => pt(x, y)), radiusM);
}

describe('灭火器覆盖（栅格采样 vs 人工核算）', () => {
  it('C1 20×20 房间中心 r15：内切圆覆盖全屋，未覆盖 ≈0', () => {
    const r = cov([mkRoom('r', 'office', rect(0, 0, 20, 20))], [[10, 10]], 15);
    // 角上最远格心 (0.25,0.25) 距中心 13.79 < 15 → 0
    expect(r.uncoveredM2).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('C2 20×20 中心 r10：未覆盖 = 400 − π·10² ≈ 85.8㎡', () => {
    const r = cov([mkRoom('r', 'office', rect(0, 0, 20, 20))], [[10, 10]], 10);
    expect(r.totalM2).toBeCloseTo(400, 1); // 格心采样总面积与人工一致
    expect(r.uncoveredM2).toBeGreaterThan(77); // 人工 85.84 ±10%
    expect(r.uncoveredM2).toBeLessThan(94.4);
    expect(r.pass).toBe(false); // > max(2, 400×5%)
  });

  it('C3 30×30 中心 r10：未覆盖 = 900 − π·10² ≈ 585.8㎡', () => {
    const r = cov([mkRoom('r', 'other', rect(0, 0, 30, 30))], [[15, 15]], 10);
    expect(r.uncoveredM2).toBeGreaterThan(527);
    expect(r.uncoveredM2).toBeLessThan(644);
  });

  it('C4 41×2 走道中点 r20：两端各 0.5m 条带 ≈2㎡，≤阈值判合格', () => {
    const r = cov([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [[20.5, 1]], 20);
    expect(r.uncoveredM2).toBeGreaterThan(0.5);
    expect(r.uncoveredM2).toBeLessThan(3.5); // 人工：2 × 0.5m × 2m = 2㎡
    expect(r.pass).toBe(true); // 2 ≤ max(2, 82×5% = 4.1)
  });

  it('C5 41×2 走道中点 r12：两端各 ≈8.5m 条带 ≈34㎡，判不合格；validateFloor 出未覆盖项', () => {
    const room = mkRoom('走道', 'corridor', rect(0, 0, 41, 2));
    const r = cov([room], [[20.5, 1]], 12);
    expect(r.uncoveredM2).toBeGreaterThan(30.6); // 人工 34㎡ ±10%
    expect(r.uncoveredM2).toBeLessThan(37.4);
    expect(r.pass).toBe(false);
    // 引擎集成：厂规 r12 → COVERAGE_UNCOVERED，且 withCells 可取出未覆盖栅格用于高亮
    const { floor } = mkFloor([room], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
      { kind: 'extinguisher', x: 20.5, y: 1 },
    ], 'factory');
    const v = validateFloor(floor, ruleWith(DEFAULT_RULES.factory, { extinguisherRadiusM: 12 }));
    expect(v.items.some((i) => i.type === 'COVERAGE_UNCOVERED')).toBe(true);
    expect(v.pass).toBe(false);
    const withCells = computeCoverage([room], [pt(20.5, 1)], 12, true);
    expect(withCells.cells.length).toBeGreaterThan(0);
    expect(withCells.cells[0].x / MM_PER_M).toBeLessThan(8.5); // 未覆盖点在西端
  });

  it('C6 50×2 走道单点 r20：两端各 5m 条带 ≈20㎡', () => {
    const r = cov([mkRoom('走道', 'corridor', rect(0, 0, 50, 2))], [[25, 1]], 20);
    expect(r.uncoveredM2).toBeGreaterThan(18); // 人工 20㎡ ±10%
    expect(r.uncoveredM2).toBeLessThan(22);
    expect(r.pass).toBe(false);
  });

  it('C7 50×2 走道两点 r20：走道两端布点全覆盖', () => {
    const r = cov([mkRoom('走道', 'corridor', rect(0, 0, 50, 2))], [[12.5, 1], [37.5, 1]], 20);
    expect(r.uncoveredM2).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('C8 40×2 走道两点间距过大（8m/32m）r10：中段盲区 ≈8㎡', () => {
    const r = cov([mkRoom('走道', 'corridor', rect(0, 0, 40, 2))], [[8, 1], [32, 1]], 10);
    expect(r.uncoveredM2).toBeGreaterThan(7); // 人工 [18,22]×2 ≈ 8㎡
    expect(r.uncoveredM2).toBeLessThan(9.5);
    expect(r.pass).toBe(false); // > max(2, 80×5% = 4)
  });

  it('C9 30×10 大厅两点 r10（间距 15m 重叠）：全覆盖', () => {
    const r = cov([mkRoom('大厅', 'other', rect(0, 0, 30, 10))], [[7.5, 5], [22.5, 5]], 10);
    expect(r.uncoveredM2).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('C10 多房间：B 房无点位全未覆盖 ≈100㎡（面积差集跨房间累计）', () => {
    const rooms = [mkRoom('A', 'office', rect(0, 0, 10, 10)), mkRoom('B', 'office', rect(20, 0, 10, 10))];
    const r = cov(rooms, [[5, 5]], 10);
    expect(r.totalM2).toBeCloseTo(200, 1);
    expect(r.uncoveredM2).toBeGreaterThan(90); // 人工：B 房 100㎡ ±10%
    expect(r.uncoveredM2).toBeLessThan(110);
    expect(r.pass).toBe(false);
  });
});

describe('灭火器覆盖（缺陷回归：全部点位 / 当前半径 / 区域可点）', () => {
  it('C11 validateFloor 按楼层上【全部】灭火器点位取并集（多台补盲后合规）', () => {
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 70, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 69.5, y: 1 },
      { kind: 'extinguisher', x: 17.5, y: 1 },
      { kind: 'extinguisher', x: 52.5, y: 1 },
    ]);
    const r = validateFloor(floor, rules); // 办公 r20：两台并集全覆盖
    expect(r.coverage?.uncoveredM2).toBe(0);
    expect(r.coverage?.pass).toBe(true);
    expect(r.pass).toBe(true);
    // 只按第一台（17.5m 处）算，东端必有未覆盖，证明结果确实来自全部点位
    const onlyFirst = computeCoverage(floor.rooms, [pt(17.5, 1)], 20);
    expect(onlyFirst.uncoveredM2).toBeGreaterThan(15);
  });

  it('C12 判定半径随当前规则：自定义 r15 时结果与消息都按 15m，而不是老的默认值', () => {
    const room = mkRoom('走道', 'corridor', rect(0, 0, 41, 2));
    const { floor } = mkFloor([room], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
      { kind: 'extinguisher', x: 20.5, y: 1 },
    ], 'factory');
    const v = validateFloor(floor, ruleWith(DEFAULT_RULES.factory, { extinguisherRadiusM: 15 }));
    expect(v.coverage?.radiusM).toBe(15);
    // 41×2 走道、中心 r15：两端各约 5m 条带 ≈20㎡（0.5m 格心采样上界取整为 22㎡）> 阈值
    expect(v.coverage?.uncoveredM2).toBeGreaterThan(18);
    expect(v.coverage?.uncoveredM2).toBeLessThanOrEqual(23);
    const item = v.items.find((i) => i.type === 'COVERAGE_UNCOVERED');
    expect(item?.message).toContain('15m');
    expect(item?.message).not.toContain('12m');
    // 与直接用 15 计算一致（不是按厂规 12 或旧硬编码）
    const direct = computeCoverage([room], [pt(20.5, 1)], 15, true);
    expect(v.coverage!.uncoveredM2).toBeCloseTo(direct.uncoveredM2, 5);
  });

  it('C13 withCells 产出连通未覆盖区域，每块带代表点与「差多远」', () => {
    const room = mkRoom('走道', 'corridor', rect(0, 0, 50, 2));
    const r = computeCoverage([room], [pt(25, 1)], 10, true);
    // 东西两端各一块（中段被覆盖隔开）
    expect(r.regions.length).toBe(2);
    for (const rg of r.regions) {
      expect(rg.cells.length).toBeGreaterThan(0);
      expect(rg.radiusM).toBe(10);
      expect(rg.gapM).toBeCloseTo(Math.max(0, rg.nearestDistanceM - 10), 6);
      // 代表点是该区域内距灭火器最远的格心
      for (const c of rg.cells) {
        expect(Math.hypot(c.x - 25000, c.y - 1000)).toBeLessThanOrEqual(
          Math.hypot(rg.point.x - 25000, rg.point.y - 1000) + 1e-6,
        );
      }
    }
    // 西端点 ≈ x0.25m，距中心 24.75m → 差 14.75m；东端对称，两块按 gap 并列、面积相等
    const west = r.regions.find((rg) => rg.point.x < 25000)!;
    expect(west.point.x / MM_PER_M).toBeCloseTo(0.25, 1);
    expect(west.nearestDistanceM).toBeCloseTo(24.75, 1);
    expect(west.gapM).toBeCloseTo(14.75, 1);
    // 区域面积之和 = 未覆盖总面积
    const sum = r.regions.reduce((s, rg) => s + rg.areaM2, 0);
    expect(sum).toBeCloseTo(r.uncoveredM2, 6);
    // 不带 withCells 时不产出区域（普通校验路径的开销约定）
    const light = computeCoverage([room], [pt(25, 1)], 10);
    expect(light.regions).toEqual([]);
    expect(light.cells).toEqual([]);
  });

  it('C14 validateFloor 的未覆盖项携带区域代表点，供面板逐块定位', () => {
    const room = mkRoom('走道', 'corridor', rect(0, 0, 50, 2));
    const { floor, rules } = mkFloor([room], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'extinguisher', x: 25, y: 1 },
    ]);
    const v = validateFloor(floor, ruleWith(rules, { extinguisherRadiusM: 10 }));
    expect(v.coverage?.regions.length).toBe(2);
    const item = v.items.find((i) => i.type === 'COVERAGE_UNCOVERED');
    expect(item?.point).toEqual(v.coverage!.regions[0].point);
  });
});
