/** 浏览器连接来源在每次运行前冻结，凭据只从服务端私有文件读取。 */
export interface BrowserPreferences {
    backend: "playwright" | "runbridge";
    accessFile: string;
    resourceId: string;
    leaseSeconds: number;
    previewEnabled: boolean;
}
export declare const browserPreferenceDefaults: BrowserPreferences;
/** 仅解释文件格式，不携带可用许可。 */
export declare const runbridgeAccessTemplate = "# RunBridge \u79C1\u6709\u8BBF\u95EE\u914D\u7F6E\uFF1B\u4E5F\u652F\u6301\u539F\u6709 JSON \u6587\u4EF6\u3002\n# Hub \u57FA\u5740\uFF0C\u4E0D\u542B\u672B\u5C3E /mcp\uFF1B\u53CD\u5411\u4EE3\u7406\u524D\u7F00\u53EF\u4EE5\u4FDD\u7559\u3002\nhub_url: \"http://hub.example:8787\"\n# \u4EE5\u4E0B\u4E09\u9879\u7531 Node \u6240\u6709\u8005\u914D\u5957\u7B7E\u53D1\uFF0C\u4E0D\u4F7F\u7528 enrollment.token \u767B\u8BB0\u4EE4\u724C\u3002\nnode_id: \"node_example\"\ngrant_id: \"grant_example\"\n# \u4EE4\u724C\u4F7F\u7528\u5F15\u53F7\u5305\u88F9\uFF0C\u4FDD\u7559\u539F\u59CB\u5185\u5BB9\uFF1B\u8BF7\u52FF\u63D0\u4EA4\u5230 Git \u6216\u53D1\u9001\u5230\u5BF9\u8BDD\u3002\naccess_token: \"<Node\u6240\u6709\u8005\u7B7E\u53D1\u7684\u8BBF\u95EE\u4EE4\u724C>\"\n# \u53EF\u9009\uFF1A\u7B7E\u53D1\u6587\u4EF6\u6807\u6CE8\u7684\u5230\u671F\u65F6\u95F4\uFF0C\u6388\u6743\u4ECD\u4EE5 Hub \u4E3A\u51C6\u3002\n# expires_at: \"2030-01-01T00:00:00Z\"\n";
