// 补油排程台 —— 数据类型定义

/** 油品类型 */
export type FuelKind = "92#汽油" | "95#汽油" | "0#柴油";

/** 车辆状态 */
export type TruckStatus = "空闲" | "出车中" | "维修中";

/**
 * 一趟补油任务的生命周期：
 * dispatched 已派车(在途) → arrived 已到场/待卸 → delivered 已卸油完成
 * 超过预计到站 2 小时仍未到场的在途任务可被改派，旧任务置为 no_show 失约
 */
export type TripStatus = "dispatched" | "arrived" | "delivered" | "no_show";

/** 油站（含安全库存与地图坐标） */
export interface Station {
  id: string;
  name: string;
  area: string;
  manager: string;
  /** 当前实测库存，单位升 */
  stock: number;
  /** 安全库存阈值，单位升 */
  safetyStock: number;
  /** 罐容，单位升 */
  capacity: number;
  fuelKinds: FuelKind[];
  lat: number;
  lng: number;
  note: string;
  createdAt: string;
}

/** 油罐车台账 */
export interface Truck {
  id: string;
  /** 车牌（车辆编号） */
  plate: string;
  driver: string;
  phone: string;
  /** 额定容量，单位升 */
  capacity: number;
  status: TruckStatus;
  active: boolean;
  createdAt: string;
}

/** 补油排程单 */
export interface Trip {
  id: string;
  stationId: string;
  truckId: string;
  /** 计划卸量，单位升 */
  plannedAmount: number;
  /** 实际卸量，单位升；到场后登记 */
  actualAmount: number | null;
  status: TripStatus;
  /** 预计到站时间 */
  eta: string;
  dispatchedAt: string;
  /** 实际到场时间 */
  arrivedAt: string | null;
  deliveredAt: string | null;
  /** 改派时记录被哪条新任务替代 */
  reassignedBy: string | null;
  note: string;
}

/** 当日实际卸量与计划的差异记录 */
export interface DiffRecord {
  id: string;
  date: string;
  tripId: string;
  stationId: string;
  truckId: string;
  plannedAmount: number;
  actualAmount: number;
  /** 正数表示少卸，负数表示多卸 */
  variance: number;
  createdAt: string;
}

export interface SchedulingState {
  stations: Station[];
  trucks: Truck[];
  trips: Trip[];
  diffs: DiffRecord[];
}
