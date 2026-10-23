/** 浏览器连接来源在每次运行前冻结，凭据只从服务端私有文件读取。 */
export interface BrowserPreferences {
  backend: "playwright" | "runbridge";
  accessFile: string;
  connectionSource?: "access-file" | "hub";
  hubFile?: string;
  nodeId?: string;
  nodeLeaseSeconds?: number;
  resourceId: string;
  leaseSeconds: number;
  previewEnabled: boolean;
}
export const browserPreferenceDefaults: BrowserPreferences = {
  backend: "playwright",
  accessFile: "",
  connectionSource: "access-file",
  hubFile: "",
  nodeId: "",
  resourceId: "chromium",
  leaseSeconds: 1800,
  previewEnabled: true,
};
/** 仅解释文件格式，不携带可用许可。 */
export const runbridgeAccessTemplate = `# RunBridge 私有访问配置；也支持原有 JSON 文件。
# Hub 基址，不含末尾 /mcp；反向代理前缀可以保留。
hub_url: "http://hub.example:8787"
# 以下三项由 Hub 本次领取配套签发，不使用 enrollment.token 登记令牌。
node_id: "node_example"
grant_id: "grant_example"
# 令牌使用引号包裹，保留原始内容；请勿提交到 Git 或发送到对话。
access_token: "<Hub本次签发的节点令牌>"
# Hub 签发的到期时间；实际期限与空闲回收以 Hub 查询为准。
expires_at: "2030-01-01T00:00:00Z"
`;
export const runbridgeHubTemplate = `# Hub 共享申请凭据；支持 YAML 注释，也支持 JSON。
# 只用于只读资源池和申请 Node，不能直接执行设备动作。
hub_url: "http://hub.example:8787"
# 由 Hub 维护者提供；不是节点令牌、登记令牌或 node_token。
hub_token: "<Hub共享申请凭据>"
`;
