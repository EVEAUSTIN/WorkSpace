# Windows 桌面版：本地存储验证阶段

本版本提供 Electron 窗口及 SQLite 本地存储。**尚未启用业务云同步、自动更新、浏览器历史数据迁移或安卓打包。** 请先使用测试内容，原网页和浏览器数据继续保留。

## 首次运行

安装 Node.js 24 LTS。在 PowerShell 进入解压后的工程根目录（须有 package.json）：

```powershell
cd "D:\WorkSpace\WorkSpace-main"
$env:Path = "D:\Node;" + $env:Path
npm.cmd ci
npm.cmd start
```

Electron 是项目依赖，不需要另行全局安装。首次安装会下载 Electron，如果下载失败请保留错误信息，不要关闭 TLS 证书校验。

旧 ZIP 不会自动包含新提交，请重新下载仓库 ZIP 到新的目录，例如 WorkSpace-desktop，保留原文件夹，不要混合复制 node_modules。

## 检查本地保存

新建一条测试备忘录和一篇测试笔记，关闭整个应用，再打开，确认内容仍在。数据库位于 Windows 的 `%APPDATA%\qijian-workspace\workspace.sqlite`（开发运行）；打包后目录以实际 Electron userData 为准，通常仍为 qijian-workspace。数据库及 WAL 文件由程序管理，不要在运行时移动或删除。

所有现有持久化的设置、业务记录、天气文献缓存和笔记改为 SQLite；本次会话的 AI 对话仍遵循网页原有的内存记录规则，关闭后不保留。AI API 密钥如果选择保存，也会存入本机数据库，目前没有额外加密。附件目前沿用原网页格式，没有独立附件目录。

此阶段不读取 GitHub Pages 的浏览器数据，也不上传业务记录到 CloudBase。测试页仍在浏览器中打开。天气、地图、AI 和文献检索仍需要网络，外部服务能否访问取决于网络；地图现有 CDN 依赖尚未离线打包。桌面通知权限暂未开放。

## 生成安装包

在 Windows 工程目录运行：

```powershell
npm.cmd run dist:win
```

产物在 dist 中。安装包暂未签名，Windows 可能显示未知发布者。代码更新后需要重新打包，此版没有自动更新机制。安装包可以在其他 Windows 电脑使用，无需另装 Node.js。

## 验证

```powershell
npm.cmd run test:desktop
```

该检查验证 SQLite 重启持久化、更新、删除和参数化查询，不代表完整云同步已通过。
