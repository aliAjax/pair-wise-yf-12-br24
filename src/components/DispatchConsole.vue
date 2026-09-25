<script setup lang="ts">
// 补油排程台（右侧）：安全库存维护、派车登记、到场/卸油、超2小时改派、当日差异预警。
// 规则裁决来自 rules.ts，台账写入来自 ledger store，本组件只负责交互。
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useLedgerStore } from "../scheduling/ledger";
import { canReassign } from "../scheduling/rules";
import type { StationView, TruckView } from "../scheduling/view";
import { formatDateTime, formatEtaDelta, formatLiters, toLocalInputValue } from "../scheduling/time";
import type { Trip } from "../scheduling/types";

const props = defineProps<{
  view: StationView;
  trucks: TruckView[];
  now: number;
}>();

const store = useLedgerStore();

const station = computed(() => props.view.station);
const isLocked = computed(() => props.view.activeTrips.length > 0);

// ---- 安全库存维护 ---------------------------------------------------------
const editingSafety = ref(false);
const safetyDraft = ref(station.value.safetyStock);
watch(
  station,
  (s) => {
    safetyDraft.value = s.safetyStock;
    editingSafety.value = false;
  }
);

function saveSafety() {
  if (!(safetyDraft.value > 0) || safetyDraft.value > station.value.capacity) {
    ElMessage.warning(`安全库存需在 0 ~ 罐容 ${station.value.capacity} L 之间`);
    return;
  }
  store.updateStation(station.value.id, { safetyStock: Number(safetyDraft.value) });
  editingSafety.value = false;
  ElMessage.success("安全库存已更新");
}

// ---- 派车登记 -------------------------------------------------------------
const dispatchForm = reactive({
  truckId: "",
  plannedAmount: 10000,
  eta: toLocalInputValue(Date.now() + 2 * 3600_000),
  note: ""
});

const dispatchableTrucks = computed(() =>
  props.trucks.filter(
    (item) => item.truck.active && item.truck.status !== "维修中" && !item.busy
  )
);

const selectedTruck = computed(() =>
  dispatchableTrucks.value.find((item) => item.truck.id === dispatchForm.truckId)
);

function submitDispatch() {
  if (!dispatchForm.truckId) {
    ElMessage.warning("请选择油罐车");
    return;
  }
  const result = store.dispatch({
    stationId: station.value.id,
    truckId: dispatchForm.truckId,
    plannedAmount: Number(dispatchForm.plannedAmount),
    eta: dispatchForm.eta,
    note: dispatchForm.note
  });
  if (!result.ok) {
    ElMessage.error(result.reason ?? "派车失败");
    return;
  }
  ElMessage.success("已派车，该站进入待卸状态");
  dispatchForm.note = "";
}

// ---- 到场登记 -------------------------------------------------------------
function markArrived(trip: Trip) {
  if (store.markArrived(trip.id)) ElMessage.success("已登记到场，等待卸油");
}

// ---- 卸油登记（实际卸量不足计划 → 记当天差异并继续预警） ---------------------
const unloadingId = ref<string | null>(null);
const unloadAmount = ref(0);
const lastUnload = ref<{ variance: number; hasDiff: boolean; stillWarned: boolean } | null>(null);

function startUnload(trip: Trip) {
  unloadingId.value = trip.id;
  unloadAmount.value = trip.plannedAmount;
}

function confirmUnload(trip: Trip) {
  const result = store.registerUnload(trip.id, Number(unloadAmount.value));
  if (!result.ok) {
    ElMessage.error(result.reason);
    return;
  }
  lastUnload.value = result;
  unloadingId.value = null;
  if (result.hasDiff) {
    ElMessage.warning(`实际少卸 ${formatLiters(result.variance)}，已记当天差异`);
  } else {
    ElMessage.success("卸油完成，库存已更新");
  }
}

// ---- 超时 2 小时改派新车，旧车保留失约记录 ---------------------------------
const reassigningId = ref<string | null>(null);
const reassignForm = reactive({
  truckId: "",
  plannedAmount: 0,
  eta: toLocalInputValue(Date.now() + 2 * 3600_000),
  note: ""
});

function startReassign(trip: Trip) {
  reassigningId.value = trip.id;
  reassignForm.truckId = "";
  reassignForm.plannedAmount = trip.plannedAmount;
  reassignForm.eta = toLocalInputValue(Date.now() + 2 * 3600_000);
  reassignForm.note = "";
}

function confirmReassign() {
  if (!reassigningId.value) return;
  if (!reassignForm.truckId) {
    ElMessage.warning("请选择改派的新油罐车");
    return;
  }
  const result = store.reassign(reassigningId.value, {
    truckId: reassignForm.truckId,
    plannedAmount: Number(reassignForm.plannedAmount),
    eta: reassignForm.eta,
    note: reassignForm.note
  });
  if (!result.ok) {
    ElMessage.error(result.reason ?? "改派失败");
    return;
  }
  ElMessage.success("已改派新车，旧车失约记录已保留");
  reassigningId.value = null;
}

// ---- 当日差异 -------------------------------------------------------------
const todayDiffs = computed(() =>
  store.diffs
    .filter((d) => d.stationId === station.value.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

const gaugePercent = computed(() =>
  Math.min(100, Math.round((props.view.projected / Math.max(1, station.value.capacity)) * 100))
);
const safetyPercent = computed(() =>
  Math.round((station.value.safetyStock / Math.max(1, station.value.capacity)) * 100)
);

function truckName(id: string) {
  const truck = store.truckById(id);
  return truck ? `${truck.plate}（${truck.driver}）` : id;
}
</script>

<template>
  <section class="panel console">
    <header class="console-head">
      <div>
        <p class="eyebrow">补油排程台</p>
        <h2>{{ station.name }}</h2>
        <p class="subtitle">
          {{ station.area }} · {{ station.manager }} · {{ station.fuelKinds.join(" / ") }}
        </p>
      </div>
      <span class="state-chip big" :class="`st-${view.status}`">{{ view.status }}</span>
    </header>

    <!-- 库存与安全库存 -->
    <div class="stock-card">
      <div class="stock-row">
        <div>
          <span class="metric-label">当前库存</span>
          <strong>{{ formatLiters(station.stock) }}</strong>
        </div>
        <div>
          <span class="metric-label">
            安全库存
            <button type="button" class="link-btn" @click="editingSafety = !editingSafety">
              {{ editingSafety ? "取消" : "修改" }}
            </button>
          </span>
          <strong>{{ formatLiters(station.safetyStock) }}</strong>
        </div>
        <div>
          <span class="metric-label">在途量 → 预估库存</span>
          <strong :class="{ warn: view.belowSafety }">
            +{{ formatLiters(view.inbound) }} ≈ {{ formatLiters(view.projected) }}
          </strong>
        </div>
      </div>

      <form v-if="editingSafety" class="inline-edit" @submit.prevent="saveSafety">
        <input v-model.number="safetyDraft" type="number" min="1" :max="station.capacity" />
        <button type="submit">保存</button>
      </form>

      <div class="gauge">
        <div class="gauge-fill" :class="{ low: view.belowSafety }" :style="{ width: `${gaugePercent}%` }" />
        <div class="gauge-safety" :style="{ left: `${safetyPercent}%` }" title="安全库存线" />
      </div>

      <div v-if="lastUnload?.hasDiff" class="alert warn-alert">
        本次实际少卸 {{ formatLiters(lastUnload.variance) }}，已记当天差异；
        <template v-if="lastUnload.stillWarned">
          预估库存仍低于安全线，<b>继续预警，可再次排车</b>。
        </template>
        <template v-else>到货后库存已回到安全线以上。</template>
      </div>
    </div>

    <!-- 在途/待卸任务 -->
    <div v-if="view.activeTrips.length > 0" class="trip-block">
      <h3>未到站 / 待卸车辆（{{ view.activeTrips.length }}）</h3>
      <article
        v-for="trip in view.activeTrips"
        :key="trip.id"
        class="trip-card"
        :class="{ overdue: canReassign(trip, now) }"
      >
        <div class="trip-main">
          <p class="trip-title">
            🚚 {{ truckName(trip.truckId) }}
            <em class="state-chip" :class="trip.status === 'arrived' ? 'st-待卸' : ''">
              {{ trip.status === "arrived" ? "已到站·待卸" : "在途" }}
            </em>
          </p>
          <p class="trip-meta">
            计划卸量 <b>{{ formatLiters(trip.plannedAmount) }}</b>
            ｜ 预计到站 {{ formatDateTime(trip.eta) }}
            <span :class="canReassign(trip, now) ? 'overdue-text' : ''">
              （{{ formatEtaDelta(trip.eta, now) }}）
            </span>
          </p>
          <p v-if="trip.note" class="trip-note">备注：{{ trip.note }}</p>

          <!-- 卸油登记 -->
          <form v-if="unloadingId === trip.id" class="unload-form" @submit.prevent="confirmUnload(trip)">
            <label>
              实际卸量 L
              <input v-model.number="unloadAmount" type="number" min="0" :max="station.capacity" required />
            </label>
            <button type="submit">确认卸油入库</button>
            <button type="button" class="secondary" @click="unloadingId = null">取消</button>
          </form>

          <!-- 改派表单 -->
          <form v-else-if="reassigningId === trip.id" class="unload-form" @submit.prevent="confirmReassign">
            <label>
              新车牌
              <select v-model="reassignForm.truckId" required>
                <option value="">选择新车</option>
                <option
                  v-for="item in dispatchableTrucks.filter((t) => t.truck.id !== trip.truckId)"
                  :key="item.truck.id"
                  :value="item.truck.id"
                >
                  {{ item.truck.plate }} · {{ item.truck.driver }} · 容量 {{ item.truck.capacity }}L
                </option>
              </select>
            </label>
            <label>
              新预计到站
              <input v-model="reassignForm.eta" type="datetime-local" required />
            </label>
            <label>
              计划卸量 L
              <input v-model.number="reassignForm.plannedAmount" type="number" min="1" required />
            </label>
            <label class="grow">
              改派说明
              <input v-model="reassignForm.note" placeholder="如：原车失约，改派" />
            </label>
            <button type="submit">确认改派</button>
            <button type="button" class="secondary" @click="reassigningId = null">取消</button>
          </form>

          <div v-else class="trip-actions">
            <button
              v-if="trip.status === 'dispatched'"
              type="button"
              class="secondary"
              @click="markArrived(trip)"
            >
              登记到场
            </button>
            <button
              v-if="trip.status === 'arrived' || trip.status === 'dispatched'"
              type="button"
              @click="startUnload(trip)"
            >
              登记实际卸量
            </button>
            <template v-if="trip.status === 'dispatched'">
              <button
                type="button"
                class="danger ghost-danger"
                :disabled="!canReassign(trip, now) || reassigningId !== null"
                @click="startReassign(trip)"
              >
                改派新车
              </button>
              <span v-if="!canReassign(trip, now)" class="hint">
                超预计到站 2 小时仍未到场才可改派（旧车计失约）
              </span>
            </template>
          </div>
        </div>
      </article>
    </div>

    <!-- 派车登记 -->
    <form v-else class="dispatch-form" @submit.prevent="submitDispatch">
      <h3>派车登记</h3>
      <div class="form-grid-2">
        <label>
          油罐车编号
          <select v-model="dispatchForm.truckId" required>
            <option value="">选择车辆</option>
            <option v-for="item in dispatchableTrucks" :key="item.truck.id" :value="item.truck.id">
              {{ item.truck.plate }} · {{ item.truck.driver }} · 容量 {{ item.truck.capacity }}L
            </option>
          </select>
        </label>
        <label>
          预计到站时间
          <input v-model="dispatchForm.eta" type="datetime-local" required />
        </label>
        <label>
          计划卸量 L
          <input
            v-model.number="dispatchForm.plannedAmount"
            type="number"
            min="1"
            :max="selectedTruck?.truck.capacity"
            required
          />
        </label>
        <label class="grow">
          调度备注
          <input v-model="dispatchForm.note" placeholder="如：夜间补柴油" />
        </label>
      </div>
      <button type="submit" class="dispatch-btn">登记排程并派车</button>
      <p v-if="dispatchableTrucks.length === 0" class="hint">暂无可用空闲油罐车，请先在车辆台账中维护</p>
    </form>

    <div v-if="isLocked" class="locked-tip">
      🔒 该站已有未到站车辆，显示「待卸」，系统不再重复派车
    </div>

    <!-- 当日/历史差异 -->
    <div v-if="todayDiffs.length > 0" class="diff-block">
      <h3>卸量差异记录</h3>
      <div v-for="d in todayDiffs" :key="d.id" class="diff-row">
        <span>{{ d.date }}</span>
        <span>{{ truckName(d.truckId) }}</span>
        <span>计划 {{ formatLiters(d.plannedAmount) }}</span>
        <span>实卸 {{ formatLiters(d.actualAmount) }}</span>
        <b class="warn">少卸 {{ formatLiters(d.variance) }}</b>
      </div>
    </div>
  </section>
</template>
