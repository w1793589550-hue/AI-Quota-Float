# AI Quota Floating Electron

Windows 桌面悬浮版 AI 额度观察器。

## 能做什么

- 透明无边框悬浮窗，置顶显示在其他应用上方。
- 跳过任务栏，类似 360 桌面悬浮窗。
- 毛玻璃风格额度面板。
- 超过 3 个 AI 服务时，内部列表滚动。
- 左下角刷新，右下角绿色切换小鹿，蓝色打开设置。
- 右上角箭头收起为横条。
- 小鹿模式下窗口缩小为小鹿，点击小鹿展开悬浮窗。
- 小鹿会在桌面工作区跑动，并尽量避开桌面图标区域。

## 运行

```powershell
cd D:\cc_text\ai-quota-floating-electron
npm install
npm start
```

或双击 `start-electron.bat`。

## 边界

Electron 可以实现真正置顶悬浮窗。桌面图标避让依赖 `scripts/get-desktop-icons.ps1` 读取 Explorer 的桌面 ListView 坐标；如果系统外壳结构、权限或安全策略导致读取失败，会退化为只避开任务栏与屏幕边缘。
