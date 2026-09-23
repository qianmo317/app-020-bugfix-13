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

  it('C11 多台灭火器联合判定：两台各管一段合起来全覆盖（回归：只算第一台）', () => {
    // 50m 走道两台灭火器 (12.5,1)/(37.5,1)，办公规则 r20：单台 r15 必露 20㎡+，两台联合全覆盖
    const { floor, rules } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 50, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 49.5, y: 1 },
      { kind: 'extinguisher', x: 12.5, y: 1 },
      { kind: 'extinguisher', x: 37.5, y: 1 },
    ]);
    const v = validateFloor(floor, rules);
    expect(v.coverage).not.toBeNull();
    expect(v.coverage!.uncoveredM2).toBe(0);
    expect(v.coverage!.pass).toBe(true);
    expect(v.items.some((i) => i.type === 'COVERAGE_UNCOVERED')).toBe(false);
    expect(v.pass).toBe(true);
  });

  it('C12 判定半径跟随当前规则：r15 不合规、r20 合规，结论文案与快照同规则一致', () => {
    const { floor } = mkFloor([mkRoom('走道', 'corridor', rect(0, 0, 41, 2))], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
      { kind: 'extinguisher', x: 20.5, y: 1 },
    ]);
    const tight = validateFloor(floor, ruleWith(DEFAULT_RULES.office, { extinguisherRadiusM: 15 }));
    const item = tight.items.find((i) => i.type === 'COVERAGE_UNCOVERED');
    expect(item).toBeDefined();
    expect(item!.message).toContain('（15m）'); // 结论里写的半径 = 判定用的半径
    expect(tight.rulesSnapshot.extinguisherRadiusM).toBe(15);
    expect(tight.coverage!.pass).toBe(false);

    const loose = validateFloor(floor, ruleWith(DEFAULT_RULES.office, { extinguisherRadiusM: 20 }));
    expect(loose.items.some((i) => i.type === 'COVERAGE_UNCOVERED')).toBe(false);
    expect(loose.coverage!.pass).toBe(true);
    expect(loose.rulesSnapshot.extinguisherRadiusM).toBe(20);
    expect(loose.pass).toBe(true);
    // 合格但仍有小块未覆盖时，区域清单照样给出（可逐块定位）
    expect(loose.coverage!.regions.length).toBe(2);
  });

  it('C13 未覆盖区域聚簇：可定位、能说明距最近灭火器差多远', () => {
    const room = mkRoom('走道', 'corridor', rect(0, 0, 41, 2));
    const r = computeCoverage([room], [pt(20.5, 1)], 12);
    expect(r.regions.length).toBe(2); // 东西两端各一块
    const west = r.regions.find((g) => g.point.x < 20.5 * MM_PER_M)!;
    const east = r.regions.find((g) => g.point.x > 20.5 * MM_PER_M)!;
    for (const g of [west, east]) {
      expect(g.areaM2).toBeGreaterThan(15.3); // 人工 8.5m × 2m = 17㎡ ±10%
      expect(g.areaM2).toBeLessThan(18.7);
      expect(g.nearestM).toBeGreaterThan(19.8); // 最远格心 (0.25,0.25) 距 (20.5,1) ≈ 20.26m
      expect(g.nearestM).toBeLessThan(20.8);
      expect(g.gapM).toBeCloseTo(g.nearestM - 12, 6); // 差多远 = 最近距离 − 判定半径
    }
    expect(west.point.x / MM_PER_M).toBeLessThan(1); // 定位点落在西端格心
    expect(east.point.x / MM_PER_M).toBeGreaterThan(40);

    // 引擎集成：区域随校验结果返回，COVERAGE_UNCOVERED 项写清最差差距并给定位点
    const { floor } = mkFloor([room], [
      { kind: 'exit', x: 0.5, y: 1 },
      { kind: 'exit', x: 40.5, y: 1 },
      { kind: 'extinguisher', x: 20.5, y: 1 },
    ], 'factory'); // 厂规 r12
    const v = validateFloor(floor, DEFAULT_RULES.factory);
    expect(v.coverage!.regions.length).toBe(2);
    const item = v.items.find((i) => i.type === 'COVERAGE_UNCOVERED')!;
    expect(item.message).toContain('（12m）');
    expect(item.message).toContain('超半径');
    expect(item.point).toBeDefined();
  });
});
