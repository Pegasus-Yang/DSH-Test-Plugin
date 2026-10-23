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
export declare const browserPreferenceDefaults: BrowserPreferences;
/** 仅解释文件格式，不携带可用许可。 */
export declare const runbridgeAccessTemplate = "# RunBridge \u79C1\u6709\u8BBF\u95EE\u914D\u7F6E\uFF1B\u4E5F\u652F\u6301\u539F\u6709 JSON \u6587\u4EF6\u3002\n# Hub \u57FA\u5740\uFF0C\u4E0D\u542B\u672B\u5C3E /mcp\uFF1B\u53CD\u5411\u4EE3\u7406\u524D\u7F00\u53EF\u4EE5\u4FDD\u7559\u3002\nhub_url: \"http://hub.example:8787\"\n# \u4EE5\u4E0B\u4E09\u9879\u7531 Hub \u672C\u6B21\u9886\u53D6\u914D\u5957\u7B7E\u53D1\uFF0C\u4E0D\u4F7F\u7528 enrollment.token \u767B\u8BB0\u4EE4\u724C\u3002\nnode_id: \"node_example\"\ngrant_id: \"grant_example\"\n# \u4EE4\u724C\u4F7F\u7528\u5F15\u53F7\u5305\u88F9\uFF0C\u4FDD\u7559\u539F\u59CB\u5185\u5BB9\uFF1B\u8BF7\u52FF\u63D0\u4EA4\u5230 Git \u6216\u53D1\u9001\u5230\u5BF9\u8BDD\u3002\naccess_token: \"<Hub\u672C\u6B21\u7B7E\u53D1\u7684\u8282\u70B9\u4EE4\u724C>\"\n# Hub \u7B7E\u53D1\u7684\u5230\u671F\u65F6\u95F4\uFF1B\u5B9E\u9645\u671F\u9650\u4E0E\u7A7A\u95F2\u56DE\u6536\u4EE5 Hub \u67E5\u8BE2\u4E3A\u51C6\u3002\nexpires_at: \"2030-01-01T00:00:00Z\"\n";
export declare const runbridgeHubTemplate = "# Hub \u5171\u4EAB\u7533\u8BF7\u51ED\u636E\uFF1B\u652F\u6301 YAML \u6CE8\u91CA\uFF0C\u4E5F\u652F\u6301 JSON\u3002\n# \u53EA\u7528\u4E8E\u53EA\u8BFB\u8D44\u6E90\u6C60\u548C\u7533\u8BF7 Node\uFF0C\u4E0D\u80FD\u76F4\u63A5\u6267\u884C\u8BBE\u5907\u52A8\u4F5C\u3002\nhub_url: \"http://hub.example:8787\"\n# \u7531 Hub \u7EF4\u62A4\u8005\u63D0\u4F9B\uFF1B\u4E0D\u662F\u8282\u70B9\u4EE4\u724C\u3001\u767B\u8BB0\u4EE4\u724C\u6216 node_token\u3002\nhub_token: \"<Hub\u5171\u4EAB\u7533\u8BF7\u51ED\u636E>\"\n";
