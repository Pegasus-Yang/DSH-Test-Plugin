/** 浏览器连接来源在每次运行前冻结，凭据只从服务端私有文件读取。 */
export interface BrowserPreferences {
  backend: "playwright" | "runbridge";
  accessFile: string;
  resourceId: string;
  leaseSeconds: number;
  previewEnabled: boolean;
}
export const browserPreferenceDefaults: BrowserPreferences = {
  backend: "playwright",
  accessFile: "",
  resourceId: "chromium",
  leaseSeconds: 1800,
  previewEnabled: true,
};
/** 仅解释文件格式，不携带可用许可。 */
export const runbridgeAccessTemplate = `# RunBridge 私有访问配置；也支持原有 JSON 文件。
# Hub 基址，不含末尾 /mcp；反向代理前缀可以保留。
hub_url: "http://hub.example:8787"
# 以下三项由 Node 所有者配套签发，不使用 enrollment.token 登记令牌。
node_id: "node_example"
grant_id: "grant_example"
# 令牌使用引号包裹，保留原始内容；请勿提交到 Git 或发送到对话。
access_token: "<Node所有者签发的访问令牌>"
# 可选：签发文件标注的到期时间，授权仍以 Hub 为准。
# expires_at: "2030-01-01T00:00:00Z"
`;
