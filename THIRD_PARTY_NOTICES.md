# 第三方依赖声明

本项目原创代码使用MIT许可证。发行包依赖Ajv 8.17.1（MIT）；其运行时依赖fast-deep-equal、fast-uri、json-schema-traverse、require-from-string各自保留原许可证。

宿主peer依赖DeepSeek Harness及Cordis、Schemastery模块采用其上游MIT许可证；插件不复制或修改宿主核心源码。

开发与实测工具包括TypeScript（Apache-2.0）、Vitest（MIT）、Prettier（MIT）、Playwright与Playwright MCP（Apache-2.0）、yaml（ISC）、@types/node（MIT）。这些工具不打包进插件dist。Chrome为用户系统已有浏览器，遵循其自身许可。

精确依赖版本见pnpm-lock.yaml和package.json；发布时应一并保留依赖包自身LICENSE。这里的声明不替代上游许可证原文。
