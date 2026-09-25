# 油站补油排程台

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Element Plus、Leaflet、Pinia
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

把原本只能看库存的地图页补成了夜间补油排程台：调度员可登记安全库存、油罐车编号、预计到站时间和计划卸量，
有未到站车辆的站点在地图与列表上显示「待卸」，系统不再重复派车，库存按在途计划量预估；
超过预计到站两小时仍未到场可改派新车、旧车保留失约记录；实际卸量不足计划自动记当天差异并继续预警。

## 分层维护

按需求拆成三层，互不耦合：

- 排程规则（纯函数）：`src/scheduling/rules.ts`
  重复派车拦截、2 小时失约判定、改派条件、在途量预估、安全库存、差异计算。
- 车辆/排程台账（数据源）：`src/scheduling/ledger.ts`、`src/scheduling/types.ts`
  Pinia store，油站、油罐车、排程单、差异记录的增删改；整体持久化到浏览器 localStorage（记录留本地）。
- 页面交互：`src/App.vue` 与 `src/components/`
  - `MapBoard.vue`：Leaflet 地图，待卸/紧张/正常三色标记，弹窗查看在途车辆与预估库存，支持点选坐标新增油站
  - `StationList.vue`：网点列表、搜索筛选、新增油站（含安全库存、罐容、油品）
  - `DispatchConsole.vue`：派车登记、到场登记、实际卸量登记、超时改派、差异提示
  - `FleetLedger.vue`：油罐车台账（车牌、司机、容量、报修/停用、失约统计）
  - `TripLog.vue`：排程流水与卸量差异留痕（只读，可按状态/当天过滤）

`src/scheduling/time.ts` 为时间与单位格式化工具，`src/scheduling/view.ts` 负责把规则与台账组装成页面视图模型。

## 数据

全部记录保存在浏览器 localStorage，键名 `hxwlfront-21-scheduling-ledger-v1`；
页面右上角「恢复演示数据」可重置为内置的夜间补油演示场景（在途、待卸、失约改派、历史差异各一）。
