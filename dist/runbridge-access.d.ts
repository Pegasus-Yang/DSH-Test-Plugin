export interface RunBridgeAccess {
    hub_url: string;
    node_id: string;
    grant_id: string;
    access_token: string;
    expires_at?: string | null;
}
export interface RunBridgeHubCredentials {
    hub_url: string;
    hub_token: string;
}
/** 已领取租约文件；不因缺少字段而尝试其他认证方式。 */
export declare function readRunBridgeAccess(path: string): RunBridgeAccess;
/** 领取响应和私有文件共用字段校验，错误不包含输入值。 */
export declare function validateRunBridgeAccess(result: RunBridgeAccess): RunBridgeAccess;
/** Hub 共享申请凭据只供资源目录及领取，不替代节点执行令牌。 */
export declare function readRunBridgeHubCredentials(path: string): RunBridgeHubCredentials;
export declare function hubPath(base: string, path: string): URL;
