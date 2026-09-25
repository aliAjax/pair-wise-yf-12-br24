<script setup lang="ts">
// 左侧：油站网点列表 + 新增油站（含安全库存登记）
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { StationView } from "../scheduling/view";
import { formatLiters } from "../scheduling/time";
import type { FuelKind, Station } from "../scheduling/types";

const props = defineProps<{
  stations: StationView[];
  areas: string[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  add: [station: Omit<Station, "id" | "createdAt">];
  pickRequest: [];
}>();

const keyword = ref("");
const areaFilter = ref("全部区域");
const showAdd = ref(false);

const FUEL_OPTIONS: FuelKind[] = ["92#汽油", "95#汽油", "0#柴油"];

function blankForm() {
  return {
    name: "",
    area: props.areas[0] ?? "东区",
    manager: "",
    stock: 0,
    safetyStock: 10000,
    capacity: 40000,
    fuelKinds: ["92#汽油"] as FuelKind[],
    lat: 39.91,
    lng: 116.45,
    note: ""
  };
}

const form = reactive(blankForm());

function handlePicked(event: Event) {
  const detail = (event as CustomEvent<{ lat: number; lng: number }>).detail;
  form.lat = detail.lat;
  form.lng = detail.lng;
  ElMessage.success(`已定位：${detail.lat}, ${detail.lng}`);
}

onMounted(() => window.addEventListener("station:pick-location", handlePicked));
onBeforeUnmount(() => window.removeEventListener("station:pick-location", handlePicked));

function toggleFuel(kind: FuelKind) {
  const index = form.fuelKinds.indexOf(kind);
  if (index >= 0) form.fuelKinds.splice(index, 1);
  else form.fuelKinds.push(kind);
}

function submit() {
  if (!form.name.trim()) {
    ElMessage.warning("请填写油站名称");
    return;
  }
  if (form.safetyStock <= 0 || form.capacity <= 0) {
    ElMessage.warning("安全库存与罐容需大于 0");
    return;
  }
  if (form.safetyStock > form.capacity) {
    ElMessage.warning("安全库存不能超过罐容");
    return;
  }
  if (form.fuelKinds.length === 0) {
    ElMessage.warning("请至少选择一种油品");
    return;
  }
  emit(
    "add",
    {
      name: form.name.trim(),
      area: form.area,
      manager: form.manager.trim() || "未指定",
      stock: Number(form.stock),
      safetyStock: Number(form.safetyStock),
      capacity: Number(form.capacity),
      fuelKinds: [...form.fuelKinds],
      lat: Number(form.lat),
      lng: Number(form.lng),
      note: form.note.trim()
    }
  );
  Object.assign(form, blankForm());
  showAdd.value = false;
}

const filtered = computed(() =>
  props.stations.filter((view) => {
    const matchArea = areaFilter.value === "全部区域" || view.station.area === areaFilter.value;
    const kw = keyword.value.trim();
    const matchKeyword =
      !kw || view.station.name.includes(kw) || view.station.manager.includes(kw);
    return matchArea && matchKeyword;
  })
);
</script>

<template>
  <aside class="panel station-panel">
    <div class="toolbar">
      <h2>油站网点</h2>
      <button type="button" class="secondary" @click="showAdd = !showAdd">
        {{ showAdd ? "收起" : "新增油站" }}
      </button>
    </div>

    <form v-if="showAdd" class="sub-form" @submit.prevent="submit">
      <label>
        油站名称
        <input v-model="form.name" placeholder="如：东区二站" required />
      </label>
      <div class="form-row">
        <label>
          区域
          <select v-model="form.area">
            <option v-for="area in areas" :key="area" :value="area">{{ area }}</option>
          </select>
        </label>
        <label>
          负责人
          <input v-model="form.manager" placeholder="站长姓名" />
        </label>
      </div>
      <div class="form-row">
        <label>
          当前库存 L
          <input v-model.number="form.stock" type="number" min="0" />
        </label>
        <label>
          安全库存 L
          <input v-model.number="form.safetyStock" type="number" min="1" />
        </label>
      </div>
      <label>
        罐容 L
        <input v-model.number="form.capacity" type="number" min="1" />
      </label>
      <div class="fuel-picker">
        <span>油品</span>
        <button
          v-for="kind in FUEL_OPTIONS"
          :key="kind"
          type="button"
          class="chip"
          :class="{ active: form.fuelKinds.includes(kind) }"
          @click="toggleFuel(kind)"
        >
          {{ kind }}
        </button>
      </div>
      <div class="form-row">
        <label>
          纬度
          <input v-model.number="form.lat" type="number" step="0.0001" required />
        </label>
        <label>
          经度
          <input v-model.number="form.lng" type="number" step="0.0001" required />
        </label>
      </div>
      <button type="button" class="secondary pick-btn" @click="emit('pickRequest')">
        📍 在地图上点选位置
      </button>
      <label>
        备注
        <textarea v-model="form.note" placeholder="选填" />
      </label>
      <button type="submit">保存油站</button>
    </form>

    <div class="filter-row">
      <input v-model="keyword" placeholder="搜索站名 / 负责人" />
      <select v-model="areaFilter">
        <option>全部区域</option>
        <option v-for="area in areas" :key="area" :value="area">{{ area }}</option>
      </select>
    </div>

    <div class="station-list">
      <button
        v-for="view in filtered"
        :key="view.station.id"
        type="button"
        class="station-card"
        :class="[`st-${view.status}`, { selected: view.station.id === selectedId }]"
        @click="emit('select', view.station.id)"
      >
        <span class="card-head">
          <b>{{ view.station.name }}</b>
          <em class="state-chip">{{ view.status }}</em>
        </span>
        <span class="card-line">{{ view.station.area }} · {{ view.station.manager }}</span>
        <span class="card-line">
          库存 {{ formatLiters(view.station.stock) }}
          <template v-if="view.inbound > 0">
            ＋在途 {{ formatLiters(view.inbound) }}
            <b>≈ {{ formatLiters(view.projected) }}</b>
          </template>
        </span>
        <span v-if="view.belowSafety && view.inbound === 0" class="warn-line">
          低于安全库存 {{ formatLiters(view.station.safetyStock) }}，请尽快派车
        </span>
        <span v-else-if="view.belowSafety" class="warn-line soft">
          到货后预估 {{ formatLiters(view.projected) }}，仍低于安全线
        </span>
      </button>
      <p v-if="filtered.length === 0" class="empty">暂无匹配油站</p>
    </div>
  </aside>
</template>
