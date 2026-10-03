/** 测试配置与默认值。 */
import { resolve } from "node:path";
export interface TestConfig {
  workspace: string;
  outputRoot: string;
  stepTimeoutMs: number;
  cleanupTimeoutMs: number;
  cancelGraceMs: number;
  maxRevisions: number;
}
export const defaults: TestConfig = {
  workspace: process.cwd(),
  outputRoot: resolve("artifacts/runs"),
  stepTimeoutMs: 180000,
  cleanupTimeoutMs: 60000,
  cancelGraceMs: 10000,
  maxRevisions: 10,
};
