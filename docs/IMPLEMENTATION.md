# dsh-zf-assistant 实现计划（Implementation Plan）

> 父规格：`docs/DESIGN.md`（已批准）。本计划把 P1+P2 合并交付拆成可执行任务。
> 执行约定：默认当前分支/工作区；每完成一个 Task 跑一遍验证再 commit（可用则提交）。TDD 模式 off → 最小改动 + 事后回归验证，不强制 RED/GREEN。

## Goal
让 DSH 能像逐飞助手一样连接单片机（WiFi TCP/UDP 优先），逐帧解析数据，实时显示多通道示波器 + 图像 + hex 日志，并让 Agent 能读写数据实现自动调参。

## Architecture
- 宿主 `index.mjs`：Transport(TCP Server/Client/UDP) → Protocol(JSON/自定义二进制/zf/text) → DataBuffer → 工具 + /seekfree-api/* REST + /seekfree-api/poll 轮询流。
- 浏览器 `lib/client.js`：经 `window.__ModuleLoader__` 挂 `settings.section` 槽位渲染「设备调试」面板（选择界面 + Canvas 示波器 + 图像 + hex 日志 + 状态栏）。
- 激活：加入 `profiles/web` `dsh.profile.bundles` + link 依赖 → 重建 web 产物 → 刷新验证。

## Tech Stack
Node（宿主，原生 net/dgram/fs/web）；@deepseek-ai/dsh-tools defineTool；Electron DSH webServer；浏览器纯 React（canvas，不引重依赖）；无原生模块。

## Baseline/Authority Refs
- `F:\DeepSeek Harness\plugins\dsh-zf-assistant\package\docs\DESIGN.md`（已批准）
- DSH 插件范式：`F:\DeepSeek Harness\plugins\dsh-dlpath\package\`（defineTool + client slots + /api 路由，最相似）
- 装载机制：`F:\DeepSeek Harness\dsh-home\profiles\web\package.json`（dsh.profile.bundles + link 依赖）

## Compatibility Boundary
- 只新增 DSH 插件 + profile bundles 增项；不改宿主核心、不动既有会话/持久化。
- 传输/协议/视图三层解耦，任一层可独立替换。
- 串口（`serial` transport）为 P3，本计划只在传输层留接口，不实现。

## TDD Route
- Mode: off → Decision: skipped（无明确用户 strict 请求）。
- Test posture：协议解析器单元测试（node test）+ 本地 loopback 集成 + 端到端人工验证。

## Verification（总）
- 单元：`node --test test/*.test.mjs`（JSON/custom/zf/text 协议解析、粘包半包、坏帧重同步）。
- 集成：本地 TCP loopback 脚本灌帧 → 断言 DataBuffer 与 `mcu_read_wave`。
- 端到端：TCP 模拟器灌帧 → 面板示波器/图像/日志更新；`mcu_connect`/`mcu_send`/`mcu_read_wave` 工具可用。
- 激活：重建 web 产物 + 刷新页面 → 面板出现、工具可调。

---

## File Map
```
F:\DeepSeek Harness\plugins\dsh-zf-assistant\package\
  package.json            # 插件清单（dsh.bundle.patch / client.platform）
  cordis.patch.yml        # insert 注册插件 id
  index.mjs               # 宿主：transport+protocol+buffer+tools+api
  lib\transport.mjs       # TCP Server/Client/UDP 传输
  lib\protocol.mjs        # JSON / 自定义二进制 / zf / text 协议
  lib\buffer.mjs          # 波形/图像/原始字节环形缓冲
  lib\client.js           # 浏览器「设备调试」面板
  test\protocol.test.mjs  # 协议解析单元测试
  docs\DESIGN.md          # (已存在)
  docs\IMPLEMENTATION.md  # (本文件)
```

---

## Task 1 – 插件骨架与清单
Files: `package.json`, `cordis.patch.yml`
- 仿 dsh-dlpath：`package.json`（name `dsh-zf-assistant`, type module, `dsh.bundle.patch`, `dsh.client.platform: web`, main `./index.mjs`, exports, peerDeps cordis/dsh-tools）。
- `cordis.patch.yml`：`- insert: - id: zf-assistant / name: dsh-zf-assistant`。
- Verify：文件存在、JSON 合法（`node -e require(...)` 或 `node --check index.mjs`）。

## Task 2 – 环形缓冲 `lib/buffer.mjs`
- 波形环形队列（默认 10_000 采样，`push(sample)`，`window(range)`），图像 `setImage(frame)/getImage()`，原始字节滚动。
- API 清晰、可单测。
- Test: `test/protocol.test.mjs` 或独立 buffer 用例。

## Task 3 – 传输层 `lib/transport.mjs`
- `tcp-server`(listen)、`tcp-client`(connect)、`udp`(bind/send) 三实现，统一 `connect/disconnect/send(bytes)/onData(cb)/status`。
- 用 Node `net`/`dgram`。
- Verify：`node --test`（loopback 收发）+ 手动 mock。

## Task 4 – 协议层 `lib/protocol.mjs`
- `json`：`{"ch":[..]}` 波形 / `{"type":"image",...}` 图像（base64），显式配置 `imageBase64`。
- `custom-binary`：可配置帧头/长度字段/通道类型/大小端/校验，按配置解析。
- `zf`：已按 STC32G144K 开源库 `seekfree_assistant.c/.h` 核准——上行 `[0xAA, 0x10|通道数, 和校验, 长度, float大端×通道数]`，下行 `[0x55, 0x20, 通道号1based, 和校验, float大端4B]`。
- `text`：单片机 `printf` 的键值行（`L:0, R:0, Kp:13.0\r\n`），`fields` 决定通道顺序与名称；不配 `fields` 按首次出现顺序建通道；缺字段沿用上次值；无法识别的行只计入 `errorCount`。`encode` 反向生成 `name:value` 行。
- 输入字节 → `{waves:[{t,ch}...], image?, errorCount}`；处理粘包/半包；坏帧滑窗重同步。`index.mjs` 把 `waves.length`/`errorCount` 累计进 `state.feed`，经 `status()` 暴露为 `parsed/parseErrors/lastError`，面板据此在「字节在涨、解析 0 帧」时红字提示协议不匹配。
- Test: `test/protocol.test.mjs`（JSON 帧、custom 帧、zf 帧、text 键值行、半包/粘包、坏帧）。

## Task 5 – 宿主 `index.mjs`（工具 + API + 装配）
- 注入 `fs/web/sandboxPolicy/tools/webServer`。
- defineTool: `mcu_connect`/`mcu_disconnect`/`mcu_status`/`mcu_send`/`mcu_read_wave`/`mcu_capture_img`（含 output.schema + render）。
- webServer：`/seekfree-api/*` REST（config/connect/disconnect/send/status/poll/read-wave/capture-img）。
- 全局单连接管理（Transport + Protocol + Buffer 串联），onData→feed→buffer。
- Verify：load 不抛错，`/seekfree-api/poll` 无连接时返回就绪态。

## Task 6 – 浏览器面板 `lib/client.js`
- `__ModuleLoader__` 注册 `settings.section` 槽位 + React 面板。
- `ConnectionPanel`（选择界面：transport/host/port/protocol/通道，持久化默认值），`ScopeView`（Canvas 多通道，暂停/缩放/历史/通道显隐/Y 自适应），`ImageView`，`LogView`（hex/文本），`StatusBar`.
- 轮询 `/seekfree-api/poll`（~10Hz）拉新增数据 → 驱动示波器/图像/日志。
- 与 `settings.section` 注册失败时不致命（降级，仿 dlpath try/catch）。

## Task 7 – 激活与验证
- 把插件加进 `profiles/web/package.json`：dependencies `"dsh-zf-assistant": "link:F:/DeepSeek Harness/plugins/dsh-zf-assistant/package"`，`dsh.profile.bundles` 加入 `dsh-zf-assistant`。
- 重建受影响 web 产物，页面刷新后验证：面板出现、工具可调、connect→示波器更新。
- 临时用 TCP 模拟器脚本灌帧验证端到端：`node test/sim-text.mjs [端口]` 会以 50ms 周期喷 `L:…, R:…, Kp:…` 键值行，面板选 TCP Client + `text` 协议连 127.0.0.1:39501 即可看到波形。

## Risks / Retirement
- **协议选错的沉默失败**：字节在进、协议在丢时现在有 `parsed/parseErrors` 与面板红字提示兜底；新增协议务必同时更新 `status()` 的 feed 统计，别再让「零样本、零提示」复现。
- **slot 名**：MVP 用已确认的 `settings.section`；将来可用更高阶视图槽位替换。
- **serial**：已实现（`lib/serial.mjs` + `bridge/serial-bridge.ps1`，依赖 PowerShell 的 `System.IO.Ports`）。
- **Retirement**：模拟器脚本 `test/sim-tcp.mjs` 属临时，验证后可删；协议配置默认值保留为插件文档。
