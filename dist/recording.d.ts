import type { BrowserRecording, Evidence } from "./contracts.js";
export interface RecordingContext {
    directory: string;
    deadline: () => number;
    emit: (event: "recording_started" | "recording_finished", recording: BrowserRecording, evidence?: Evidence) => void;
}
export declare function recordingProblem(line: string): string | undefined;
export declare class RecordingSession {
    private context;
    readonly path: string;
    readonly value: BrowserRecording;
    notice?: string;
    private decoder;
    private text;
    private summary?;
    private finalizing?;
    private sealed;
    private abort;
    constructor(context: RecordingContext, caseId: string, target: string);
    deadline(): number;
    data(bytes: Buffer): void;
    private line;
    frame(at: string): void;
    seal(reason: string): void;
    finish(forced: boolean): Promise<void>;
    private complete;
}
