// 时间格式化工具（本地时区口径，供排程单的输入与展示共用）

export function todayLocalDate(d: Date | number = new Date()): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Date → datetime-local 输入框值 yyyy-MM-ddTHH:mm */
export function toLocalInputValue(d: Date | number): string {
  const date = new Date(d);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** 默认预计到站：当前时间 +2 小时（夜间补油场景可在表单里改） */
export function defaultEta(from: number = Date.now()): string {
  return new Date(from + 2 * 60 * 60 * 1000).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 预计/到场时间展示：MM-dd HH:mm */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相对预计到站的超时描述，如 "已超时 35 分钟" / "还差 1 小时到站" */
export function formatEtaDelta(etaIso: string, now: number = Date.now()): string {
  const delta = now - new Date(etaIso).getTime();
  const abs = Math.abs(delta);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const text =
    abs < 60 * 60 * 1000
      ? `${Math.max(1, minutes)} 分钟`
      : hours >= 24
        ? `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
        : `${hours} 小时 ${minutes % 60} 分`;
  return delta >= 0 ? `已超时 ${text}` : `预计 ${text}后到站`;
}

/** 升数加千分位 */
export function formatLiters(value: number): string {
  return `${Math.round(value).toLocaleString("zh-CN")} L`;
}
