/** 同源只读图片预览页，接口路径由已验证的运行身份生成。 */
export function previewPage(screenshotUrl) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>浏览器实时画面</title><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#101317;color:#d6dde5;font:12px system-ui,sans-serif}body{display:flex;flex-direction:column}.stage{flex:1;min-height:0;display:grid;place-items:center;overflow:hidden}img{display:block;max-width:100%;max-height:100%;object-fit:contain}.status{padding:9px 12px;color:#a9b6c5;border-top:1px solid #27313c;font-variant-numeric:tabular-nums}#empty{padding:24px;text-align:center;line-height:1.8}</style></head><body><div class="stage"><img id="image" alt="自动化浏览器的当前画面" hidden><p id="empty">正在连接浏览器画面</p></div><div class="status" id="status" aria-live="polite">等待新帧</div><script>
  const endpoint=${JSON.stringify(screenshotUrl)};
  const image=document.getElementById('image'),empty=document.getElementById('empty'),status=document.getElementById('status');
  let stopped=false,timer,active,currentUrl,currentKey;
  function clear(){image.hidden=true;image.removeAttribute('src');empty.hidden=false;if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=undefined;currentKey=undefined;}
  async function poll(){
    if(stopped||active)return;
    const controller=new AbortController();active=controller;
    const timeout=setTimeout(()=>controller.abort(),5000);let nextUrl;
    try{
      const response=await fetch(endpoint,{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error('当前浏览器画面暂不可用');
      const frame=response.headers.get('X-Frame-Id'),at=response.headers.get('X-Capture-Started-At'),key=frame+'/'+at;
      if(!frame||!at)throw new Error('等待有效画面');
      if(currentKey===key&&currentUrl)return;
      nextUrl=URL.createObjectURL(await response.blob());
      const loaded=new Image();await new Promise((done,fail)=>{loaded.onload=done;loaded.onerror=()=>fail(new Error('画面加载失败'));controller.signal.addEventListener('abort',()=>fail(new Error('读取超时')),{once:true});loaded.src=nextUrl;});
      controller.signal.throwIfAborted();image.src=nextUrl;image.hidden=false;empty.hidden=true;if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=nextUrl;nextUrl=undefined;currentKey=key;
      status.textContent='第 '+frame+' 帧 · '+new Date(at).toLocaleTimeString()+' · 只读预览';
    }catch(error){if(!stopped){clear();empty.textContent=error.name==='AbortError'?'画面读取超时，正在重试':error.message;status.textContent='连接暂不可用';}}
    finally{clearTimeout(timeout);if(nextUrl)URL.revokeObjectURL(nextUrl);active=undefined;if(!stopped)timer=setTimeout(poll,300);}
  }
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);active?.abort();clear();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&stopped){stopped=false;if(!active)poll();}});poll();
  </script></body></html>`;
}
