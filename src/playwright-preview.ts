/** Playwright 的只读画面增强；不改变工具选择，也不重启现有浏览器。 */
export function isPlaywrightMcp(config: {
  args?: string[];
  command?: string;
}): boolean {
  return (
    !!config.args?.some((arg) =>
      /@playwright[\\/]mcp|@playwright\+mcp|playwright\/mcp\/cli\.js/.test(arg),
    ) || /(?:^|[\\/])playwright-mcp(?:\.cmd)?$/.test(config.command ?? "")
  );
}
const documentIdentity =
  "await page.evaluate(() => 'document:' + JSON.stringify([performance.timeOrigin, location.href]))";
const identity = `const document_id=${documentIdentity};
  let page_id=document_id;
  try { const session=await page.context().newCDPSession(page);
    try { page_id=(await session.send('Target.getTargetInfo')).targetInfo.targetId; }
    finally { await session.detach(); }
  } catch { /* 非 Chromium 页面使用真实文档身份。 */ }`;
export const playwrightPreviewContext = `async (page) => { ${identity}; return {page_id}; }`;
export const playwrightPreviewFrame = `async (page) => {
  ${identity};
  const image=await page.screenshot({type:'jpeg',quality:65,scale:'css'});
  const after=${documentIdentity};
  if(document_id!==after)throw new Error('截图期间页面文档已改变');
  return {page_id,image:{mimeType:'image/jpeg',data:image.toString('base64')}};
}`;
