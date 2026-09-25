<script setup lang="ts">
// 地图页：Leaflet 网点地图。站点按 待卸 / 紧张 / 正常 显示不同颜色标记，
// 点击站点弹出在途车辆与预估库存摘要，并选中进入右侧排程台。
import { computed, onMounted, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StationView } from "../scheduling/view";
import { formatDateTime, formatLiters } from "../scheduling/time";
import { TRIP_STATUS_LABEL } from "../scheduling/rules";

const props = defineProps<{
  stations: StationView[];
  selectedId: string | null;
  truckLabel: (truckId: string) => string;
}>();

const emit = defineEmits<{
  select: [id: string];
}>();

const mapEl = ref<HTMLElement | null>(null);
const picking = ref(false);
let map: L.Map | null = null;
let fittedOnce = false;
const markerLayer = L.layerGroup();

const STATUS_COLOR: Record<string, string> = {
  待卸: "#d98a1f",
  紧张: "#c84b31",
  正常: "#176b87"
};

function markerIcon(view: StationView): L.DivIcon {
  const color = STATUS_COLOR[view.status] ?? STATUS_COLOR.正常;
  const selected = view.station.id === props.selectedId;
  return L.divIcon({
    className: "station-marker-wrap",
    html: `
      <div class="station-marker${selected ? " is-selected" : ""}" style="--marker:${color}">
        <span class="marker-dot"></span>
        <span class="marker-label">${view.status}</span>
      </div>`,
    iconSize: [76, 30],
    iconAnchor: [38, 30],
    popupAnchor: [0, -30]
  });
}

function popupHtml(view: StationView): string {
  const { station } = view;
  const trips = view.activeTrips
    .map(
      (trip) =>
        `<li><b>${props.truckLabel(trip.truckId)}</b> · ${TRIP_STATUS_LABEL[trip.status]}
         · 计划 ${formatLiters(trip.plannedAmount)} · 预计 ${formatDateTime(trip.eta)}</li>`
    )
    .join("");
  return `
    <div class="map-popup">
      <p class="popup-title">${station.name}</p>
      <p class="popup-sub">${station.area} · ${station.manager}</p>
      <p>当前库存 <b>${formatLiters(station.stock)}</b> ｜ 安全库存 ${formatLiters(station.safetyStock)}</p>
      <p>在途量 ${formatLiters(view.inbound)} → 预估库存 <b>${formatLiters(view.projected)}</b></p>
      ${trips ? `<ul class="popup-trips">${trips}</ul>` : `<p class="popup-muted">暂无在途车辆</p>`}
    </div>`;
}

function renderMarkers() {
  if (!map) return;
  // 重绘后保留当前地图视野（首次加载时自动缩放到全部网点）
  const center = fittedOnce ? map.getCenter() : null;
  const zoom = fittedOnce ? map.getZoom() : null;

  markerLayer.clearLayers();
  const points: L.LatLngExpression[] = [];

  props.stations.forEach((view) => {
    const { station } = view;
    const marker = L.marker([station.lat, station.lng], { icon: markerIcon(view) });
    marker.bindPopup(popupHtml(view));
    marker.on("click", () => emit("select", station.id));
    marker.addTo(markerLayer);
    points.push([station.lat, station.lng]);
  });

  markerLayer.addTo(map);

  if (!fittedOnce) {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points).pad(0.25);
      map.fitBounds(bounds, { maxZoom: 13 });
    }
    fittedOnce = true;
  } else if (center && zoom !== null) {
    map.setView(center, zoom);
  }
}

onMounted(() => {
  if (!mapEl.value) return;
  map = L.map(mapEl.value, { zoomControl: true }).setView([39.91, 116.45], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
  markerLayer.addTo(map);

  // 点击空白处取坐标，供新增油站定位
  map.on("click", (e: L.LeafletMouseEvent) => {
    if (!picking.value) return;
    window.dispatchEvent(
      new CustomEvent("station:pick-location", {
        detail: { lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) }
      })
    );
    picking.value = false;
    mapEl.value?.classList.remove("picking");
  });

  renderMarkers();
});

// 站点位置/状态/在途量变化才重绘；时间分钟跳动不触发重绘（避免关掉弹窗）
const signature = computed(() =>
  props.stations
    .map(
      (view) =>
        `${view.station.id}:${view.status}:${view.inbound}:` +
        `${view.station.lat},${view.station.lng}:${view.activeTrips
          .map((t) => `${t.truckId}/${t.status}/${t.plannedAmount}/${t.eta}`)
          .join("|")}`
    )
    .join(";;")
);

watch(signature, () => renderMarkers());

watch(
  () => props.selectedId,
  (id) => {
    if (!map || !id) return;
    const view = props.stations.find((item) => item.station.id === id);
    if (view) map.panTo([view.station.lat, view.station.lng]);
  }
);

defineExpose({
  startPicking() {
    picking.value = true;
    mapEl.value?.classList.add("picking");
  }
});
</script>

<template>
  <div ref="mapEl" class="map-board">
    <p v-if="picking" class="map-pick-hint">在地图上点击油站所在位置…</p>
  </div>
</template>
