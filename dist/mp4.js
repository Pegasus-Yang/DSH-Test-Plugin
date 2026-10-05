/** 只读取 MP4 索引与视频轨道，不加载整个录像或执行外部转码命令。 */
import { open } from "node:fs/promises";
export async function inspectMp4(path) {
    const file = await open(path, "r");
    try {
        const size = (await file.stat()).size;
        const read = async (start, count) => {
            const bytes = Buffer.alloc(count);
            if ((await file.read(bytes, 0, count, start)).bytesRead !== count)
                throw new Error("MP4 索引不完整");
            return bytes;
        };
        let examined = 0;
        const boxes = async (start, end) => {
            const values = [];
            while (start < end) {
                if (end - start < 8 || ++examined > 10000)
                    throw new Error("MP4 索引异常");
                const head = await read(start, 8);
                let length = head.readUInt32BE(0), header = 8;
                if (length === 1) {
                    length = Number((await read(start + 8, 8)).readBigUInt64BE());
                    header = 16;
                }
                else if (length === 0)
                    length = end - start;
                if (!Number.isSafeInteger(length) ||
                    length < header ||
                    start + length > end)
                    throw new Error("MP4 文件未完成封装");
                values.push({
                    type: head.toString("ascii", 4, 8),
                    start: start + header,
                    end: start + length,
                });
                start += length;
            }
            return values;
        };
        const child = async (parent, type) => (await boxes(parent.start, parent.end)).find((b) => b.type === type);
        const payload = async (box, count) => {
            if (box.end - box.start < count)
                throw new Error("MP4 视频索引不完整");
            return read(box.start, count);
        };
        const top = await boxes(0, size);
        const moov = top.find((b) => b.type === "moov");
        if (!moov ||
            !top.some((b) => b.type === "ftyp") ||
            !top.some((b) => b.type === "mdat" && b.end > b.start))
            throw new Error("MP4 缺少已封装的视频数据");
        for (const track of (await boxes(moov.start, moov.end)).filter((b) => b.type === "trak")) {
            const mdia = await child(track, "mdia");
            if (!mdia)
                continue;
            const handler = await child(mdia, "hdlr");
            if (!handler ||
                (await payload(handler, 12)).toString("ascii", 8, 12) !== "vide")
                continue;
            const mdhd = await child(mdia, "mdhd"), minf = await child(mdia, "minf");
            const stbl = minf && (await child(minf, "stbl"));
            const stsz = stbl && (await child(stbl, "stsz")), stsd = stbl && (await child(stbl, "stsd"));
            if (!mdhd ||
                !stsz ||
                !stsd ||
                !(await payload(stsz, 12)).readUInt32BE(8) ||
                (await payload(stsd, 16)).toString("ascii", 12, 16) !== "avc1")
                throw new Error("MP4 没有有效 H.264 视频轨道");
            const version = (await payload(mdhd, 1))[0];
            const timing = await payload(mdhd, version === 1 ? 32 : 20);
            const scale = timing.readUInt32BE(version === 1 ? 20 : 12);
            const duration = version === 1
                ? Number(timing.readBigUInt64BE(24))
                : timing.readUInt32BE(16);
            if (!scale || !Number.isSafeInteger(duration) || duration <= 0)
                throw new Error("MP4 视频时长不可读");
            return { duration_ms: Math.round((duration / scale) * 1000) };
        }
        throw new Error("MP4 没有视频轨道");
    }
    finally {
        await file.close();
    }
}
