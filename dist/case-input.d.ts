export interface InputFile {
    path: string;
    content: string;
}
export interface CaseTemplate {
    id: string;
    text: string;
    line: number;
}
export interface TextInstance {
    id: string;
    template_id: string;
    case_number: number;
    data_row?: number;
    parameters: Record<string, string>;
    task: string;
}
export interface TextInput {
    case_file?: InputFile;
    csv_file?: InputFile;
    context: string;
    templates: CaseTemplate[];
    headers: string[];
    rows: Record<string, string>[];
    instances: TextInstance[];
}
export declare function workspaceFile(workspace: string, input: string): string;
export declare function parseCases(content: string, extension: string): {
    templates: CaseTemplate[];
    context: string;
};
export declare function parseParameters(content: string): {
    headers: string[];
    rows: {
        [k: string]: string;
    }[];
};
export declare function substitute(template: string, parameters: Record<string, string>): string;
export declare function createTextInput(source: {
    templates: CaseTemplate[];
    context: string;
    case_file?: InputFile;
}, csv_file?: InputFile): TextInput;
export declare function loadTextInput(workspace: string, file: string): TextInput;
/** 仅对路径识别引号；余下的任务文字不做shell解析。 */
export declare function takePath(input: string): {
    path: string;
    rest: string;
};
export declare function fileArgument(input: string): string;
export declare function loadDataInput(workspace: string, input: string): TextInput;
