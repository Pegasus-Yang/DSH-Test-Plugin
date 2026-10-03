/** 通过真实 Web 页面执行命令和审批，保存截图与结果。 */
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
const {url}=JSON.parse(await readFile('.local/host-state.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
await page.goto(url);await page.waitForTimeout(1500);
if(await page.getByRole('button',{name:'继续',exact:true}).count())await page.getByRole('button',{name:'继续',exact:true}).click();
const rpc=async(method,args)=>page.evaluate(async({method,args})=>{const response=await fetch('/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args}})});return response.json();},{method,args});
for(const mode of ['approved','rejected']){
 const created=await rpc('session/create',{request:{cwd:process.cwd()}});
 const sessionId=created.result.value.sessionId;
 await page.evaluate(id=>localStorage.setItem('dsh.sessions.current',JSON.stringify({sessionId:id})),sessionId);
 await page.reload();await page.waitForTimeout(1500);
 const started=await rpc('commands/execute',{agentId:sessionId,line:'/test-m0-approval '+mode,submittedAttachments:[]});
 if(!started.result.ok)throw new Error(JSON.stringify(started));
 const button=page.getByRole('button',{name:mode==='approved'?'允许一次':'拒绝',exact:true});
 await button.waitFor({timeout:120000});
 await page.screenshot({path:'artifacts/validation/m0/approval-'+mode+'.png'});
 await button.click();
 for(let n=0;n<60;n++){
  const record=JSON.parse(await readFile('artifacts/validation/m0/approval-'+mode+'.json','utf8'));
  if(record.status==='FINISHED'){if(record.bodies!==(mode==='approved'?1:0))throw new Error('审批执行计数错误');console.log(mode,record);break;}
  if(n===59)throw new Error('审批完成超时');await page.waitForTimeout(1000);
 }
}
await browser.close();
