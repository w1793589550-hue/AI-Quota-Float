# AI Quota Float 分发说明

## 可以直接发给别人吗

可以。打包后的 `ai-quota-floating-electron-dist` 文件夹可以整体压缩后发送给别人，对方双击 `AI-Quota-Float.exe` 即可运行。

不要只发送单独的 `.exe`，因为它依赖同目录下的 Electron 运行时文件和 `resources/app` 应用目录。

## API Key 安全边界

本软件使用 Electron `safeStorage` 将用户输入的 API Key 加密保存到本机用户数据目录。它能避免 Key 以明文写入配置文件。

打包目录 `ai-quota-floating-electron-dist` 不包含你的本机 API Key。你把这个文件夹发给别人时，对方首次打开看到的 API Key 输入项应为空；他们填写后，Key 会加密保存在他们自己的电脑本机用户数据目录中。

Windows 上本机配置通常位于：

`%APPDATA%\ai-quota-floating-electron\quota-state.json`

这个文件不在打包目录里，除非你手动把自己的 `%APPDATA%` 配置文件也一起发出去。

但不要把你自己的 API Key 预置进软件后发给别人。本地桌面软件无法真正保护内置在程序里的 Key，接收方总有办法从运行时、网络请求或配置中提取。

正确分发方式：

1. 发空配置版本。
2. 让每个用户在设置里填写自己的 API Key。
3. 如果要多人共用额度，请做一个服务端中转 API，由服务端保存 Key、控制权限和限流，客户端只拿临时令牌。

如果未来要支持“加密保存在后端云端”，需要额外部署后端服务：用户登录、服务端加密保存 Key、接口鉴权、限流、审计日志和删除 Key 功能。不要让桌面客户端直接持有所有人的 Key。

## 重新打包

源码修改后，重新生成便携版：

1. 删除旧的 `D:\cc_text\ai-quota-floating-electron-dist`。
2. 从 Electron 运行时复制文件。
3. 将源码目录复制到 `resources/app`。
4. 将 `electron.exe` 改名为 `AI-Quota-Float.exe`。

Codex 已按这个方式生成过便携版。
