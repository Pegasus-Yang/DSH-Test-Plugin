export function toolSource(entry) {
    return (entry.connection?.id ??
        entry.name.match(/^(mcp__.+__)[^_].*$/)?.[1] ??
        entry.name);
}
export function legacyBrowserTools(entries, selected) {
    const source = selected && entries.find((entry) => entry.name === selected);
    if (!source &&
        new Set(entries
            .filter((entry) => /__browser_(evaluate|capture)$/.test(entry.name))
            .map(toolSource)).size > 1)
        return {};
    const candidates = source
        ? entries.filter((entry) => toolSource(entry) === toolSource(source))
        : entries;
    const find = (suffix) => {
        const matches = candidates.filter((entry) => entry.name.endsWith("__" + suffix));
        return matches.length === 1 ? matches[0].name : undefined;
    };
    return {
        capture: find("browser_capture"),
        evaluate: find("browser_evaluate"),
        close: find("browser_close"),
        screenshot: find("browser_take_screenshot"),
    };
}
