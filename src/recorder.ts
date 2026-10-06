/** 单进程串行账本、原子快照及证据归档；写失败立即交给测试作用域终止。 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  field,
  type Binding,
  type Evidence,
  type Json,
  type SuiteRun,
} from "./contracts.js";
export { rebuild, ledgerEvents } from "./ledger-rebuild.js";
export interface RecordedEvent {
  type: string;
  binding: Binding | { suite_run_id: string };
  payload: Json;
}
export function redact(value: unknown): Json {
  if (value === undefined) return null;
  if (value === null || typeof value === "boolean" || typeof value === "number")
    return value;
  if (typeof value === "string")
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [已脱敏]")
      .replace(/([?&](?:token|api_key|password)=)[^\s&#]+/gi, "$1[已脱敏]");
  if (Array.isArray(value)) return value.map(redact);
  if (
    typeof value === "object" &&
    field(value, "type") === "image" &&
    typeof field(value, "data") === "string"
  )
    return {
      type: "image",
      mimeType: String(field(value, "mimeType") ?? ""),
      data: "[二进制图像另存证据附件]",
    };
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /^(?:password|passwd|authorization|cookie|set-cookie|token|api[_-]?key|secret)$/i.test(
          key,
        )
          ? "[已脱敏]"
          : redact(v),
      ]),
    );
  return String(value);
}
export function safePath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("附件必须使用相对路径");
  const full = resolve(root, path),
    rel = relative(root, full);
  if (!rel || rel === ".." || rel.startsWith(".." + sep))
    throw new Error("路径逃逸");
  let parent = dirname(full);
  while (!existsSync(parent)) parent = dirname(parent);
  const actual = realpathSync(parent),
    trusted = realpathSync(root),
    r = relative(trusted, actual);
  if (r === ".." || r.startsWith(".." + sep))
    throw new Error("符号链接路径逃逸");
  return full;
}
export function atomicJson(path: string, value: unknown): void {
  atomicWrite(path, JSON.stringify(redact(value), null, 2) + "\n");
}
export function atomicWrite(path: string, contents: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + "." + randomUUID() + ".tmp";
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
export class Recorder {
  private secrets = new Set<string>();
  protect(input: unknown): void {
    if (!input || typeof input !== "object") return;
    for (const [key, value] of Object.entries(input)) {
      if (
        /^(?:password|passwd|authorization|cookie|token|api[_-]?key|secret)$/i.test(
          key,
        ) &&
        typeof value === "string" &&
        value
      )
        this.secrets.add(value);
      else this.protect(value);
    }
  }
  sanitize(value: unknown): Json {
    const visit = (v: Json): Json =>
      typeof v === "string"
        ? [...this.secrets].reduce(
            (text, secret) => text.replaceAll(secret, "[已脱敏]"),
            v,
          )
        : Array.isArray(v)
          ? v.map(visit)
          : v && typeof v === "object"
            ? Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, visit(x)]),
              )
            : v;
    return visit(redact(value));
  }
  readonly directory: string;
  private seq = 0;
  failed?: Error;
  private seen = new Set<string>();
  private checkpoints: string[] = [];
  private obsolete = new Set<string>();
  constructor(
    root: string,
    readonly runId: string,
    private readonly onEvent?: (event: RecordedEvent) => void,
  ) {
    mkdirSync(root, { recursive: true });
    this.directory = join(realpathSync(root), runId);
    mkdirSync(this.directory);
    mkdirSync(join(this.directory, "evidence"));
  }
  event(type: string, payload: unknown, binding?: Binding, key?: string): void {
    if (this.failed) throw this.failed;
    if (key && this.seen.has(key)) return;
    try {
      const event = {
        schema_version: "2",
        seq: this.seq,
        event_id: randomUUID(),
        timestamp: new Date().toISOString(),
        type,
        binding: binding ?? { suite_run_id: this.runId },
        payload: this.sanitize(payload),
      };
      const fd = openSync(join(this.directory, "events.jsonl"), "a", 0o600);
      try {
        appendFileSync(fd, JSON.stringify(event) + "\n");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.seq++;
      if (key) this.seen.add(key);
      // 展示失败不能污染已落盘的测试事实或阻断资源清理。
      try {
        this.onEvent?.(event);
      } catch (error) {
        console.warn(
          "测试进度展示失败：",
          String(this.sanitize(String(error))),
        );
      }
    } catch (error) {
      this.failed = error instanceof Error ? error : new Error(String(error));
      throw this.failed;
    }
  }
  snapshot(run: SuiteRun): void {
    try {
      if (this.failed) throw this.failed;
      const contents = JSON.stringify(this.sanitize(run), null, 2) + "\n";
      const path = `checkpoints/state-${this.seq}.json`;
      atomicWrite(safePath(this.directory, path), contents);
      this.event("state_checkpoint", {
        relative_path: path,
        through_seq: this.seq - 1,
        bytes: Buffer.byteLength(contents),
        sha256: createHash("sha256").update(contents).digest("hex"),
      });
      this.checkpoints.push(path);
      atomicWrite(join(this.directory, "results.json"), contents);
      while (this.checkpoints.length > 2)
        this.obsolete.add(this.checkpoints.shift()!);
      for (const old of this.obsolete) {
        try {
          unlinkSync(safePath(this.directory, old));
          this.obsolete.delete(old);
        } catch (error) {
          console.warn(
            "旧测试快照回收失败：",
            String(this.sanitize(String(error))),
          );
        }
      }
    } catch (error) {
      this.failed = error instanceof Error ? error : new Error(String(error));
      throw this.failed;
    }
  }
  json(name: string, value: unknown): void {
    try {
      atomicJson(safePath(this.directory, name), this.sanitize(value));
    } catch (e) {
      this.failed = e instanceof Error ? e : new Error(String(e));
      throw this.failed;
    }
  }
  evidence(
    name: string,
    content: string | Buffer,
    mediaType: string,
    redacted = true,
  ): Evidence {
    const relativePath = "evidence/" + name,
      path = safePath(this.directory, relativePath);
    if (typeof content === "string") {
      if (mediaType === "application/json")
        content = JSON.stringify(this.sanitize(JSON.parse(content)), null, 2);
      else content = String(this.sanitize(content));
    }
    atomicWrite(path, content);
    return {
      evidence_id: randomUUID(),
      relative_path: relativePath,
      media_type: mediaType,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      redacted,
    };
  }
}
