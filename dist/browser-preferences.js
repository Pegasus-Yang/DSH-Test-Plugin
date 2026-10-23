export const browserPreferenceDefaults = {
    backend: "playwright",
    accessFile: "",
    resourceId: "chromium",
    leaseSeconds: 1800,
    previewEnabled: true,
};
/** 仅解释文件格式，不携带可用许可。 */
export const runbridgeAccessTemplate = JSON.stringify({
    hub_url: "http://hub.example:8787",
    node_id: "node_example",
    grant_id: "grant_example",
    access_token: "<Node所有者签发的访问令牌>",
}, null, 2) + "\n";
