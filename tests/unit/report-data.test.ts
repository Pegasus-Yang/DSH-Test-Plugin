import { expect, it } from "vitest";
import { ReportData } from "../../src/report-data.js";
it("重复下载与调用只登记一份，输出关闭标签被安全编码", () => {
  const data = new ReportData();
  const bytes = Buffer.from("中文下载");
  expect(data.download(bytes, "text/markdown")).toBe(
    data.download(bytes, "text/markdown"),
  );
  data.call("same", { result: "</script><script>bad</script>" });
  data.call("same", { result: "不同副本" });
  expect(Object.keys(data.downloads)).toHaveLength(1);
  expect(Object.keys(data.calls)).toHaveLength(1);
  expect(data.script()).not.toContain("</script>");
  expect(JSON.parse(data.script()).calls.same).toContain("</script>");
});
