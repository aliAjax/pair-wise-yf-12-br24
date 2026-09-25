// 排程规则模块：只负责调度判断与状态流转，不依赖页面和存储。

export const OVERDUE_HOURS = 2; // 超过预计到站 2 小时仍未到场，允许改派
const HOUR_MS = 3_600_000;

export type DeliveryStatus = "在途" | "已完成" | "失约";

export interface Delivery {
  id: string;
  stationId: string;
  truckNo: string;
  eta: string; // 预计到站时间（ISO）
  plannedQty: number; // 计划卸量 L
  actualQty: number | null; // 实际卸量 L
  status: DeliveryStatus;
  arrivedAt: string | null;
  createdAt: string;
  note: string;
}

export interface VarianceRecord {
  id: string;
  stationId: string;
  date: string; // 当地日期 YYYY-MM-DD
  plannedQty: number;
  actualQty: number;
  diff: number; // 计划 - 实际
  handled: boolean; // 预警是否已处理
}

export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 未到站车辆：状态仍为在途 */
export const isPending = (delivery: Delivery): boolean => delivery.status === "在途";

/** 超过预计时间两小时仍未到场 */
export function isOverdue(delivery: Delivery, now: Date): boolean {
  return (
    isPending(delivery) &&
    now.getTime() - new Date(delivery.eta).getTime() > OVERDUE_HOURS * HOUR_MS
  );
}

/** 已超出的小时数（用于展示） */
export function overdueHours(delivery: Delivery, now: Date): number {
  return Math.max(
    0,
    (now.getTime() - new Date(delivery.eta).getTime()) / HOUR_MS - OVERDUE_HOURS
  );
}

export function pendingOf(deliveries: Delivery[], stationId: string): Delivery[] {
  return deliveries.filter((delivery) => delivery.stationId === stationId && isPending(delivery));
}

/** 该站在途计划卸量合计 */
export function inTransitQty(deliveries: Delivery[], stationId: string): number {
  return pendingOf(deliveries, stationId).reduce((sum, delivery) => sum + delivery.plannedQty, 0);
}

/** 库存预估 = 当前库存 + 在途计划卸量 */
export function estimatedStock(
  stock: number,
  deliveries: Delivery[],
  stationId: string
): number {
  return stock + inTransitQty(deliveries, stationId);
}

/** 有未到站车辆时该站显示待卸，不再重复派车 */
export function canDispatch(deliveries: Delivery[], stationId: string): boolean {
  return pendingOf(deliveries, stationId).length === 0;
}

export function hasActiveVariance(
  variances: VarianceRecord[],
  stationId: string,
  today: string
): boolean {
  return variances.some(
    (variance) =>
      variance.stationId === stationId && variance.date === today && !variance.handled
  );
}

/** 预警：预估库存低于安全库存，或当天存在未处理卸量差异 */
export function stationWarning(
  stock: number,
  safetyStock: number,
  deliveries: Delivery[],
  variances: VarianceRecord[],
  stationId: string,
  today: string
): boolean {
  return (
    estimatedStock(stock, deliveries, stationId) < safetyStock ||
    hasActiveVariance(variances, stationId, today)
  );
}

/** 到站卸货：实际卸量不足计划则记当天差异，继续预警 */
export function completeDelivery(
  delivery: Delivery,
  actualQty: number,
  at: Date
): { done: Delivery; variance: VarianceRecord | null } {
  const done: Delivery = {
    ...delivery,
    status: "已完成",
    actualQty,
    arrivedAt: at.toISOString()
  };
  const variance: VarianceRecord | null =
    actualQty < delivery.plannedQty
      ? {
          id: crypto.randomUUID(),
          stationId: delivery.stationId,
          date: localDay(at),
          plannedQty: delivery.plannedQty,
          actualQty,
          diff: delivery.plannedQty - actualQty,
          handled: false
        }
      : null;
  return { done, variance };
}

/** 超时改派：旧单记失约并保留，另开新的在途单 */
export function reassignDelivery(
  old: Delivery,
  truckNo: string,
  eta: Date,
  at: Date
): { missed: Delivery; next: Delivery } {
  const missed: Delivery = { ...old, status: "失约" };
  const next: Delivery = {
    id: crypto.randomUUID(),
    stationId: old.stationId,
    truckNo,
    eta: eta.toISOString(),
    plannedQty: old.plannedQty,
    actualQty: null,
    status: "在途",
    arrivedAt: null,
    createdAt: at.toISOString(),
    note: `由失约车 ${old.truckNo} 改派`
  };
  return { missed, next };
}
