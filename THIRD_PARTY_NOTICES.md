# 第三方依赖声明

本项目原创代码使用MIT许可证。发行包依赖Ajv 8.17.1（MIT）；其运行时依赖fast-deep-equal、fast-uri、json-schema-traverse、require-from-string各自保留原许可证。

宿主peer依赖DeepSeek Harness及Cordis、Schemastery模块采用其上游MIT许可证；插件不复制或修改宿主核心源码。

开发与实测工具包括TypeScript（Apache-2.0）、Vitest（MIT）、Prettier（MIT）、Playwright与Playwright MCP（Apache-2.0）、yaml（ISC）、@types/node（MIT）。这些工具不打包进插件dist。Chrome为用户系统已有浏览器，遵循其自身许可。

精确依赖版本见pnpm-lock.yaml和package.json；发布时应一并保留依赖包自身LICENSE。这里的声明不替代上游许可证原文。

插件图标 `icon.svg` 为本项目原创，与项目代码同按 MIT 许可证分发。

报告导航与控件使用 Tabler Icons 的 home、list-details、info-circle、search、circle-check、chevron-down、photo、external-link 原始SVG，来源 https://github.com/tabler/tabler-icons ，以 data URI 嵌入静态报告，无运行时网络依赖。上游许可原文：

```text
MIT License

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
