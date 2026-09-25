<script setup lang="ts">
// 油站补油排程台 —— 页面装配层：
// 排程规则见 src/scheduling/rules.ts，车辆/排程台账见 src/scheduling/ledger.ts，
// 本文件只负责把地图、站点列表、排程台、台账和流水组合到一起。
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import MapBoard from "./components/MapBoard.vue";
import StationList from "./components/StationList.vue";
import DispatchConsole from "./components/DispatchConsole.vue";
import FleetLedger from "./components/FleetLedger.vue";
import TripLog from "./components/TripLog.vue";
import { useLedgerStore } from "./scheduling/ledger";
import { buildStationView, buildTruckView } from "./scheduling/view";
import { useNow } from "./composables/useNow";
import { todayLocalDate } from "./scheduling/time";
import type { Station } from "./scheduling/types";

const store = useLedgerStore();
const now = useNow(30_000);

const selectedId = ref<string | null>(
  store.stations.find((s) => s.id === "s2")?.id ?? store.stations[0]?.id ?? null
);
const mapRef = ref<{ startPicking: () => void } | null>(null);

const areas = computed(() => [...new Set(store.stations.map((s) => s.area))]);

const stationViews = computed(() =>
  store.stations.map((station) => buildStationView(store.state, station, now.value))
);

const truckViews = computed(() =>
  store.trucks.map((truck) => buildTruckView(store.state, truck))
);

const selectedView = computed(() =>
  stationViews.value.find((view) => view.station.id === selectedId.value) ?? null
);

const metrics = computed(() => {
  const today = todayLocalDate(now.value);
  return [
    { label: "油站网点", value: store.stations.length },
    { label: "待卸站点", value: stationViews.value.filter((v) => v.status === "待卸").length },
    {
      label: "库存紧张",
      value: stationViews.value.filter((v) => v.status === "紧张").length
    },
    {
      label: "在途车辆",
      value: store.trips.filter((t) => t.status === "dispatched" || t.status === "arrived").length
    },
    {
      label: "今日差异",
      value: store.diffs.filter((d) => d.date === today).length
    }
  ];
});

function selectStation(id: string) {
  selectedId.value = id;
}

function addStation(input: Omit<Station, "id" | "createdAt">) {
  const station = store.addStation(input);
  selectedId.value = station.id;
  ElMessage.success("油站已保存并定位");
}

function resetDemo() {
  if (!window.confirm("恢复演示数据？当前本地记录将被覆盖。")) return;
  store.resetDemo();
  selectedId.value =
    store.stations.find((s) => s.id === "s2")?.id ?? store.stations[0]?.id ?? null;
  ElMessage.success("已恢复演示数据");
}

function truckLabel(id: string) {
  const truck = store.truckById(id);
  return truck ? `${truck.plate}（${truck.driver}）` : id;
}
</script>

<template>
  <main class="app dispatch-app">
    <div class="shell wide">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 夜间补油调度</p>
          <h1>油站补油排程台</h1>
          <p class="subtitle">
            地图上登记安全库存、油罐车编号、预计到站与计划卸量；有未到站车辆的站点显示「待卸」、不再重复派车，
            库存按在途量预估；超预计 2 小时未到场可改派新车并保留旧车失约记录，实卸不足计划自动记当天差异。
          </p>
        </div>
        <div class="head-actions">
          <div class="stack">
            <span v-for="item in ['Vue3', 'Leaflet', 'TypeScript', 'localStorage']" :key="item" class="tag">
              {{ item }}
            </span>
          </div>
          <button type="button" class="secondary" @click="resetDemo">恢复演示数据</button>
        </div>
      </header>

      <section class="metrics metrics-5">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <div class="layout-grid">
        <StationList
          :stations="stationViews"
          :areas="areas"
          :selected-id="selectedId"
          @select="selectStation"
          @add="addStation"
          @pick-request="mapRef?.startPicking()"
        />

        <section class="panel map-panel">
          <div class="toolbar">
            <h2>网点地图</h2>
            <p class="map-legend">
              <i class="dot st-正常" /> 正常
              <i class="dot st-待卸" /> 待卸
              <i class="dot st-紧张" /> 库存紧张
            </p>
          </div>
          <MapBoard
            ref="mapRef"
            :stations="stationViews"
            :selected-id="selectedId"
            :truck-label="truckLabel"
            @select="selectStation"
          />
        </section>

        <div v-if="selectedView" class="console-slot">
          <DispatchConsole :view="selectedView" :trucks="truckViews" :now="now" />
        </div>
        <div v-else class="panel console-slot empty-slot">
          <p class="empty">请选择一个油站查看排程台</p>
        </div>
      </div>

      <FleetLedger :trucks="truckViews" />
      <TripLog @select-station="selectStation" />

      <footer class="page-foot">
        排程规则（rules）、车辆与排程台账（ledger）、页面交互（components）分开维护；所有记录保存在本地浏览器 localStorage。
      </footer>
    </div>
  </main>
</template>
