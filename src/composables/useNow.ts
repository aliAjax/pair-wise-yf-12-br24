import { onScopeDispose, ref } from "vue";

/** 每分钟走一格的“当前时间”，驱动超时/失约状态自动刷新 */
export function useNow(periodMs = 60_000) {
  const now = ref(Date.now());
  const timer = setInterval(() => {
    now.value = Date.now();
  }, periodMs);
  onScopeDispose(() => clearInterval(timer));
  return now;
}
