/** 原生插件装配入口；所有注册随 Cordis 作用域释放。 */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-commands';
export const name = 'harness-test';
export const inject = ['agents', 'tools', 'commands'] as const;
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'test-status', description: '查看测试插件状态',
    handler: () => ({kind: 'success', text: '测试插件已加载；当前正在进行 M0 兼容性验证。'}),
  }));
}
