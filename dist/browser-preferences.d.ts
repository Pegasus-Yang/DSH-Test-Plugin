/** 浏览器连接来源在每次运行前冻结，凭据只从服务端私有文件读取。 */
export interface BrowserPreferences {
    backend: "playwright" | "runbridge";
    accessFile: string;
    resourceId: string;
    leaseSeconds: number;
    previewEnabled: boolean;
}
export declare const browserPreferenceDefaults: BrowserPreferences;
