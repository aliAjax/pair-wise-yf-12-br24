// 页面视图模型：把台账状态 + 排程规则组装成页面直接消费的结构。
// 页面组件只做交互与展示，不在这里写业务判断。
import {
  activeTripsOf,
  inboundAmount,
  isBelowSafety,
  isNoShow,
  isTruckBusy,
  projectedStock,
  stationStatus,
  truckNoShowCount
} from "./rules";
import type { SchedulingState, Station, Trip, Truck } from "./types";
import type { StationDisplayStatus } from "./rules";

export interface StationView {
  station: Station;
  status: StationDisplayStatus;
  activeTrips: Trip[];
  /** 在途计划卸量合计 */
  inbound: number;
  /** 计入在途量后的预估库存 */
  projected: number;
  belowSafety: boolean;
}

export function buildStationView(
  state: SchedulingState,
  station: Station,
  now: number
): StationView {
  return {
    station,
    status: stationStatus(state, station, now),
    activeTrips: activeTripsOf(state, station.id),
    inbound: inboundAmount(state, station.id),
    projected: projectedStock(state, station),
    belowSafety: isBelowSafety(state, station)
  };
}

export interface TruckView {
  truck: Truck;
  /** 台账状态被在途任务实时覆盖：有任务就是出车中 */
  effectiveStatus: Truck["status"];
  busy: boolean;
  noShowCount: number;
  tripCount: number;
}

export function buildTruckView(state: SchedulingState, truck: Truck): TruckView {
  const busy = isTruckBusy(state, truck.id);
  return {
    truck,
    effectiveStatus: busy ? "出车中" : truck.status,
    busy,
    noShowCount: truckNoShowCount(state, truck.id),
    tripCount: state.trips.filter((trip) => trip.truckId === truck.id).length
  };
}

/** 一趟任务在当前时刻是否已构成失约（供列表高亮/按钮启用判断） */
export function tripOverdue(trip: Trip, now: number): boolean {
  return isNoShow(trip, now);
}

export { isTruckBusy };
