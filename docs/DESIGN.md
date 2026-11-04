# dsh-zf-assistant 设计规格（Design Spec）

> 目标：让 DeepSeek Harness（DSH）像逐飞助手一样，能与单片机建立联系（WiFi / 串口），收发并分析数据，提供示波器 / 图像 / 原始数据视图，并支持 AI 自动化调参闭环。
> 插件包名：`dsh-zf-assistant`（ZF = 逐飞）。宿主侧 `index.mjs` + 浏览器侧 `lib/client.js`。

---

## 1. 目标与非目标

### 1.1 目标（本规格覆盖的范围）
- 把逐飞助手核心能力嵌入 DSH，做成一个**可选传输通道 + 可选协议 + 可视化**的通用调试上位机插件。
- 传输通道可切：**WiFi/TCP Server、WiFi/TCP Client、WiFi/UDP**（P1 主推 TCP）；**串口** 作为 P3 预留接口。
- 协议可切：**逐飞助手协议（字节待核，见 §7）**、**自定义二进制帧**、**JSON/文本**。
- 视图：**多通道实时示波器**、**摄像头图像显示**、**hex/原始/文本日志**。
- **AI 自动调参闭环**：Agent 读实时数据 → 分析 → 下发参数 → 观察响应，可重复执行。

### 1.2 非目标（明确不做，避免范围膨胀）
- 不做逐飞助手 100% GUI 像素级复刻；只做数据通信 + 可视化 + AI 调参这一核心价值面。
- 不做跨设备固件烧录 / 调试器（JTAG/SWD/OpenOCD）集成。
- 不做多设备同时管理的复杂拓扑（单连接优先，多连接为后续增强）。
- 串口原生模块（`serialport`）P1/P2 不打包进宿主，P3 再决策（见 §7.4）。

---

## 2. 需求与意图（TaskIntent 摘要）

- **用户场景**：嵌入式开发者/智能车参赛者，把单片机（逐飞生态或自研）连上 DSH，边看波形边和 AI 对话，让 AI 帮分析波形、给出并下发调参建议。
- **成功证据**：
  1. 用户经「选择界面」连上 TCP/UDP 后，能在 DSH 面板看到**实时多通道示波器**。
  2. 单片机发来的图像帧能在面板**实时显示**。
  3. Agent 能用 `mcu_read_wave` 读到缓冲波形、用 `mcu_send` 下发参数。
- **停止条件**：连接、流式解帧、可视化、AI 读写四者都跑通且可演示。
- **非目标**：见 §1.2。
- **主要风险**：逐飞帧字节未逐字节核验（协议常量需实现时从源码核准）；Node 原生串口模块缺失（P3 决策）。

---

## 3. 架构总览

```
┌─ 宿主(index.mjs，运行于 DSH Electron/Node)───────────────────────────┐
│  defineTool: mcu_connect / mcu_disconnect / mcu_send / mcu_status     │
│               / mcu_read_wave / mcu_capture_img / mcu_list_ports(P3)   │
│  传输层(接口传输，可切):  TCP Server | TCP Client | UDP   (P3: Serial)  │
│                          └─ net / dgram（Node 内置，无原生依赖）        │
│  协议层(接口解码，与传输无关):  zf协议(待核) | 自定义二进制帧 | JSON      │
│  数据环形缓冲: 波形(时间×通道) + 图像帧 + 原始字节                        │
│  /seekfree-api/* JSON + /seekfree-stream websocket(或长轮询)           │
└─────────────────────────────────────────────────────────────────────┘
┌─ 浏览器(lib/client.js，注入 DSH 前端)────────────────────────────────┐
│  「设备调试」面板(经客户端 slots 注册):                                  │
│    选择界面: 通道(TCP Server/Client/UDP) + IP/端口 + 协议 + 波特率(P3)    │
│              + 示波器通道配置(通道数/颜色/缩放/单位)                      │
│    实时示波器(Canvas 多通道) | 图像显示 | hex/原始/文本日志               │
└─────────────────────────────────────────────────────────────────────┘
          ▲ Agent 用工具读写(自动调参闭环) ▲ 用户手动操作面板
```

关键解耦：**传输层 ↔ 协议层 ↔ 视图层** 之间只通过「原始字节流 + 已解码数据」交互，任一可独立替换。

---

## 4. 组件明细

### 4.1 宿主侧传输层（`Transport`）
接口（传输无关）：`connect(opts) / disconnect() / send(bytes) / onData(cb) / status()`。

| 实现 | 依赖 | 说明 |
| --- | --- | --- |
| `tcp-server` | Node `net` | 上位机 Listen，单片机 WiFi 模块（透传）作为 Client 连入（逐飞无线串口即此形态） |
| `tcp-client` | Node `net` | 上位机作为 Client 主动连单片机/服务器 |
| `udp` | Node `dgram` | 无连接、丢包容忍，适合高频丢包不敏感的波形 |
| `serial` (P3) | 待决策 | 原生模块 或 子进程桥接 或 PowerShell；P1/P2 不实现 |

统一生命周期：连接建立 → `onData` 回调把字节喂给协议层 → 断线/超时进入重连策略（可配置）。

### 4.2 宿主侧协议层（`Protocol`）
接口：`feed(bytes) -> {wave:[{ch, value}...], image:Frame?}`，有状态解析器，处理粘包/半包。

| 实现 | 形态 | 说明 |
| --- | --- | --- |
| `zf` | 逐飞帧 | 帧头+通道数据+校验/帧尾；字节常量需从逐飞源码核准（见 §7.1） |
| `custom-binary` | 自定义帧 | 用户配置帧头/长度字段/通道数/大小端/校验；面向通用场景 |
| `json` | 文本 | `{"ch0":..,"ch1":..}` 或带 `image` base64 的 JSON，最易调试与 AI 对接 |

协议选择由「选择界面」决定，同一时刻一个连接对应一个协议实例。

### 4.3 数据环形缓冲（`DataBuffer`）
- 波形：`Array<{t:number, ch:number[]}>`，按时间戳，环形上限（默认最近 N 帧，如 10_000 采样）。
- 图像：只保留最近一帧（候选最新帧），供 `mcu_capture_img` / 面板显示。
- 原始字节：最近 N 字节滚动，供 hex 视图。
- 供 Agent 工具读取：`mcu_read_wave` 返回最近窗口的波形数组（可加 `range`/`channels` 参数）；`mcu_capture_img` 返回当前图像帧。

### 4.4 宿主定义工具（`defineTool`，来自 `@deepseek-ai/dsh-tools`）
| 工具 | 入参(示例) | 说明 |
| --- | --- | --- |
| `mcu_connect` | `{transport, host, port, protocol, channels?}` | 建立连接并选协议/通道 |
| `mcu_disconnect` | - | 断开 |
| `mcu_status` | - | 连接/传输/协议/数据计数状态 |
| `mcu_send` | `{data?, channels?, values?}` | 下发数据（原始字节或按协议打包的通道值） |
| `mcu_read_wave` | `{range?, channels?}` | 读最近波形窗口 |
| `mcu_capture_img` | - | 取最新图像帧 |
| `mcu_list_ports` | - | (P3 串口) 枚举串口 |

每个工具带 `output.schema` 与 `render`（复用 dsh-dlpath 的 `defineTool` 用法）。

### 4.5 浏览器侧「设备调试」面板（客户端 slots）
- 通过 `window.__ModuleLoader__.load({id, factory})` 注册，挂到一个可用的客户端 slot（如侧边栏/视图 slot；具体 slot 名在实现时对准 dsh-client-ui-slots）。
- 子组件：
  - `ConnectionPanel`：选择界面（传输/IP/端口/协议/通道配置），默认值持久化到本地存储。
  - `ScopeView`：Canvas 多通道示波器，支持暂停/继续/缩放/滑块历史、通道显隐、Y 轴自适应。
  - `ImageView`：图像帧实时预览。
  - `LogView`：hex/原文/文本日志，按行着色。
  - `StatusBar`：连接状态、速率、丢帧。
- 与宿主通信：`/seekfree-api/*`（REST，配置与读写）+ `/seekfree-stream`（WebSocket 或 SSE/长轮询，实时推流波形/图像）。

---

## 5. 数据流与生命周期

1. **连接**：用户在面板选 `transport + protocol` → 面板或 Agent `mcu_connect` → 宿主建 Transport，实例化 Protocol。
2. **接收**：Transport `onData` → Protocol `feed()` 解码 → 写入 DataBuffer → 推送(WebSocket/轮询)到面板。
3. **可视化**：面板订阅流，ScopeView/ImageView 更新。
4. **AI 读取**：Agent `mcu_read_wave` / `mcu_capture_img` 拿最近数据。
5. **AI 下发**：Agent `mcu_send`（原始字节或按协议打包）→ Transport `send()` → 到单片机。
6. **观测迭代**：上述 4-5 循环 = 自动调参闭环。
7. **断开**：`mcu_disconnect` 或断线超时 → 重连策略（可配）或回到就绪态。

---

## 6. 逐飞无线串口通讯原理（已在设计中固化）

- 逐飞 `zf_device_wifi_uart` = 「串口 → WiFi 透明网桥」。单片机 UART 连模块，模块用 AT 配置为 TCP Client/透传，指向目标 IP:port。
- 透传态下：模块 UART 收到的每个字节原样经 TCP 发出；网口收到的字节原样灌回 UART。
- 结论：**逐飞无线串口在上位机侧就是一条 TCP 连接**。因此「传输层做成可插拔 + 协议层传输无关」即可同一套逻辑覆盖 WiFi 与串口。

---

## 7. 协议模块细节

### 7.1 逐飞协议（字节待核）
实现时需逐字节核准并落到 `protocol/zf.mjs` 常量（@todo，完成前标为「未核验」）：
- 帧头/帧尾、长度字段宽度与位置、通道数上限、每个通道的数据类型与字节宽（float32/int16 等）、大小端、校验算法（CRC/异或/求和）。
- 图像帧格式（灰度/RGB、宽高、打包方式）。
- **如果设计接口预留「自定义帧」与逐飞协议为同一解析器族**（仅是配置不同），则逐飞只是预填配置，天然通用。

### 7.2 自定义二进制帧
字段全部可配置：帧头序列、长度字段（宽度+位置+是否含自身）、各通道 `{id, type:uint16|int16|float32..., scale}`、大小端、校验（无/求和/CRC8/CRC16）。用 JSON schema 描述，选择界面能直接套用。

### 7.3 JSON 协议
`{"t":123.4,"ch":[1.0,2.0,...]}` 用于波形；`{"type":"image","width":w,"height":h,"data":"<base64>"}` 用于图像。最利于 AI 直接理解和调参。

### 7.4 串口（P3）决策
- 候选：A) 在 Electron 宿主打包 `serialport` 原生模块（ABI 匹配成本）；B) Node 子进程桥接（装依赖、管生命周期）；C) PowerShell `System.IO.Ports`（精度/速率受限）。
- P1/P2 不实现，只在传输层留出 `serial` 适配器接口（与 TCP/UDP 同接口）。

---

## 8. AI 自动调参闭环

- **能力**：Agent 读取最近波形/图像 → 结合用户目标（如稳态/超调/纹波）分析 → `mcu_send` 下发参数 → 再观测。
- **工具契约**：`mcu_read_wave` 返回结构化窗口（含时间与各通道数组），`mcu_send` 支持「按协议打包的通道值」或「原始字节」，二者都鼓励用，便于 AI 直接表达调参意图。
- **安全**：`mcu_send` 作为写操作，按 DSH 权限面走；不默认静默高频写入。

---

## 9. 错误处理与恢复

| 场景 | 处理 |
| --- | --- |
| TCP 连接失败/被拒 | `mcu_connect` 返回明确原因；面板状态栏红显重试 |
| 传输断线 | 标记 disconnected；可选自动重连（指数退避，可配）；Buffer 保留最近数据 |
| 协议解帧异常 | 容错滑窗（跳过坏帧重同步）；日志记录错误帧计数 |
| 无效配置 | 连接前校验 transport/host/port/protocol；非法则拒绝并提示 |
| 数据风暴 | 环形缓冲上限 + 下游节流（WebSocket 推送限频） |

---

## 10. 验证与测试

- **单元**：协议解析器（zf/custom/json）对已知字节序列的正确解码；粘包/半包边界；坏帧重同步。
- **集成**：本地 loopback TCP Server/Client 用脚本灌帧 → 断言 DataBuffer 与 `mcu_read_wave` 结果。
- **端到端人工**：连上一台真实/模拟单片机（或 TCP 模拟器），看示波器、图像、日志、AI 读写闭环。
- **激活验证**：插件加入 profile bundles 并重建 web 产物后，刷新页面确认面板与工具可用。

---

## 11. 激活 / 部署（DSH 插件装载机制，已确认）

插件 `package.json` 中 `dsh.bundle.patch: "./cordis.patch.yml"`；`cordis.patch.yml` 以 `insert` 注册插件 id。激活需：
1. 在 `profiles/web/package.json` `dependencies` 加 `"dsh-zf-assistant": "link:F:/DeepSeek Harness/plugins/dsh-zf-assistant/package"`。
2. 在 `dsh.profile.bundles` 数组加入 `"dsh-zf-assistant"`。
3. 属「改 app/web 壳 + 普通包」：需重建受影响的 Web 产物，并在页面刷新后验证现有 GUI URL。
> 激活更简单入口可能是插件管理器 / `dsh plugin` 命令；实现时优先复用该路径，减少手工 profile 编辑。

---

## 12. 分阶段边界

- **P1+P2（本次交付）**：TCP Server/Client/UDP + 逐飞(待核)/自定义/JSON 协议(至少一种可用) + 示波器 + 图像 + hex 日志 + 选择界面 + 工具层 + AI 读写。
- **P3（后续）**：串口桥接 + `mcu_list_ports` + 多连接拓扑 + 面板打磨（缩放/光标/导出）。
- **后续增强**：协议配置持久化、重连策略 UI、波形导出 PNG/CSV。

---

## 13. 设计审查备注

- **Existence Check（新增 surface）**：新增插件 `dsh-zf-assistant`（复用 DSH 现有插件框架与 tools/slots/webServer 机制，无重复 owner），决策：`add-with-proof`（有真实需求，无现成等价物；P1 具最小 owner，无额外持久化/公共契约）。
- **Product Risk Lens**：价值=嵌入式调试 + AI 调参一体化；非目标见 §1.2；权衡=通用可配置 vs 逐飞字节未核；决策=先按通用框架+内置 zf(待核) 配置做，逐飞字节核准后仅改常量。
- **ImpactStatement**：受影响层=新增 DSH 插件（宿主工具+客户端面板），不改现有宿主核心；不改变既有会话/持久化；兼容=仅在 profile bundles 增项，不破坏现网。
- **跨会话**：本规格落盘于插件 `docs/DESIGN.md`，可跨会话续做，进入实现前需用户审阅确认。

---

## 14. 待确认项（实现前置）

1. **逐飞帧字节**（头部/通道/校验/图像帧、大小端）——实现时读逐飞源码核准，核准前标「未核验」。
2. **面板 slot 名与 websocket 挂载方式**——实现时对准 dsh-client-ui-slots / dsh-client 实时通道实际接口。
3. **激活路径**——优先用插件管理器/命令，降级手工 profile 编辑 + 重建。
4. **JSON 图像帧编码**——base64 vs 分段流，按实际带宽选择。
