// 车辆台账：油罐车档案与本地留存。
// 台账只存静态档案；在途/失约等状态由调度单推导，避免两处维护。

import { loadJson, saveJson } from "./storage";
import { isPending, type Delivery } from "../domain/scheduling";

export const FLEET_KEY = "hxwlfront-21-fleet";

export interface Tanker {
  no: string; // 油罐车编号
  driver: string;
  capacity: number; // 容量 L
}

export const TANKER_SEED: readonly Tanker[] = [
  { no: "皖A·T1021", driver: "赵长海", capacity: 30000 },
  { no: "皖A·T1035", driver: "孙立新", capacity: 26000 },
  { no: "皖B·T2208", driver: "钱伟", capacity: 32000 },
  { no: "皖C·T0316", driver: "周敏", capacity: 18000 }
];

export function loadFleet(): Tanker[] {
  return loadJson(FLEET_KEY, () => [...TANKER_SEED]);
}

export function saveFleet(fleet: Tanker[]): void {
  saveJson(FLEET_KEY, fleet);
}

/** 有未到站调度单的车视为在途，派车时不可再选 */
export function truckBusy(no: string, deliveries: Delivery[]): boolean {
  return deliveries.some((delivery) => delivery.truckNo === no && isPending(delivery));
}

/** 旧车保留失约记录：按失约调度单计数 */
export function missCount(no: string, deliveries: Delivery[]): number {
  return deliveries.filter((delivery) => delivery.truckNo === no && delivery.status === "失约")
    .length;
}
