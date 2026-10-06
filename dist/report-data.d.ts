export declare class ReportData {
    readonly downloads: Record<string, {
        mime: string;
        base64: string;
    }>;
    readonly calls: Record<string, string>;
    download(bytes: Buffer, mime: string): string;
    call(id: string, value: unknown): void;
    script(): string;
}
