<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import {
  OVERDUE_HOURS,
  canDispatch,
  completeDelivery,
  estimatedStock,
  inTransitQty,
  isOverdue,
  isPending,
  localDay,
  overdueHours,
  pendingOf,
  reassignDelivery,
  stationWarning,
  type Delivery,
  type VarianceRecord
} from "./domain/scheduling";
import {
  loadFleet,
  missCount,
  saveFleet,
  truckBusy,
  type Tanker
} from "./data/fleet";
import { loadJson, saveJson } from "./data/storage";

type Field = {
  key: keyof Station;
  label: string;
  type?: "number" | "select";
  options?: readonly string[];
};

interface Station {
  id: string;
  station: string;
  area: string;
  stock: number; // 当前库存 L
  safetyStock: number; // 安全库存 L
  manager: string;
  status: string;
  notes: string;
  createdAt: string;
}

const STATION_KEY = "hxwlfront-21-station-map";
const DELIVERY_KEY = "hxwlfront-21-deliveries";
const VARIANCE_KEY = "hxwlfront-21-variances";

const project = {
  title: "油站补油排程台",
  subtitle:
    "登记安全库存、油罐车、预计到站与计划卸量。有未到站车辆时该站待卸、不重复派车；超时两小时可改派，旧车留失约记录；实卸不足记当天差异并继续预警。",
  industry: "石油",
  stack: ["Vue3", "Vite", "TypeScript", "Element Plus", "Leaflet"],
  formTitle: "新增油站",
  primaryAction: "保存油站",
  entityLabel: "油站",
  statuses: ["营业中", "暂停营业", "库存紧张"],
  filters: ["全部区域", "东区", "西区", "机场线"],
  metricLabels: ["油站数", "待卸站", "在途油量L", "预警站"]
} as const;

const fields: readonly Field[] = [
  { key: "station", label: "油站名称" },
  { key: "area", label: "区域", type: "select", options: ["东区", "西区", "机场线"] },
  { key: "stock", label: "当前库存L", type: "number" },
  { key: "safetyStock", label: "安全库存L", type: "number" },
  { key: "manager", label: "负责人" }
];
const statuses = [...project.statuses];

function seedStations(): Station[] {
  return [
    {
      id: "seed-1",
      station: "东区一站",
      area: "东区",
      stock: 36000,
      safetyStock: 15000,
      manager: "刘站长",
      status: "营业中",
      notes: "库存正常",
      createdAt: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: "seed-2",
      station: "机场快线站",
      area: "机场线",
      stock: 9000,
      safetyStock: 12000,
      manager: "王站长",
      status: "库存紧张",
      notes: "柴油待补",
      createdAt: new Date().toISOString()
    }
  ];
}

function seedDeliveries(): Delivery[] {
  return [
    {
      id: "seed-d1",
      stationId: "seed-2",
      truckNo: "皖A·T1021",
      eta: new Date(Date.now() + 3 * 3600000).toISOString(),
      plannedQty: 20000,
      actualQty: null,
      status: "在途",
      arrivedAt: null,
      createdAt: new Date().toISOString(),
      note: "夜间补油"
    },
    {
      id: "seed-d2",
      stationId: "seed-1",
      truckNo: "皖B·T2208",
      eta: new Date(Date.now() - 3 * 3600000).toISOString(),
      plannedQty: 15000,
      actualQty: null,
      status: "在途",
      arrivedAt: null,
      createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
      note: "夜间补油（示例：已超时可改派）"
    }
  ];
}

const stations = ref<Station[]>(
  loadJson<Station[]>(STATION_KEY, seedStations).map((station) => ({
    safetyStock: 0,
    ...station
  }))
);
const deliveries = ref<Delivery[]>(loadJson<Delivery[]>(DELIVERY_KEY, seedDeliveries));
const variances = ref<VarianceRecord[]>(loadJson<VarianceRecord[]>(VARIANCE_KEY, () => []));
const fleet = ref<Tanker[]>(loadFleet());

const persistStations = () => saveJson(STATION_KEY, stations.value);
const persistDeliveries = () => saveJson(DELIVERY_KEY, deliveries.value);
const persistVariances = () => saveJson(VARIANCE_KEY, variances.value);

// 每分钟刷新一次，超时状态随时间自动更新
const now = ref(new Date());
const timer = setInterval(() => {
  now.value = new Date();
}, 60000);
onUnmounted(() => clearInterval(timer));

const today = computed(() => localDay(now.value));

/* ---------------- 油站表单 ---------------- */

function createBlank() {
  return Object.fromEntries(
    fields.map((field) => [field.key, field.type === "number" ? 0 : ""])
  ) as Record<string, string | number>;
}

const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref(project.filters[0]);

const filteredStations = computed(() => {
  if (filter.value.startsWith("全部")) return stations.value;
  return stations.value.filter((station) => station.area === filter.value);
});

function submitStation() {
  const values = Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.type === "number" ? Number(form[field.key]) || 0 : form[field.key]
    ])
  ) as unknown as Omit<Station, "id" | "status" | "notes" | "createdAt">;
  stations.value = [
    {
      ...values,
      id: crypto.randomUUID(),
      status: statuses[0],
      notes: note.value || "暂无备注",
      createdAt: new Date().toISOString()
    },
    ...stations.value
  ];
  Object.assign(form, createBlank());
  note.value = "";
  persistStations();
}

function nextStatus(status: string) {
  const index = statuses.indexOf(status);
  return statuses[(index + 1) % statuses.length];
}

function flowStatus(station: Station) {
  station.status = nextStatus(station.status);
  persistStations();
}

function removeStation(id: string) {
  stations.value = stations.value.filter((station) => station.id !== id);
  deliveries.value = deliveries.value.filter((delivery) => delivery.stationId !== id);
  variances.value = variances.value.filter((variance) => variance.stationId !== id);
  persistStations();
  persistDeliveries();
  persistVariances();
}

function copySummary(station: Station) {
  void navigator.clipboard?.writeText(
    `${station.station} / ${station.area} / 当前库存${Number(station.stock).toLocaleString()}L / 含在途预估${estStock(station).toLocaleString()}L`
  );
}

/* ---------------- 派车登记 ---------------- */

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

const dispatchForm = reactive({
  stationId: "",
  truckNo: "",
  eta: toLocalInput(new Date(Date.now() + 4 * 3600000)),
  plannedQty: 10000,
  note: ""
});

const dispatchBlocked = computed(
  () => !!dispatchForm.stationId && !canDispatch(deliveries.value, dispatchForm.stationId)
);

function submitDispatch() {
  if (!dispatchForm.stationId || !dispatchForm.truckNo || dispatchBlocked.value) return;
  const delivery: Delivery = {
    id: crypto.randomUUID(),
    stationId: dispatchForm.stationId,
    truckNo: dispatchForm.truckNo,
    eta: new Date(dispatchForm.eta).toISOString(),
    plannedQty: Number(dispatchForm.plannedQty) || 0,
    actualQty: null,
    status: "在途",
    arrivedAt: null,
    createdAt: new Date().toISOString(),
    note: dispatchForm.note || "补油排程"
  };
  deliveries.value = [delivery, ...deliveries.value];
  persistDeliveries();
  dispatchForm.truckNo = "";
  dispatchForm.note = "";
}

/* ---------------- 到站卸货 / 超时改派 ---------------- */

const actualInputs = reactive<Record<string, number | null>>({});
const reassignForms = reactive<Record<string, { truckNo: string; eta: string }>>({});

function reassignFor(delivery: Delivery) {
  return (reassignForms[delivery.id] ??= {
    truckNo: "",
    eta: toLocalInput(new Date(now.value.getTime() + 2 * 3600000))
  });
}

function arrive(delivery: Delivery) {
  const actual = Number(actualInputs[delivery.id] ?? delivery.plannedQty);
  if (Number.isNaN(actual) || actual < 0) return;
  const { done, variance } = completeDelivery(delivery, actual, new Date());
  deliveries.value = deliveries.value.map((item) => (item.id === delivery.id ? done : item));
  const station = stations.value.find((item) => item.id === delivery.stationId);
  if (station) {
    station.stock = Number(station.stock) + actual;
    persistStations();
  }
  if (variance) {
    variances.value = [variance, ...variances.value];
    persistVariances();
  }
  delete actualInputs[delivery.id];
  persistDeliveries();
}

function doReassign(delivery: Delivery) {
  const formState = reassignForms[delivery.id];
  if (!formState?.truckNo || !formState.eta) return;
  const { missed, next } = reassignDelivery(
    delivery,
    formState.truckNo,
    new Date(formState.eta),
    new Date()
  );
  deliveries.value = [
    next,
    ...deliveries.value.map((item) => (item.id === delivery.id ? missed : item))
  ];
  delete reassignForms[delivery.id];
  persistDeliveries();
}

function resolveVariance(id: string) {
  const variance = variances.value.find((item) => item.id === id);
  if (variance) variance.handled = true;
  persistVariances();
}

/* ---------------- 车辆台账 ---------------- */

const truckForm = reactive({ no: "", driver: "", capacity: 30000 });

function addTruck() {
  if (!truckForm.no || fleet.value.some((truck) => truck.no === truckForm.no)) return;
  fleet.value = [
    { no: truckForm.no, driver: truckForm.driver, capacity: Number(truckForm.capacity) || 0 },
    ...fleet.value
  ];
  saveFleet(fleet.value);
  truckForm.no = "";
  truckForm.driver = "";
  truckForm.capacity = 30000;
}

function removeTruck(no: string) {
  if (truckBusy(no, deliveries.value)) return;
  fleet.value = fleet.value.filter((truck) => truck.no !== no);
  saveFleet(fleet.value);
}

/* ---------------- 展示辅助 ---------------- */

const pendingOfStation = (stationId: string) => pendingOf(deliveries.value, stationId);
const inTransitOf = (stationId: string) => inTransitQty(deliveries.value, stationId);
const estStock = (station: Station) =>
  estimatedStock(Number(station.stock), deliveries.value, station.id);
const isWarning = (station: Station) =>
  stationWarning(
    Number(station.stock),
    Number(station.safetyStock),
    deliveries.value,
    variances.value,
    station.id,
    today.value
  );
const stationName = (id: string) => stations.value.find((station) => station.id === id)?.station ?? "已删站";

const metrics = computed(() => [
  stations.value.length,
  stations.value.filter((station) => pendingOfStation(station.id).length > 0).length,
  deliveries.value.filter(isPending).reduce((sum, delivery) => sum + delivery.plannedQty, 0),
  stations.value.filter(isWarning).length
]);

const deliveryLogs = computed(() =>
  [...deliveries.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index].toLocaleString() }}</strong>
        </article>
      </section>

      <section class="workspace">
        <div class="side">
          <form class="panel" @submit.prevent="submitDispatch">
            <h2>派车登记</h2>
            <div class="form-grid">
              <label>
                补油油站
                <select v-model="dispatchForm.stationId" required>
                  <option value="">请选择</option>
                  <option
                    v-for="station in stations"
                    :key="station.id"
                    :value="station.id"
                    :disabled="!canDispatch(deliveries, station.id)"
                  >
                    {{ station.station }}{{ canDispatch(deliveries, station.id) ? "" : "（待卸，不可派）" }}
                  </option>
                </select>
              </label>
              <p v-if="dispatchBlocked" class="hint">
                该站已有未到站车辆，显示待卸，不能重复派车；旧车超时 {{ OVERDUE_HOURS }}
                小时后可在右侧改派。
              </p>
              <label>
                油罐车编号
                <select v-model="dispatchForm.truckNo" required>
                  <option value="">请选择</option>
                  <option
                    v-for="truck in fleet"
                    :key="truck.no"
                    :value="truck.no"
                    :disabled="truckBusy(truck.no, deliveries)"
                  >
                    {{ truck.no }}（{{ truck.driver }}，{{ truck.capacity.toLocaleString() }}L）{{
                      truckBusy(truck.no, deliveries) ? " 在途" : ""
                    }}
                  </option>
                </select>
              </label>
              <div class="form-row">
                <label>
                  预计到站
                  <input v-model="dispatchForm.eta" type="datetime-local" required />
                </label>
                <label>
                  计划卸量L
                  <input v-model.number="dispatchForm.plannedQty" type="number" min="1" required />
                </label>
              </div>
              <label>
                备注
                <textarea v-model="dispatchForm.note" placeholder="夜间到站、油品要求等" />
              </label>
              <button type="submit" :disabled="dispatchBlocked">登记排程</button>
            </div>
          </form>

          <form class="panel" @submit.prevent="submitStation">
            <h2>{{ project.formTitle }}</h2>
            <div class="form-grid">
              <label v-for="field in fields" :key="field.key">
                {{ field.label }}
                <select v-if="field.type === 'select'" v-model="form[field.key]" required>
                  <option value="">请选择</option>
                  <option v-for="option in field.options" :key="option">{{ option }}</option>
                </select>
                <input
                  v-else
                  v-model="form[field.key]"
                  :type="field.type === 'number' ? 'number' : 'text'"
                  :required="field.key !== 'stock' && field.key !== 'safetyStock'"
                />
              </label>
              <label>
                备注
                <textarea v-model="note" placeholder="填写处理说明或现场备注" />
              </label>
              <button type="submit">{{ project.primaryAction }}</button>
            </div>
          </form>
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <h2>{{ project.entityLabel }}列表</h2>
            <select v-model="filter">
              <option v-for="item in project.filters" :key="item">{{ item }}</option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="filteredStations.length === 0" class="empty">暂无匹配数据</div>
            <article v-for="station in filteredStations" :key="station.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ station.station }} / {{ station.area }}</p>
                <div class="record-badges">
                  <span class="status">{{ station.status }}</span>
                  <span v-if="pendingOfStation(station.id).length" class="badge info">
                    待卸 ×{{ pendingOfStation(station.id).length }}
                  </span>
                  <span v-if="isWarning(station)" class="badge warn">预警</span>
                </div>
              </div>
              <div class="details">
                <span>负责人: {{ station.manager }}</span>
                <span>安全库存: {{ Number(station.safetyStock).toLocaleString() }}L</span>
                <span>当前库存: {{ Number(station.stock).toLocaleString() }}L</span>
                <span>在途量: {{ inTransitOf(station.id).toLocaleString() }}L</span>
                <span :class="{ low: estStock(station) < Number(station.safetyStock) }">
                  预估库存(含在途): {{ estStock(station).toLocaleString() }}L
                </span>
              </div>

              <div
                v-for="delivery in pendingOfStation(station.id)"
                :key="delivery.id"
                class="delivery"
                :class="{ overdue: isOverdue(delivery, now) }"
              >
                <div class="delivery-head">
                  <strong>{{ delivery.truckNo }}</strong>
                  <span>计划卸量 {{ delivery.plannedQty.toLocaleString() }}L</span>
                  <span>预计到站 {{ formatTime(delivery.eta) }}</span>
                  <span v-if="isOverdue(delivery, now)" class="badge danger">
                    超时 {{ overdueHours(delivery, now).toFixed(1) }}h，可改派
                  </span>
                  <span v-else class="badge info">在途</span>
                </div>
                <p v-if="delivery.note" class="note">{{ delivery.note }}</p>
                <div class="delivery-actions">
                  <input
                    v-model.number="actualInputs[delivery.id]"
                    type="number"
                    min="0"
                    :placeholder="`实际卸量L（默认 ${delivery.plannedQty}）`"
                  />
                  <button type="button" @click="arrive(delivery)">到站卸货</button>
                </div>
                <div v-if="isOverdue(delivery, now)" class="delivery-actions">
                  <select v-model="reassignFor(delivery).truckNo">
                    <option value="">选择新车</option>
                    <option
                      v-for="truck in fleet"
                      :key="truck.no"
                      :value="truck.no"
                      :disabled="truckBusy(truck.no, deliveries)"
                    >
                      {{ truck.no }}（{{ truck.driver }}）
                    </option>
                  </select>
                  <input v-model="reassignFor(delivery).eta" type="datetime-local" />
                  <button type="button" class="danger" @click="doReassign(delivery)">
                    改派新车（旧车记失约）
                  </button>
                </div>
              </div>

              <p class="note">{{ station.notes }}</p>
              <div class="actions">
                <button type="button" @click="flowStatus(station)">流转状态</button>
                <button class="secondary" type="button" @click="copySummary(station)">
                  复制摘要
                </button>
                <button class="danger" type="button" @click="removeStation(station.id)">
                  删除
                </button>
              </div>
            </article>
          </div>
        </section>
      </section>

      <section class="section">
        <h2>车辆台账</h2>
        <form class="truck-form" @submit.prevent="addTruck">
          <label>油罐车编号<input v-model="truckForm.no" required /></label>
          <label>司机<input v-model="truckForm.driver" required /></label>
          <label>容量L<input v-model.number="truckForm.capacity" type="number" min="0" required /></label>
          <button type="submit">新增车辆</button>
        </form>
        <table class="ledger">
          <thead>
            <tr>
              <th>油罐车编号</th>
              <th>司机</th>
              <th>容量L</th>
              <th>当前状态</th>
              <th>失约次数</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="truck in fleet" :key="truck.no">
              <td>{{ truck.no }}</td>
              <td>{{ truck.driver }}</td>
              <td>{{ truck.capacity.toLocaleString() }}</td>
              <td>
                <span class="badge" :class="truckBusy(truck.no, deliveries) ? 'info' : 'ok'">
                  {{ truckBusy(truck.no, deliveries) ? "在途" : "可用" }}
                </span>
              </td>
              <td :class="{ low: missCount(truck.no, deliveries) > 0 }">
                {{ missCount(truck.no, deliveries) }}
              </td>
              <td>
                <button
                  class="secondary"
                  type="button"
                  :disabled="truckBusy(truck.no, deliveries)"
                  @click="removeTruck(truck.no)"
                >
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="section">
        <h2>卸量差异（当天预警）</h2>
        <div v-if="variances.length === 0" class="empty">暂无差异记录</div>
        <div class="stack-list">
          <div v-for="variance in variances" :key="variance.id" class="variance-row">
            <span>{{ variance.date }}</span>
            <strong>{{ stationName(variance.stationId) }}</strong>
            <span>计划 {{ variance.plannedQty.toLocaleString() }}L</span>
            <span>实卸 {{ variance.actualQty.toLocaleString() }}L</span>
            <span class="low">差 {{ variance.diff.toLocaleString() }}L</span>
            <span class="badge" :class="variance.handled ? 'ok' : 'warn'">
              {{ variance.handled ? "已处理" : "预警中" }}
            </span>
            <button
              v-if="!variance.handled"
              class="secondary"
              type="button"
              @click="resolveVariance(variance.id)"
            >
              标记已处理
            </button>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>调度记录</h2>
        <div class="stack-list">
          <div v-for="delivery in deliveryLogs" :key="delivery.id" class="log-row">
            <span class="badge" :class="{
              info: delivery.status === '在途',
              ok: delivery.status === '已完成',
              danger: delivery.status === '失约'
            }">{{ delivery.status }}</span>
            <strong>{{ stationName(delivery.stationId) }}</strong>
            <span>{{ delivery.truckNo }}</span>
            <span>计划 {{ delivery.plannedQty.toLocaleString() }}L</span>
            <span v-if="delivery.actualQty !== null">
              实卸 {{ delivery.actualQty.toLocaleString() }}L
            </span>
            <span>预计 {{ formatTime(delivery.eta) }}</span>
            <span v-if="delivery.arrivedAt">到场 {{ formatTime(delivery.arrivedAt) }}</span>
            <span v-if="delivery.note">{{ delivery.note }}</span>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
