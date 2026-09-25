<script setup lang="ts">
// 排程流水（记录留痕）：全部派车/到场/卸油/失约改派记录 + 卸量差异记录，只读。
import { computed, ref } from "vue";
import { useLedgerStore } from "../scheduling/ledger";
import { TRIP_STATUS_LABEL } from "../scheduling/rules";
import type { TripStatus } from "../scheduling/types";
import { formatDateTime, formatLiters, todayLocalDate } from "../scheduling/time";

const emit = defineEmits<{
  selectStation: [id: string];
}>();

const store = useLedgerStore();
const statusFilter = ref<"全部" | TripStatus>("全部");
const onlyToday = ref(false);

const FILTERS: ("全部" | TripStatus)[] = [
  "全部",
  "dispatched",
  "arrived",
  "delivered",
  "no_show"
];

const today = todayLocalDate();

const rows = computed(() =>
  store.trips
    .filter((trip) => statusFilter.value === "全部" || trip.status === statusFilter.value)
    .filter((trip) => {
      if (!onlyToday.value) return true;
      return todayLocalDate(trip.dispatchedAt) === today;
    })
    .sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt))
);

const diffRows = computed(() =>
  [...store.diffs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
);

function stationName(id: string) {
  return store.stationById(id)?.name ?? "(已删油站)";
}
function truckPlate(id: string) {
  return store.truckById(id)?.plate ?? id;
}
function reassignedLabel(by: string | null) {
  if (!by) return "—";
  const t = store.tripById(by);
  return t ? `新车 ${truckPlate(t.truckId)}` : "已改派";
}
</script>

<template>
  <section class="panel triplog">
    <div class="toolbar">
      <h2>排程流水 · 差异留痕</h2>
      <div class="filter-pills">
        <button
          v-for="f in FILTERS"
          :key="f"
          type="button"
          class="chip"
          :class="{ active: statusFilter === f }"
          @click="statusFilter = f"
        >
          {{ f === "全部" ? "全部" : TRIP_STATUS_LABEL[f] }}
        </button>
        <label class="check-chip">
          <input v-model="onlyToday" type="checkbox" /> 仅看今天
        </label>
      </div>
    </div>

    <div class="table-wrap">
      <table class="ledger-table">
        <thead>
          <tr>
            <th>油站</th>
            <th>油罐车</th>
            <th>计划/实卸</th>
            <th>预计到站</th>
            <th>派车时间</th>
            <th>状态</th>
            <th>改派去向</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="trip in rows"
            :key="trip.id"
            :class="{ rowNoShow: trip.status === 'no_show', rowDelivered: trip.status === 'delivered' }"
          >
            <td>
              <button type="button" class="link-btn" @click="emit('selectStation', trip.stationId)">
                {{ stationName(trip.stationId) }}
              </button>
            </td>
            <td>{{ truckPlate(trip.truckId) }}</td>
            <td>
              {{ formatLiters(trip.plannedAmount) }}
              <template v-if="trip.actualAmount !== null">
                / <b :class="{ warn: trip.actualAmount < trip.plannedAmount }">{{ formatLiters(trip.actualAmount) }}</b>
              </template>
            </td>
            <td>{{ formatDateTime(trip.eta) }}</td>
            <td>{{ formatDateTime(trip.dispatchedAt) }}</td>
            <td><em class="state-chip" :class="`trip-${trip.status}`">{{ TRIP_STATUS_LABEL[trip.status] }}</em></td>
            <td>{{ reassignedLabel(trip.reassignedBy) }}</td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="7" class="empty">暂无排程记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <h3 class="sub-title">卸量差异（实际不足计划）</h3>
    <div class="table-wrap">
      <table class="ledger-table">
        <thead>
          <tr>
            <th>日期</th>
            <th>油站</th>
            <th>油罐车</th>
            <th>计划卸量</th>
            <th>实际卸量</th>
            <th>差异</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in diffRows" :key="d.id" class="row-diff">
            <td>{{ d.date }}</td>
            <td>
              <button type="button" class="link-btn" @click="emit('selectStation', d.stationId)">
                {{ stationName(d.stationId) }}
              </button>
            </td>
            <td>{{ truckPlate(d.truckId) }}</td>
            <td>{{ formatLiters(d.plannedAmount) }}</td>
            <td>{{ formatLiters(d.actualAmount) }}</td>
            <td><b class="warn">少 {{ formatLiters(d.variance) }}</b></td>
          </tr>
          <tr v-if="diffRows.length === 0">
            <td colspan="6" class="empty">暂无差异记录</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
