<script setup lang="ts">
// 车辆台账（独立维护）：车牌编号、司机、容量、状态、停用与失约统计。
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useLedgerStore } from "../scheduling/ledger";
import type { TruckView } from "../scheduling/view";

defineProps<{
  trucks: TruckView[];
}>();

const store = useLedgerStore();
const showAdd = ref(false);

const form = reactive({
  plate: "",
  driver: "",
  phone: "",
  capacity: 20000
});

function submit() {
  if (!form.plate.trim()) {
    ElMessage.warning("请填写车牌编号");
    return;
  }
  if (!(form.capacity > 0)) {
    ElMessage.warning("容量需大于 0");
    return;
  }
  store.addTruck({
    plate: form.plate.trim(),
    driver: form.driver.trim() || "未指定",
    phone: form.phone.trim(),
    capacity: Number(form.capacity)
  });
  ElMessage.success("油罐车已入台账");
  form.plate = form.driver = form.phone = "";
  form.capacity = 20000;
  showAdd.value = false;
}

function remove(id: string, plate: string) {
  if (!window.confirm(`确定删除油罐车 ${plate}？有任务记录的车辆只能停用。`)) return;
  if (store.removeTruck(id)) ElMessage.success("已删除");
  else ElMessage.warning("该车有排程/失约记录，已改为停用保留");
}
</script>

<template>
  <section class="panel ledger">
    <div class="toolbar">
      <h2>油罐车台账</h2>
      <button type="button" class="secondary" @click="showAdd = !showAdd">
        {{ showAdd ? "收起" : "新增车辆" }}
      </button>
    </div>

    <form v-if="showAdd" class="sub-form" @submit.prevent="submit">
      <div class="form-row">
        <label>
          车牌编号
          <input v-model="form.plate" placeholder="如：冀A·8899" required />
        </label>
        <label>
          司机
          <input v-model="form.driver" placeholder="司机姓名" />
        </label>
      </div>
      <div class="form-row">
        <label>
          联系电话
          <input v-model="form.phone" placeholder="选填" />
        </label>
        <label>
          额定容量 L
          <input v-model.number="form.capacity" type="number" min="1" required />
        </label>
      </div>
      <button type="submit">保存车辆</button>
    </form>

    <div class="table-wrap">
      <table class="ledger-table">
        <thead>
          <tr>
            <th>车牌编号</th>
            <th>司机</th>
            <th>容量</th>
            <th>实时状态</th>
            <th>失约</th>
            <th>任务</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in trucks" :key="item.truck.id" :class="{ inactive: !item.truck.active }">
            <td>
              <b>{{ item.truck.plate }}</b>
              <br /><small v-if="item.truck.phone">{{ item.truck.phone }}</small>
            </td>
            <td>{{ item.truck.driver }}</td>
            <td>{{ item.truck.capacity.toLocaleString("zh-CN") }} L</td>
            <td>
              <em class="state-chip" :class="`truck-${item.effectiveStatus}`">{{ item.effectiveStatus }}</em>
            </td>
            <td>
              <b :class="{ warn: item.noShowCount > 0 }">{{ item.noShowCount }}</b>
            </td>
            <td>{{ item.tripCount }}</td>
            <td class="op-cell">
              <button
                v-if="!item.busy"
                type="button"
                class="mini secondary"
                @click="store.updateTruck(item.truck.id, { status: item.truck.status === '维修中' ? '空闲' : '维修中' })"
              >
                {{ item.truck.status === "维修中" ? "修好" : "报修" }}
              </button>
              <button
                type="button"
                class="mini secondary"
                @click="store.updateTruck(item.truck.id, { active: !item.truck.active })"
              >
                {{ item.truck.active ? "停用" : "启用" }}
              </button>
              <button type="button" class="mini danger" @click="remove(item.truck.id, item.truck.plate)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
