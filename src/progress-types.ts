/** 对话中的测试进度快照；只展示账本事实，不加入模型消息。 */
import type { Json, Phase, Status } from "./contracts.js";
export interface ProgressStep {
  id: string;
  phase: Phase;
  description: string;
  status: string;
  reason?: string;
  values: { name: string; value: Json }[];
  assertion?: {
    status: Status;
    actual: Json;
    expected: Json;
    operator: string;
  };
  tool?: { name: string; finished: boolean; error: boolean };
}
export interface TestProgress {
  id: string;
  sessionId: string;
  title: string;
  state: "planning" | "running" | "cancelling" | "finished" | "error";
  detail: string;
  updatedAt: string;
  runId?: string;
  planningSession?: string;
  instances: {
    id: string;
    name: string;
    dataId: string;
    status: string;
    sessionId?: string;
    cleanupSession?: string;
    steps: ProgressStep[];
  }[];
  report?: { url: string; path: string };
}
