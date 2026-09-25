// 排程规则层：全部为纯函数，不依赖 localStorage、Pinia 或 UI。
// 规则调整只改本文件，车辆台账与页面交互不受影响。
import type { SchedulingState, Station, Trip, TripStatus } from "./types";

/** 超过预计到站时间多少毫秒仍未到场，允许改派新车 */
export const REASSIGN_GRACE_MS = 2 * 60 * 60 * 1000;
/** 低于安全库存的比例线即视为库存紧张（默认 100%，即 stock < safetyStock 才预警；可调参数化） */
export const SAFETY_RATIO = 1;

/** 判断一趟任务是否超过预计到站时间 */
export function isPastEta(trip: Trip, now: number = Date.now()): boolean {
  return new Date(trip.eta).getTime() < now;
}

/**
 * 超过预计到站时间两小时仍未到场（且状态还是已派车在途）。
 * 满足此条件的旧车可被改派，并保留失约记录。
 */
export function isNoShow(trip: Trip, now: number = Date.now()): boolean {
  return trip.status === "dispatched" && now - new Date(trip.eta).getTime() > REASSIGN_GRACE_MS;
}

/** 该站当前未完成（未实际卸油）的任务：在途 / 已到场待卸 */
export function activeTripsOf(state: Pick<SchedulingState, "trips">, stationId: string): Trip[] {
  return state.trips.filter(
    (trip) =>
      trip.stationId === stationId &&
      (trip.status === "dispatched" || trip.status === "arrived")
  );
}

/** 该站是否已有未到站（含已到场待卸）车辆，用于地图“待卸”标记与禁止重复派车 */
export function hasPendingTruck(state: Pick<SchedulingState, "trips">, stationId: string): boolean {
  return activeTripsOf(state, stationId).length > 0;
}

/** 派车前置校验：有待卸车辆的站点不再重复派车 */
export function canDispatch(
  state: Pick<SchedulingState, "trips">,
  stationId: string
): { ok: boolean; reason?: string } {
  const pending = activeTripsOf(state, stationId);
  if (pending.length > 0) {
    const arrived = pending.some((trip) => trip.status === "arrived");
    return {
      ok: false,
      reason: arrived
        ? "已有油罐车到站待卸，无需重复派车"
        : "该站已有在途车辆，请勿重复派车"
    };
  }
  return { ok: true };
}

/** 允许改派：旧车超过预计时间两小时仍未到场 */
export function canReassign(trip: Trip, now: number = Date.now()): boolean {
  return isNoShow(trip, now);
}

/** 该站在途/待卸任务的计划卸量合计，用于库存预估 */
export function inboundAmount(state: Pick<SchedulingState, "trips">, stationId: string): number {
  return activeTripsOf(state, stationId).reduce((sum, trip) => sum + trip.plannedAmount, 0);
}

/** 按在途量预估的库存（现有库存 + 在途计划卸量），不超过罐容 */
export function projectedStock(
  state: Pick<SchedulingState, "trips">,
  station: Station
): number {
  return Math.min(station.capacity, station.stock + inboundAmount(state, station.id));
}

/** 库存是否低于安全库存（预估口径，把在途量算进来） */
export function isBelowSafety(state: Pick<SchedulingState, "trips">, station: Station): boolean {
  return projectedStock(state, station) < station.safetyStock * SAFETY_RATIO;
}

export type StationDisplayStatus = "正常" | "待卸" | "紧张";

/**
 * 地图站点显示状态：
 * - 有未到站车辆（在途或待卸）→ 待卸
 * - 预估库存低于安全库存 → 紧张
 * - 其余 → 正常
 */
export function stationStatus(
  state: Pick<SchedulingState, "trips">,
  station: Station,
  now: number = Date.now()
): StationDisplayStatus {
  if (hasPendingTruck(state, station.id)) return "待卸";
  if (isBelowSafety(state, station)) return "紧张";
  return "正常";
}

/** 某车当前是否挂着未完成任务 */
export function isTruckBusy(state: Pick<SchedulingState, "trips">, truckId: string): boolean {
  return state.trips.some(
    (trip) =>
      trip.truckId === truckId &&
      (trip.status === "dispatched" || trip.status === "arrived")
  );
}

/** 车辆历史失约次数（旧车改派后保留的失约记录） */
export function truckNoShowCount(state: Pick<SchedulingState, "trips">, truckId: string): number {
  return state.trips.filter((trip) => trip.truckId === truckId && trip.status === "no_show").length;
}

/** 卸油完成时的差异：实际不足计划记正差异（少卸升数） */
export function deliveryVariance(planned: number, actual: number): number {
  return planned - actual;
}

/** 卸油后该站是否仍需继续预警（按在途量预估仍低于安全库存） */
export function stillNeedsWarning(
  state: Pick<SchedulingState, "trips">,
  station: Station
): boolean {
  return isBelowSafety(state, station);
}

/** 取某站当天（按本地日期）的差异记录 */
export function diffsOfDate(
  state: Pick<SchedulingState, "diffs">,
  stationId: string,
  date: string
) {
  return state.diffs.filter((diff) => diff.stationId === stationId && diff.date === date);
}

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  dispatched: "在途",
  arrived: "已到站·待卸",
  delivered: "已卸油",
  no_show: "失约改派"
};

export const STATION_STATUS_LABEL: Record<StationDisplayStatus, string> = {
  正常: "正常",
  待卸: "待卸",
  紧张: "库存紧张"
};
