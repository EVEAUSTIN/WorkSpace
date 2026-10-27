# 栖间 CloudBase 接入：第一阶段连接测试

环境：`emotional-newt-d5gg8duqi1ab13685`，上海（`ap-shanghai`）。

当前仅新增独立的 `cloudbase-test.html`。**工作台尚未启用正式云同步，也未迁移历史数据。** 测试页不读写工作台的 localStorage/IndexedDB 数据；它只在 `public.qijian_records` 中读写 `collection=__connection_test`、`record_id=cross-device-probe` 这一条登录用户自己的测试记录。

## 前置状态

用户已在控制台创建应用账号、启用用户名密码登录，并执行建表 SQL：

- 主键 `(owner_id, collection, record_id)`；`owner_id` 默认 `auth.uid()::text`。
- 字段 `payload jsonb`、`version bigint`、`deleted boolean`、`updated_at timestamptz`。
- RLS 策略只允许 `authenticated` 访问 `owner_id=auth.uid()::text` 的记录。
- 登录用户拥有 SELECT / INSERT / UPDATE，匿名角色没有表权限；不授予硬删除。
- `qijian_records_stamp` 触发器负责初始版本 1、更新时加 1 和服务器更新时间。

该截图只能确认表存在且 RLS 开启。真实账号的 token、用户标识映射、具体策略和请求头仍需现场验证，不能据此宣称隔离或同步已通过。

## 部署文件

必须保留相对目录：

- `cloudbase-test.html`
- `assets/cloudbase-probe.js`
- `assets/cloudbase-auth-3.10.4.js`
- `assets/cloudbase-auth-3.10.4.js.LEGAL.txt`
- `assets/cloudbase-sdk-LICENSE.txt`
- `assets/cloudbase-THIRD-PARTY-NOTICES.txt`

通过 HTTPS 网站或本地静态服务器打开，不能只复制 HTML 而遗漏 assets。工作台的“AI 设置”页面已添加测试入口。测试页不依赖境外 CDN，但登录仍需访问 CloudBase 的官方服务。SDK 使用 `GATEWAY` 模式；如服务要求安全域名，将当前网站来源按控制台规定加入允许列表。不要为网页接入开放 PostgreSQL 公网直连。

## 用户操作

1. 在设备 A 打开测试页，粘贴**客户端 Publishable Key**，输入在身份认证中创建的应用用户名与密码。不要填写服务端 API Key、SecretKey 或数据库密码。
2. 登录并确认测试记录读取成功，输入一句不含隐私的测试内容，保存。
3. 设备 B 通过同一网站打开测试页，登录同一个应用账号，确认能看到 A 的内容；从 B 修改后保存，再从 A 读取。
4. 两台设备同时编辑时，旧版本更新会返回空结果或冲突。页面保留本地未保存输入，不自动覆盖。明确点击“用云端内容替换输入”后再继续。
5. 有测试记录后可执行“检查未登录访问”。401/403 或没有可见记录是辅助证据，不代替不同账号之间的隔离测试。若未登录读到记录，页面停止写入，先修复权限。
6. 可用另一个临时应用账号确认它读不到原账号的测试内容；随后再登录原账号检查记录仍在。不要用生产隐私数据测试。
7. 完成后清理测试记录并退出。清理是保留版本的软删除，不使用 DELETE。

密码不会写入仓库、页面配置或自建日志。Publishable Key 可在当前标签页 sessionStorage 中保留；登录 token 由官方 SDK 的 session 持久化管理。不要把密码或 token 发送到聊天中。

## 诊断与限制

- 登录失败：核对环境、客户端可发布密钥、应用账号和用户名密码登录开关；若控制台要求安全域名或人机验证，按官方要求处理。
- 401：检查会话与接口接受的凭证。
- 403：检查表授权、RLS、`auth.uid()` 的用户标识映射，**不要关闭 RLS 排障**。
- 404：检查 `public.qijian_records` 是否存在，以及是否部署了正确版本。
- 写入返回空数组：不能当成功；可能是版本冲突或权限规则阻止，先读取检查。
- 写入超时：结果不确定，先读取再判断，不盲目重试覆盖。
- 断网：只显示上次结果，不声称本次读写成功。

这里只是接入验证，不包含业务记录同步、离线队列、附件上传、后台同步或迁移。真实双设备测试完成后，再开发这些功能；开发前保留现有浏览器数据。

## 重建官方 SDK

浏览器仅打包 `@cloudbase/js-sdk/app` 和 `@cloudbase/js-sdk/auth`，版本固定为 3.10.4，不使用管理员 SDK。构建入口与依赖锁文件在 `tools/cloudbase-sdk`。

```sh
cd tools/cloudbase-sdk
npm ci --ignore-scripts
npm run build
```

保留 npm 包完整性校验以及随输出分发的许可证。不要在构建源码中填入账号密码或服务端密钥。

## 本地验证

安装 Playwright 并准备 Chromium 后运行：

```sh
python tests/test_cloudbase_probe.py
```

脚本自启本地静态服务器，并模拟账号鉴权与 PostgREST 响应，检查双设备交互、冲突、软删除与风险提示。它不使用真实用户名密码，也不能替代你在 CloudBase 环境上的实际验证。
