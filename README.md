# dsh-zf-assistant

让 DeepSeek Harness（DSH）像逐飞助手一样与单片机建立联系：经 **WiFi(TCP/UDP)** 收发数据，按可配置协议解析成多通道波形 / 摄像头图像，实时显示，并支持 **AI 自动化调参**（Agent 读数据→分析→下发）。

## 功能
- **传输**（可选）：`tcp-server`（本机监听，单片机 WiFi 模块连入）、`tcp-client`（主动连）、`udp`、`serial`（串口桥接，经 PowerShell `System.IO.Ports`，需 COM 口 + 波特率）。
- **协议**（可选）：`json`（推荐，含图像）、`custom`（自定义二进制帧）、`zf`（逐飞 0xAA 示波器帧）、`text`（单片机 printf 的键值行，如 `L:0, R:0, Kp:13.0`）。
- **视图**（浏览器「设置 → 设备调试」面板）：选择界面 + 实时多通道示波器 + 图像显示 + 日志。
- **AI 工具**：`mcu_connect / mcu_disconnect / mcu_status / mcu_send / mcu_read_wave（含每通道 min/max/mean/std/last 指标）/ mcu_capture_img / mcu_list_ports`。

## 快速开始
1. 确保插件已被 DSH web profile 加载（`profiles/web` 的 `dsh.profile.bundles` 含 `dsh-zf-assistant`，并重建/刷新 web 产物）。
2. 打开「设置 → 设备调试」，选连接方式与协议，点「连接」。
3. 单片机侧：用逐飞 `zf_device_wifi_uart` 或任意 WiFi 透传模块，把目标设为本机 IP:监听端口，TCP 连入即可；或选「串口」选 COM 口与波特率直连。

> 串口桥接需要 PowerShell（`powershell.exe`，可用环境变量 `ZF_POWERSHELL` 覆盖为 `pwsh`）；真实串口数据需连上单片机 COM 口实测。

## JSON 协议示例（单片机上行）
```text
{"ch":[1.0,2.0,3.0]}\n            # 波形，各通道值
{"type":"image","width":320,"height":240,"data":"<base64>"}\n   # 图像帧
```

## 自定义二进制帧
在 `mcu_connect` 的 `frame` 参数配置：
```json
{
  "header":[0xAA,0x55],
  "frameLength":7,
  "channels":[{"offset":0,"type":"u16"},{"offset":2,"type":"s16"}],
  "endian":"little",
  "checksum":"sum8"
}
```

## 写入协议（下发通道值时选择哪种编码）
面板「设置→设备调试」顶部有 **写入协议** 下拉：`跟随接收`（用当前协议 encode）/ `JSON`（发一行 `{"ch":[...]}`）/ `二进制帧`（按帧配置打包）。`mcu_send` 的 `format` 参数对应 `follow|json|binary`。

## 文本键值行（text）
单片机用 `printf` 打印一行 `name:value, name:value\r\n` 就能直接出示波器，不必改二进制帧：

```text
L:0, R:0, GL:113, GR:127, Kp:13.0, Ki:0.9, Kd:0.0, ch:1.2
```

- 面板选协议「文本键值行」后，会多出一行 **字段顺序**（默认 `L,R,GL,GR,Kp,Ki,Kd,ch`），它就是示波器通道的顺序与名称；`mcu_connect` 对应参数是 `fields`。
- 不填 `fields` 时按字段首次出现的顺序自动建通道；某行缺字段则沿用上一次的值，曲线不断档。
- `name=value` 与 `name:value` 都认，支持负数、小数、科学计数。无法识别的行只计入解析失败数，不影响后续行。

## 收到字节却不出波形？
`mcu_status` 与面板状态行都会显示 **解析帧数 / 失败次数**。若「字节在涨、解析 0 帧」，说明协议和数据格式不匹配（例如设备在 printf 键值行，而协议选成了 `zf`），面板会直接红字提示并把 `text` 作为建议。

## 逐飞协议（已从 STC32G144K 开源库 seekfree_assistant.c/.h 核准）
- **上行示波器帧**（单片机→PC）：`[0xAA, 0x10|通道数, 和校验, 长度, float大端×通道数]`。选协议 `zf` 时插件按此解析，示波器出波形。
- **下行参数帧**（PC→单片机，即下发调参）：`[0x55, 0x20, 通道号(1-based), 和校验, float大端4B]`。选协议 `zf` + 写入 `跟随接收/二进制帧` 时，`mcu_send`/参数调试面板按此下发，`0x55` 帧头 + `0x20` 参数功能。

### 通道→参数映射（king_project Motor.c，下发调参时请把「通道」设为 7）
| 通道 | 参数 |
|---|---|
| 0 | 左轮 Kp |
| 1 | 左轮 Ki |
| 2 | 左轮 Kd |
| 3 | 右轮 Kp |
| 4 | 右轮 Ki |
| 5 | 右轮 Kd |
| 6 | 目标速度 |
| 7 | 暂未用 |

参数调试面板与示波器通道按钮会显示这些名称（`cfg.channelNames`，可在面板「通道」数设为 7 后看到全部）。

## 开发
```
node --test            # 协议与传输集成测试
```
