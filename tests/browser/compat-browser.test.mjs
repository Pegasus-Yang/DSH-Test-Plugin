/** 首次引导必须通过实际按钮完成；覆盖无模型凭据和慢启动的 CI 条件。 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { enter, openSettings } from "../../scripts/compat/browser.mjs";

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => browser?.close());

async function fixture(options, run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = "http://compat.test/";
  await page.route(url, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>.mask{position:fixed;inset:0;background:#ddd;z-index:100;display:grid;place-items:center}section{background:white;padding:40px}[contenteditable]{width:400px;height:80px}</style>
<div id="root"><div contenteditable="${options.noWorkspace ? "false" : "true"}">输入消息</div><div id="launcher"></div><div id="settings"></div></div>
<script>
const options=${JSON.stringify(options)};
window.actions=[];
const root=document.getElementById('root');
const launcher=document.getElementById('launcher');
const settings=document.getElementById('settings');
const button=(label,action,parent=launcher)=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;parent.append(b);return b;};
const showSettings=()=>{window.actions.push('settings');settings.replaceChildren();button('测试插件',()=>{window.actions.push('plugin');settings.innerHTML='<input id="dsh-test-browscreen-port" value="13401">';},settings);};
let launch;
if(options.account){launch=button('账号菜单',()=>{window.actions.push('account');const item=button('设置',showSettings);item.setAttribute('role','menuitem');});}
else launch=button('设置',showSettings);
const ready=()=>{root.inert=false;launch.disabled=false;};
const modal=(title,label,action)=>{root.inert=true;const mask=document.createElement('div');mask.className='mask';mask.setAttribute('role','presentation');const dialog=document.createElement('section');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label',title);dialog.setAttribute('aria-modal','true');const heading=document.createElement('h2');heading.textContent=title;dialog.append(heading);button(label,()=>{mask.remove();action();},dialog);mask.append(dialog);document.body.append(mask);return dialog;};
const credential=()=>modal('添加一个 API Key 开始使用','稍后配置',()=>{window.actions.push('later');ready();});
const accountSetup=()=>{const dialog=modal('开始使用','关闭',()=>{window.actions.push('close-account');ready();});button('添加 API Key',()=>window.actions.push('add-api-key'),dialog);button('登录',()=>window.actions.push('sign-in'),dialog);};
if(options.unknown){modal('需要人工确认','继续',()=>{window.actions.push('unknown');ready();});}
else if(options.transition){const dialog=modal('预览版说明','继续',()=>window.actions.push('unexpected-continue'));dialog.querySelector('button').disabled=true;setTimeout(()=>{dialog.parentElement.remove();credential();},200);}
else if(options.welcome){launch.disabled=true;setTimeout(()=>modal('预览版说明','继续',()=>{window.actions.push('continue');if(options.accountSetup)setTimeout(accountSetup,75);else if(options.credential)setTimeout(credential,75);else ready();}),options.delay??0);}
else if(options.credential){credential();}
</script></html>`,
    }),
  );
  try {
    await run(page, { url });
  } finally {
    await context.close();
  }
}

test("无密钥时依次完成欢迎和凭据引导，再打开插件设置", async () => {
  await fixture({ welcome: true, credential: true }, async (page, state) => {
    await enter(page, state);
    await openSettings(page);
    assert.deepEqual(await page.evaluate(() => window.actions), [
      "continue",
      "later",
      "settings",
      "plugin",
    ]);
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(
      await page.locator("#dsh-test-browscreen-port").inputValue(),
      "13401",
    );
  });
});

test("欢迎页晚于原先两秒出现时，仍通过原生操作完成引导", async () => {
  await fixture({ welcome: true, delay: 2200 }, async (page, state) => {
    await enter(page, state);
    await openSettings(page);
    assert.deepEqual(await page.evaluate(() => window.actions), [
      "continue",
      "settings",
      "plugin",
    ]);
  });
});

test("已有配置时直接通过账号菜单进入设置", async () => {
  await fixture({ account: true }, async (page, state) => {
    await enter(page, state);
    await openSettings(page);
    assert.deepEqual(await page.evaluate(() => window.actions), [
      "account",
      "settings",
      "plugin",
    ]);
  });
});

test("alpha.3 的账号首次引导通过原生关闭退出，不登录或添加密钥", async () => {
  await fixture(
    { welcome: true, account: true, accountSetup: true },
    async (page, state) => {
      await enter(page, state);
      await openSettings(page);
      assert.deepEqual(await page.evaluate(() => window.actions), [
        "continue",
        "close-account",
        "account",
        "settings",
        "plugin",
      ]);
      assert.equal(await page.getByRole("dialog").count(), 0);
    },
  );
});

for (const account of [false, true]) {
  test(`未选工作区时，完成引导并通过${account ? "账号菜单" : "设置按钮"}打开插件设置`, async () => {
    await fixture(
      {
        noWorkspace: true,
        welcome: true,
        credential: !account,
        account,
        accountSetup: account,
      },
      async (page, state) => {
        await enter(page, state);
        assert.equal(await page.locator('[contenteditable="true"]').count(), 0);
        await openSettings(page);
        assert.deepEqual(await page.evaluate(() => window.actions), [
          "continue",
          account ? "close-account" : "later",
          ...(account ? ["account"] : []),
          "settings",
          "plugin",
        ]);
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(
          await page.locator("#dsh-test-browscreen-port").inputValue(),
          "13401",
        );
      },
    );
  });
}

test("未知弹窗仍阻止操作，不能按同名继续按钮绕过", async () => {
  await fixture({ unknown: true }, async (page, state) => {
    await assert.rejects(enter(page, state, { timeout: 750 }), {
      name: "TimeoutError",
    });
    assert.deepEqual(await page.evaluate(() => window.actions), []);
    assert(
      await page.getByRole("dialog", { name: "需要人工确认" }).isVisible(),
    );
  });
});

test("引导弹窗在等待期间被替换时，重新识别并完成当前引导", async () => {
  await fixture(
    { transition: true, noWorkspace: true },
    async (page, state) => {
      await enter(page, state, { timeout: 5000 });
      await openSettings(page);
      assert.deepEqual(await page.evaluate(() => window.actions), [
        "later",
        "settings",
        "plugin",
      ]);
      assert.equal(await page.getByRole("dialog").count(), 0);
    },
  );
});
