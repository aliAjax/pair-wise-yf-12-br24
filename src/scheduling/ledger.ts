// 车辆台账层：油站、油罐车、排程单、差异记录的唯一数据源。
// 通过 Pinia 维护内存状态，并整体持久化到浏览器 localStorage（记录留本地）。
// 派车/改派/卸油的"能不能做"由 rules.ts 裁决，本文件只负责"怎么做"。
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import {
  activeTripsOf,
  canDispatch,
  canReassign,
  deliveryVariance,
  isTruckBusy
} from "./rules";
import { todayLocalDate } from "./time";
import type {
  DiffRecord,
  SchedulingState,
  Station,
  Trip,
  Truck
} from "./types";

const STORAGE_KEY = "hxwlfront-21-scheduling-ledger-v1";

// ---- 种子数据：模拟夜间补油的几种典型场景 ----------------------------------
const now = Date.now();
const hour = 60 * 60 * 1000;
const yesterday = todayLocalDate(now - 24 * hour);

function seedState(): SchedulingState {
  const stations: Station[] = [
    {
      id: "s1",
      name: "东区一站",
      area: "东区",
      manager: "刘站长",
      stock: 36000,
      safetyStock: 12000,
      capacity: 60000,
      fuelKinds: ["92#汽油", "95#汽油", "0#柴油"],
      lat: 39.924,
      lng: 116.462,
      note: "库存正常",
      createdAt: new Date(now - 60 * 24 * hour).toISOString()
    },
    {
      id: "s2",
      name: "机场快线站",
      area: "机场线",
      manager: "王站长",
      stock: 8000,
      safetyStock: 15000,
      capacity: 50000,
      fuelKinds: ["92#汽油", "0#柴油"],
      lat: 39.872,
      lng: 116.603,
      note: "柴油待补，夜间罐车在途",
      createdAt: new Date(now - 55 * 24 * hour).toISOString()
    },
    {
      id: "s3",
      name: "西环站",
      area: "西区",
      manager: "陈站长",
      stock: 6000,
      safetyStock: 14000,
      capacity: 45000,
      fuelKinds: ["95#汽油", "0#柴油"],
      lat: 39.908,
      lng: 116.322,
      note: "首台车失约，已改派新车",
      createdAt: new Date(now - 40 * 24 * hour).toISOString()
    },
    {
      id: "s4",
      name: "南环加油站",
      area: "南区",
      manager: "赵站长",
      stock: 9000,
      safetyStock: 12000,
      capacity: 40000,
      fuelKinds: ["92#汽油", "95#汽油"],
      lat: 39.838,
      lng: 116.43,
      note: "罐车已到站，等待卸油",
      createdAt: new Date(now - 30 * 24 * hour).toISOString()
    },
    {
      id: "s5",
      name: "北新区站",
      area: "北区",
      manager: "孙站长",
      stock: 7000,
      safetyStock: 12000,
      capacity: 42000,
      fuelKinds: ["92#汽油", "0#柴油"],
      lat: 39.982,
      lng: 116.418,
      note: "低于安全库存，尚未派车",
      createdAt: new Date(now - 20 * 24 * hour).toISOString()
    }
  ];

  const trucks: Truck[] = [
    {
      id: "t1",
      plate: "冀A·5108",
      driver: "张师傅",
      phone: "138-0001-5108",
      capacity: 30000,
      status: "出车中",
      active: true,
      createdAt: new Date(now - 90 * 24 * hour).toISOString()
    },
    {
      id: "t2",
      plate: "冀A·6623",
      driver: "李师傅",
      phone: "138-0001-6623",
      capacity: 25000,
      status: "出车中",
      active: true,
      createdAt: new Date(now - 80 * 24 * hour).toISOString()
    },
    {
      id: "t3",
      plate: "冀B·7721",
      driver: "周师傅",
      phone: "138-0001-7721",
      capacity: 20000,
      status: "出车中",
      active: true,
      createdAt: new Date(now - 70 * 24 * hour).toISOString()
    },
    {
      id: "t4",
      plate: "冀A·9050",
      driver: "吴师傅",
      phone: "138-0001-9050",
      capacity: 18000,
      status: "维修中",
      active: true,
      createdAt: new Date(now - 65 * 24 * hour).toISOString()
    }
  ];

  const trips: Trip[] = [
    {
      // 机场快线站：在途，尚未到站
      id: "seed-trip-1",
      stationId: "s2",
      truckId: "t2",
      plannedAmount: 20000,
      actualAmount: null,
      status: "dispatched",
      eta: new Date(now + 1 * hour).toISOString(),
      dispatchedAt: new Date(now - 3 * hour).toISOString(),
      arrivedAt: null,
      deliveredAt: null,
      reassignedBy: null,
      note: "夜间补柴油"
    },
    {
      // 南环站：已到站待卸
      id: "seed-trip-2",
      stationId: "s4",
      truckId: "t3",
      plannedAmount: 12000,
      actualAmount: null,
      status: "arrived",
      eta: new Date(now - 20 * 60000).toISOString(),
      dispatchedAt: new Date(now - 4 * hour).toISOString(),
      arrivedAt: new Date(now - 10 * 60000).toISOString(),
      deliveredAt: null,
      reassignedBy: null,
      note: ""
    },
    {
      // 西环站：旧车超预计 2 小时未到，失约
      id: "seed-trip-3",
      stationId: "s3",
      truckId: "t4",
      plannedAmount: 18000,
      actualAmount: null,
      status: "no_show",
      eta: new Date(now - 3 * hour).toISOString(),
      dispatchedAt: new Date(now - 8 * hour).toISOString(),
      arrivedAt: null,
      deliveredAt: null,
      reassignedBy: "seed-trip-4",
      note: "车辆故障，未按时到场"
    },
    {
      // 西环站：改派的新车，在途
      id: "seed-trip-4",
      stationId: "s3",
      truckId: "t1",
      plannedAmount: 18000,
      actualAmount: null,
      status: "dispatched",
      eta: new Date(now + 90 * 60000).toISOString(),
      dispatchedAt: new Date(now - 40 * 60000).toISOString(),
      arrivedAt: null,
      deliveredAt: null,
      reassignedBy: null,
      note: "改派新车"
    },
    {
      // 东区一站：昨夜已卸，但实卸不足计划，留下差异
      id: "seed-trip-5",
      stationId: "s1",
      truckId: "t3",
      plannedAmount: 20000,
      actualAmount: 17000,
      status: "delivered",
      eta: new Date(now - 22 * hour).toISOString(),
      dispatchedAt: new Date(now - 26 * hour).toISOString(),
      arrivedAt: new Date(now - 22 * hour + 15 * 60000).toISOString(),
      deliveredAt: new Date(now - 22 * hour + 40 * 60000).toISOString(),
      reassignedBy: null,
      note: "罐底油未卸净"
    }
  ];

  const diffs: DiffRecord[] = [
    {
      id: "seed-diff-1",
      date: yesterday,
      tripId: "seed-trip-5",
      stationId: "s1",
      truckId: "t3",
      plannedAmount: 20000,
      actualAmount: 17000,
      variance: 3000,
      createdAt: new Date(now - 22 * hour).toISOString()
    }
  ];

  return { stations, trucks, trips, diffs };
}

function loadState(): SchedulingState {
  const fallback = seedState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<SchedulingState>;
    // 本地数据缺字段时用种子数据补齐，避免旧版本数据导致页面崩溃
    return {
      stations: Array.isArray(parsed.stations) ? parsed.stations : fallback.stations,
      trucks: Array.isArray(parsed.trucks) ? parsed.trucks : fallback.trucks,
      trips: Array.isArray(parsed.trips) ? parsed.trips : fallback.trips,
      diffs: Array.isArray(parsed.diffs) ? parsed.diffs : fallback.diffs
    };
  } catch {
    return fallback;
  }
}

export interface DispatchInput {
  stationId: string;
  truckId: string;
  plannedAmount: number;
  eta: string;
  note: string;
}

export interface UnloadResult {
  variance: number;
  hasDiff: boolean;
  stillWarned: boolean;
}

export const useLedgerStore = defineStore("scheduling-ledger", () => {
  const initial = loadState();
  const stations = ref<Station[]>(initial.stations);
  const trucks = ref<Truck[]>(initial.trucks);
  const trips = ref<Trip[]>(initial.trips);
  const diffs = ref<DiffRecord[]>(initial.diffs);

  // 任意变更后整体写回 localStorage（记录留本地）
  watch(
    () => ({ stations: stations.value, trucks: trucks.value, trips: trips.value, diffs: diffs.value }),
    (snapshot) => localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)),
    { deep: true }
  );

  const stateRefs = { stations, trucks, trips, diffs };
  const state = computed<SchedulingState>(() => ({
    stations: stations.value,
    trucks: trucks.value,
    trips: trips.value,
    diffs: diffs.value
  }));

  function stationById(id: string): Station | undefined {
    return stations.value.find((item) => item.id === id);
  }
  function truckById(id: string): Truck | undefined {
    return trucks.value.find((item) => item.id === id);
  }
  function tripById(id: string): Trip | undefined {
    return trips.value.find((item) => item.id === id);
  }

  // ---- 油站台账 -----------------------------------------------------------
  function addStation(input: Omit<Station, "id" | "createdAt">): Station {
    const station: Station = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
    stations.value = [station, ...stations.value];
    return station;
  }

  function updateStation(id: string, patch: Partial<Station>) {
    stations.value = stations.value.map((item) =>
      item.id === id ? { ...item, ...patch, id: item.id } : item
    );
  }

  function removeStation(id: string): boolean {
    if (trips.value.some((trip) => trip.stationId === id)) return false;
    stations.value = stations.value.filter((item) => item.id !== id);
    return true;
  }

  // ---- 油罐车台账 ----------------------------------------------------------
  function addTruck(input: Omit<Truck, "id" | "createdAt" | "status" | "active"> & Partial<Pick<Truck, "status">>): Truck {
    const truck: Truck = {
      ...input,
      id: crypto.randomUUID(),
      status: input.status ?? "空闲",
      active: true,
      createdAt: new Date().toISOString()
    };
    trucks.value = [truck, ...trucks.value];
    return truck;
  }

  function updateTruck(id: string, patch: Partial<Truck>) {
    trucks.value = trucks.value.map((item) =>
      item.id === id ? { ...item, ...patch, id: item.id } : item
    );
  }

  function removeTruck(id: string): boolean {
    // 有历史排程的车辆保留台账（失约记录要能追溯），只能停用不能删除
    if (trips.value.some((trip) => trip.truckId === id)) return false;
    trucks.value = trucks.value.filter((item) => item.id !== id);
    return true;
  }

  // ---- 排程单 -------------------------------------------------------------
  /** 派车登记：油罐车编号、预计到站、计划卸量 */
  function dispatch(input: DispatchInput): { ok: boolean; reason?: string; trip?: Trip } {
    const guard = canDispatch(state.value, input.stationId);
    if (!guard.ok) return guard;

    const truck = truckById(input.truckId);
    if (!truck) return { ok: false, reason: "请选择油罐车" };
    if (!truck.active) return { ok: false, reason: "该油罐车已停用" };
    if (truck.status === "维修中") return { ok: false, reason: "该油罐车维修中，无法派车" };
    if (isTruckBusy(state.value, truck.id)) return { ok: false, reason: "该油罐车还有未完成的补油任务" };
    if (!(input.plannedAmount > 0)) return { ok: false, reason: "计划卸量必须大于 0" };
    if (input.plannedAmount > truck.capacity)
      return { ok: false, reason: `计划卸量超过车辆额定容量 ${truck.capacity} L` };
    const etaTime = new Date(input.eta).getTime();
    if (Number.isNaN(etaTime)) return { ok: false, reason: "预计到站时间无效" };

    const trip: Trip = {
      id: crypto.randomUUID(),
      stationId: input.stationId,
      truckId: input.truckId,
      plannedAmount: input.plannedAmount,
      actualAmount: null,
      status: "dispatched",
      eta: new Date(etaTime).toISOString(),
      dispatchedAt: new Date().toISOString(),
      arrivedAt: null,
      deliveredAt: null,
      reassignedBy: null,
      note: input.note
    };
    trips.value = [trip, ...trips.value];
    updateTruck(truck.id, { status: "出车中" });
    return { ok: true, trip };
  }

  /** 车辆到场登记（在途 → 已到站·待卸） */
  function markArrived(tripId: string): boolean {
    const trip = tripById(tripId);
    if (!trip || trip.status !== "dispatched") return false;
    trips.value = trips.value.map((item) =>
      item.id === tripId
        ? { ...item, status: "arrived", arrivedAt: new Date().toISOString() }
        : item
    );
    return true;
  }

  /**
   * 登记实际卸量：在途/待卸 → 已卸油。
   * 实际卸量不足计划时，记当天差异；卸后仍低于安全库存由调用方继续预警。
   */
  function registerUnload(tripId: string, actualAmount: number): UnloadResult | { ok: false; reason: string } {
    const trip = tripById(tripId);
    if (!trip || (trip.status !== "arrived" && trip.status !== "dispatched"))
      return { ok: false, reason: "当前任务状态不能登记卸油" };
    if (!(actualAmount >= 0)) return { ok: false, reason: "实际卸量不能为负" };

    const variance = deliveryVariance(trip.plannedAmount, actualAmount);
    const deliveredAt = new Date().toISOString();

    trips.value = trips.value.map((item) =>
      item.id === trip.id
        ? {
            ...item,
            status: "delivered",
            actualAmount,
            arrivedAt: item.arrivedAt ?? deliveredAt,
            deliveredAt
          }
        : item
    );

    // 库存按实际卸量入库，且不超过罐容
    const station = stationById(trip.stationId);
    if (station) {
      updateStation(station.id, {
        stock: Math.min(station.capacity, station.stock + actualAmount)
      });
    }

    // 实卸不足计划：记当天差异
    if (actualAmount < trip.plannedAmount) {
      const record: DiffRecord = {
        id: crypto.randomUUID(),
        date: todayLocalDate(),
        tripId: trip.id,
        stationId: trip.stationId,
        truckId: trip.truckId,
        plannedAmount: trip.plannedAmount,
        actualAmount,
        variance,
        createdAt: deliveredAt
      };
      diffs.value = [record, ...diffs.value];
    }

    // 该车没有其他在途任务后回到空闲
    if (!isTruckBusy(state.value, trip.truckId)) {
      updateTruck(trip.truckId, { status: "空闲" });
    }

    return {
      variance,
      hasDiff: actualAmount < trip.plannedAmount,
      stillWarned: station
        ? projectedBelowSafety(state.value, station.id, station)
        : false
    };
  }

  /**
   * 超过预计时间两小时仍未到场 → 改派新车。
   * 旧任务保留为失约记录（no_show），并挂上新任务编号。
   */
  function reassign(
    oldTripId: string,
    input: Pick<DispatchInput, "truckId" | "plannedAmount" | "eta" | "note">
  ): { ok: boolean; reason?: string; trip?: Trip } {
    const oldTrip = tripById(oldTripId);
    if (!oldTrip) return { ok: false, reason: "未找到原排程单" };
    if (!canReassign(oldTrip)) return { ok: false, reason: "未超过预计到站时间两小时，暂不能改派" };

    const truck = truckById(input.truckId);
    if (!truck || !truck.active) return { ok: false, reason: "请选择可用的新油罐车" };
    if (truck.status === "维修中") return { ok: false, reason: "该油罐车维修中，无法派车" };
    if (isTruckBusy(state.value, truck.id)) return { ok: false, reason: "该油罐车还有未完成的补油任务" };
    if (!(input.plannedAmount > 0) || input.plannedAmount > truck.capacity)
      return { ok: false, reason: "计划卸量不合法或超过车辆容量" };
    if (truck.id === oldTrip.truckId) return { ok: false, reason: "改派请选择另一台油罐车" };

    const newTrip: Trip = {
      id: crypto.randomUUID(),
      stationId: oldTrip.stationId,
      truckId: input.truckId,
      plannedAmount: input.plannedAmount,
      actualAmount: null,
      status: "dispatched",
      eta: new Date(input.eta).toISOString(),
      dispatchedAt: new Date().toISOString(),
      arrivedAt: null,
      deliveredAt: null,
      reassignedBy: null,
      note: input.note || `改派（原车 ${truckById(oldTrip.truckId)?.plate ?? oldTrip.truckId} 失约）`
    };

    // 旧车：保留失约记录；若没有别的在途任务则回到空闲/维修不自动改，由台账维护
    trips.value = [
      newTrip,
      ...trips.value.map((item) =>
        item.id === oldTrip.id ? { ...item, status: "no_show" as const, reassignedBy: newTrip.id } : item
      )
    ];
    if (!isTruckBusy(state.value, oldTrip.truckId)) {
      const oldTruck = truckById(oldTrip.truckId);
      if (oldTruck && oldTruck.status !== "维修中") updateTruck(oldTruck.id, { status: "空闲" });
    }
    updateTruck(truck.id, { status: "出车中" });
    return { ok: true, trip: newTrip };
  }

  function resetDemo() {
    localStorage.removeItem(STORAGE_KEY);
    const fresh = seedState();
    stations.value = fresh.stations;
    trucks.value = fresh.trucks;
    trips.value = fresh.trips;
    diffs.value = fresh.diffs;
  }

  return {
    // state
    ...stateRefs,
    state,
    // lookups
    stationById,
    truckById,
    tripById,
    activeTripsOf: (stationId: string) => activeTripsOf(state.value, stationId),
    // stations
    addStation,
    updateStation,
    removeStation,
    // trucks
    addTruck,
    updateTruck,
    removeTruck,
    // scheduling
    dispatch,
    markArrived,
    registerUnload,
    reassign,
    resetDemo
  };
});

// rules 中的库存预估需要结合"卸油后"的临时状态，这里做本地小工具避免循环依赖
function projectedBelowSafety(state: SchedulingState, _stationId: string, station: Station): boolean {
  const inbound = activeTripsOf(state, station.id).reduce(
    (sum, trip) => sum + trip.plannedAmount,
    0
  );
  return Math.min(station.capacity, station.stock + inbound) < station.safetyStock;
}
