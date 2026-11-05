// dsh-zf-assistant ── 宿主半体：通信 + 数据缓冲 + AGENT 工具 + /seekfree-api/* 接口
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createTransport } from './lib/transport.mjs'
import { createProtocol } from './lib/protocol.mjs'
import { DataBuffer } from './lib/buffer.mjs'
import { listPorts, listIps } from './lib/serial.mjs'

const name = 'zf-assistant'
const inject = ['web', 'sandboxPolicy', 'tools']

// ---------- 单连接状态（插件级单例） ----------
const state = {
  transport: null,
  protocol: null,
  buffer: new DataBuffer(),
  config: null,
  status: 'idle', // idle|connecting|listening|connected|error|closed
  recvLog: [], // [{t, hex, text, len}] 控制台按换行拼接后的接收记录
  lineBytes: [], // 未换行前的字节暂存（按 \n / \r\n 拼行）
  sendCount: 0,
  // 协议层可观测性：收到字节 ≠ 解析出样本。字节在涨而 parsed 不涨，就说明协议不匹配。
  feed: { parsed: 0, errors: 0, lastError: '' },
  // 前端示波器「加载数据」推上来的波形（只在内存，重启即失）：{ name, waves:[{t, ch:[]}], at }
  importedScope: null,
  createdAt: Date.now(),
}

function resetState(keepStream = false) {
  if (state.transport) { try { state.transport.disconnect() } catch (e) {} state.transport = null }
  state.protocol = null
  state.config = null
  state.status = 'idle'
  state.feed = { parsed: 0, errors: 0, lastError: '' }
  if (!keepStream) { state.buffer = new DataBuffer(); state.recvLog = []; state.lineBytes = []; state.sendCount = 0 }
}

function hexToBytes(hex) {
  const s = String(hex || '').trim().replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '')
  if (!s) return Buffer.alloc(0)
  const even = s.length % 2 === 0 ? s : '0' + s
  return Buffer.from(even, 'hex')
}

// ---------- 传输数据接入协议层 → 缓冲 ----------
function bytesToHex(buf) {
  let s = ''
  for (const b of buf) { const h = b.toString(16).toUpperCase(); if (h.length < 2) s += '0'; s += h }
  return s
}
function bytesToAscii(buf) {
  let s = ''
  for (const b of buf) s += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.'
  return s
}
function onBytes(buf) {
  state.buffer.pushBytes(buf)
  // 按 \n(0x0A) 把收到的字节拼成完整行，再写入控制台（避免逐字节断词换行）
  for (const b of buf) state.lineBytes.push(b)
  let idx
  while ((idx = state.lineBytes.indexOf(0x0a)) >= 0) {
    let lineBytes = state.lineBytes.slice(0, idx)
    state.lineBytes.splice(0, idx + 1)
    if (lineBytes.length && lineBytes[lineBytes.length - 1] === 0x0d) lineBytes.pop() // 去掉 \r
    state.recvLog.push({ t: Date.now(), hex: bytesToHex(lineBytes), text: bytesToAscii(lineBytes), len: lineBytes.length })
  }
  // 二进制/无换行流：过长仍未换行则先冲出一段，避免积压
  if (state.lineBytes.length > 512) {
    const overflow = state.lineBytes.splice(0)
    state.recvLog.push({ t: Date.now(), hex: bytesToHex(overflow), text: bytesToAscii(overflow), len: overflow.length })
  }
  while (state.recvLog.length > 200) state.recvLog.shift()
  if (!state.protocol) return
  try {
    const r = state.protocol.feed(buf)
    for (const w of r.waves) state.buffer.pushSample(w.t, w.ch)
    if (r.image) state.buffer.setImage(r.image)
    state.feed.parsed += r.waves.length
    if (r.errorCount) {
      state.feed.errors += r.errorCount
      state.feed.lastError = '协议 ' + (state.config && state.config.protocol) + ' 解析失败 ' + state.feed.errors + ' 次（收到 ' + state.buffer.stats().totalBytes + ' 字节 / 解析 ' + state.feed.parsed + ' 帧）'
      console.warn('[zf] protocol error count +' + r.errorCount)
    }
  } catch (err) {
    state.feed.errors += 1
    state.feed.lastError = '解析异常: ' + String(err && err.message || err)
    console.warn('[zf] feed failed: ' + String(err && err.message || err))
  }
}

// ---------- 建立连接 ----------
async function connect(cfg = {}) {
  if (!cfg.transport) return { ok: false, message: '未指定传输方式(tcp-server|tcp-client|udp)' }
  resetState(true)
  state.buffer = new DataBuffer()
  state.config = cfg
  const transport = createTransport(cfg.transport)
  state.transport = transport
  transport.onData((buf) => onBytes(buf))
  transport.onStatus((s) => { state.status = s.state || state.status })
  transport.onError((e) => { console.warn('[zf] transport error: ' + e) })

  const protocol = createProtocol(cfg.protocol || 'json', {
    channelCount: Number(cfg.channelCount || 0),
    frame: cfg.frame || undefined,
    fields: cfg.fields || undefined,
  })
  state.protocol = protocol

  try {
    const r = await transport.connect({
      host: cfg.host,
      port: cfg.port,
      com: cfg.com,
      baud: cfg.baud,
      dataBits: cfg.dataBits,
      parity: cfg.parity,
      stopBits: cfg.stopBits,
      handshake: cfg.handshake || cfg.flowControl,
      remoteHost: cfg.remoteHost,
      remotePort: cfg.remotePort,
    })
    state.status = r.state || state.status
    return { ok: true, message: '已连接: ' + (r.state || '') + (r.port ? ' :' + r.port : ''), status: status() }
  } catch (err) {
    resetState(true)
    return { ok: false, message: '连接失败: ' + String(err && err.message || err) }
  }
}

function disconnect() {
  if (state.transport) { try { state.transport.disconnect() } catch (e) {} }
  state.status = 'closed'
  return { ok: true, message: '已断开' }
}

const r3 = (x) => Math.round(Number(x) * 1000) / 1000

// 前端示波器「加载数据」推上来的波形摘要：每通道统计 + 可选抽样点
function scopeSummary(sample = 0) {
  const s = state.importedScope
  if (!s || !Array.isArray(s.waves) || !s.waves.length) {
    return { ok: false, message: '没有导入的波形：请在前端示波器点「加载数据」' }
  }
  const waves = s.waves
  const nCh = Math.max(1, ...waves.map((w) => (Array.isArray(w.ch) ? w.ch.length : 0)))
  const stats = []
  for (let k = 0; k < nCh; k++) {
    const ys = waves.map((w) => Number(w.ch && w.ch[k]) || 0)
    const n = ys.length
    const mean = ys.reduce((a, b) => a + b, 0) / n
    const varr = ys.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n
    let mn = Infinity, mx = -Infinity
    for (const v of ys) { if (v < mn) mn = v; if (v > mx) mx = v }
    stats.push({ ch: k, n, min: r3(mn), max: r3(mx), mean: r3(mean), std: r3(Math.sqrt(varr)), last: r3(ys[n - 1]) })
  }
  const out = { ok: true, name: s.name, at: s.at, points: waves.length, channels: nCh, stats }
  const n = Math.max(0, Math.min(2000, Number(sample) || 0))
  if (n > 0) out.sample = waves.slice(-n)
  return out
}

function status() {
  const t = state.transport ? state.transport.status() : null
  return {
    status: state.status || (t && t.state) || 'idle',
    transport: state.config ? state.config.transport : null,
    protocol: state.config ? state.config.protocol : null,
    channelCount: state.config ? Number(state.config.channelCount || (state.protocol && state.protocol.channelCount) || 0) : 0,
    fields: state.protocol && typeof state.protocol.fieldNames === 'function' ? state.protocol.fieldNames() : [],
    remote: t ? t.remote : null,
    stats: state.buffer.stats(),
    feed: { parsed: state.feed.parsed, errors: state.feed.errors, lastError: state.feed.lastError },
    config: state.config,
  }
}

// ---------- 下发数据 ----------
// 按写入格式编码通道值：follow(跟随接收协议) / json(强制JSON行) / binary(强制二进制帧)
function encodeForWrite(args, protocol) {
  const fmt = String(args.format || 'follow')
  const ch = args.channels || []
  const vals = args.values || []
  if (fmt === 'json') {
    const line = JSON.stringify({ t: Date.now(), ch: vals.map((v) => Number(v)) })
    return Buffer.from(line + '\n', 'utf8')
  }
  if (fmt === 'binary') {
    if (typeof protocol.encode === 'function' && protocol.type !== 'json') return protocol.encode(ch, vals)
    // json 协议无法出二进制帧：回退 JSON，但提示
    const line = JSON.stringify({ t: Date.now(), ch: vals.map((v) => Number(v)) })
    return Buffer.from(line + '\n', 'utf8')
  }
  // follow：用当前协议自己的 encode（json 出 JSON 行，binary 出二进制帧）
  return protocol.encode(ch, vals)
}

function send(args = {}) {
  if (!state.transport || (state.status !== 'connected' && state.status !== 'listening')) {
    return { ok: false, reason: '未连接（无法发送）' }
  }
  let bytes
  if (args.data != null) {
    const d = String(args.data).trim()
    bytes = /^[0-9a-fA-F ]+$/.test(d) && d.includes(' ') ? hexToBytes(d.replace(/ /g, '')) : hexToBytes(d)
    if (/[\x20-\x7e]/.test(d) && !/^[0-9a-fA-F\s]*$/.test(d)) bytes = Buffer.from(d, 'utf8')
  } else if (args.text != null) {
    bytes = Buffer.from(String(args.text), 'utf8')
  } else if (args.values != null && state.protocol && typeof state.protocol.encode === 'function') {
    bytes = encodeForWrite(args, state.protocol)
  } else {
    return { ok: false, reason: '请提供 data(hex) / text 或 channels+values' }
  }
  if (!bytes.length) return { ok: false, reason: '空数据' }
  state.buffer.pushBytes(bytes)
  state.sendCount += bytes.length
  const r = state.transport.send(bytes)
  if (!r.ok) return r
  return { ok: true, bytes: bytes.length, hex: bytesToHex(bytes), message: '已发送 ' + bytes.length + ' 字节' }
}

// ---------- 控制台数据（串口/网络调试视图用） ----------
function consoleDump(n = 100) {
  const recv = state.recvLog.slice(Math.max(0, state.recvLog.length - n))
  return {
    ok: true,
    recv,
    recvCount: state.recvLog.length,
    recvBytes: state.buffer.stats().totalBytes,
    sendCount: state.sendCount,
    status: status(),
  }
}

function readWave(args = {}) {
  const range = args.range ? Number(args.range) : null
  const channels = args.channels ? String(args.channels).split(/[, ]+/).filter(Boolean).map((s) => Number(s)) : null
  const win = state.buffer.window(range, channels)
  // AI 调参便捷：对每路通道计算统计指标（min/max/mean/std/last），便于 Agent 直接推断
  const metrics = computeMetrics(win)
  return { ok: true, samples: win.length, wave: win, metrics, stats: state.buffer.stats() }
}

function computeMetrics(win) {
  const nCh = win.length ? (Array.isArray(win[0].ch) ? win[0].ch.length : Object.keys(win[0].ch).length) : 0
  // 无通道时返回空数组：mcu_read_wave 的 output.schema 把 metrics 声明成 array，返回 {} 会被判类型不符
  if (!nCh) return []
  const per = []
  for (let c = 0; c < nCh; c++) {
    let min = Infinity, max = -Infinity, sum = 0, n = 0
    for (const w of win) {
      const v = Array.isArray(w.ch) ? w.ch[c] : w.ch[c]
      if (typeof v === 'number' && v === v) { if (v < min) min = v; if (v > max) max = v; sum += v; n++ }
    }
    if (n === 0) { per.push({ ch: c, n: 0 }); continue }
    const mean = sum / n
    let varSum = 0
    for (const w of win) { const v = Array.isArray(w.ch) ? w.ch[c] : w.ch[c]; if (typeof v === 'number' && v === v) varSum += (v - mean) * (v - mean) }
    const std = Math.sqrt(varSum / n)
    per.push({ ch: c, n, min, max, mean: round(mean), std: round(std), last: round(Array.isArray(win[win.length-1].ch) ? win[win.length-1].ch[c] : win[win.length-1].ch[c]) })
  }
  return per
}
// 非有限值一律回 null：NaN / Infinity 不是合法 JSON 值，会让工具输出校验直接失败（漏采通道最容易出 NaN）
function round(v) { return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null }

function captureImg() {
  return { ok: true, image: state.buffer.getImage() }
}

// ---------- 工具输出投影 ----------
// defineTool 的 output.schema 是 additionalProperties:false 的严格契约：宿主用 dsh-tools 的
// validateJsonSchemaValue 校验成功返回值，多一个未声明字段、或出现 null / NaN / Infinity，
// 整次调用都会报 "tool output invalid"。此处把内部状态投影成「只含已声明标量」的扁平结果；
// status()/send()/readWave() 的原样返回保持不变（/seekfree-api/* 面板还在消费那些字段）。
function remoteLabel(t) {
  if (!t) return ''
  if (t.host) return t.host + ':' + (t.port == null ? '' : t.port)
  if (t.port) return String(t.port) + (t.baud ? '@' + t.baud : '')
  return ''
}

function statusView() {
  const s = status()
  const st = s.stats || {}
  return {
    ok: true,
    status: s.status || 'idle',
    transport: s.transport || '-',
    protocol: s.protocol || '-',
    channelCount: s.channelCount || 0,
    remote: remoteLabel(s.remote),
    fields: Array.isArray(s.fields) ? s.fields : [],
    samples: st.totalSamples || 0,
    bytes: st.totalBytes || 0,
    parsed: (s.feed && s.feed.parsed) || 0,
    parseErrors: (s.feed && s.feed.errors) || 0,
    lastError: (s.feed && s.feed.lastError) || '',
    hasImage: !!st.hasImage,
    sendBytes: state.sendCount,
  }
}

function apply(ctx) {
  const tools = ctx.tools

  const makeTool = (t) => ctx.effect(() => tools.register(t))

  makeTool(defineTool({
    name: 'mcu_connect',
    description: '建立与单片机/WiFi 模块的连接。传输方式: tcp-server(本机监听, 单片机 WiFi 模块连入)/tcp-client(主动连)/udp/serial(串口桥接, 需 COM 口与波特率)。协议: json(推荐, 带图像)/custom(自定义二进制帧)/zf(逐飞协议, 解析0xAA示波器帧/下发0x55参数帧)/text(单片机 printf 出来的键值文本行, 如 "L:0, R:0, GL:113, Kp:55.0")。连接后数据会被解析进缓冲供示波器与 AI 读取。',
    parameters: {
      transport: { type: 'string', description: 'tcp-server | tcp-client | udp | serial', required: true },
      host: { type: 'string', description: 'tcp-client/udp 的远程 IP；tcp-server 可省略' },
      port: { type: 'number', description: '监听或连接端口(net)；serial 时为 COM 口名(如 3)' },
      com: { type: 'string', description: 'serial 的 COM 口名, 如 COM3' },
      baud: { type: 'number', description: 'serial 波特率, 默认 115200' },
      dataBits: { type: 'number', description: 'serial 数据位(5-8), 默认 8' },
      parity: { type: 'string', description: 'serial 校验位: None|Odd|Even|Mark|Space' },
      stopBits: { type: 'string', description: 'serial 停止位: One|OnePointFive|Two' },
      flowControl: { type: 'string', description: 'serial 流控: None|XOnXOff|RequestToSend|RequestToSendXOnXOff' },
      remoteHost: { type: 'string', description: 'udp 发送目标 IP' },
      remotePort: { type: 'number', description: 'udp 发送目标端口' },
      protocol: { type: 'string', description: 'json | custom | zf | text', required: true },
      channelCount: { type: 'number', description: '通道数(json 兼容 ch0..chN)' },
      fields: { type: 'array', items: { type: 'string' }, description: 'text 协议的字段名列表, 决定通道顺序与名称, 如 ["L","R","GL","GR","Kp","Ki","Kd","ch"]; 不填则按首次出现顺序自动建通道' },
      frame: { type: 'object', additionalProperties: true, description: 'custom/zf 的帧配置({header,frameLength,channels:[{offset,type,scale}],endian,checksum,footer})' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, message: { type: 'string' } } },
      render(args, value) { return [{ type: 'text', text: value.ok ? value.message : (value.message || '连接失败') }] },
    },
    // 只回传已声明字段：connect() 原样返回里的 status 对象留给 /seekfree-api/connect 面板用
    async execute(args) {
      const r = await connect(args || {})
      return { ok: !!r.ok, message: r.message || (r.ok ? '已连接' : '连接失败') }
    },
  }))

  makeTool(defineTool({
    name: 'mcu_disconnect',
    description: '断开当前连接。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, message: { type: 'string' } } },
      render(args, value) { return [{ type: 'text', text: value.message || '已断开' }] },
    },
    async execute() { return disconnect() },
  }))

  makeTool(defineTool({
    name: 'mcu_status',
    description: '查看当前连接与数据统计：状态、传输/协议、远端、缓冲统计。',
    parameters: {},
    output: {
      // 字段必须与 statusView() 的扁平返回逐一对应（严格契约，多一个未声明字段就整次失败）
      schema: { type: 'object', additionalProperties: false, properties: {
        ok: { type: 'boolean', required: true },
        status: { type: 'string', required: true },
        transport: { type: 'string' },
        protocol: { type: 'string' },
        channelCount: { type: 'number' },
        remote: { type: 'string' },
        samples: { type: 'number' },
        bytes: { type: 'number' },
        parsed: { type: 'number' },
        parseErrors: { type: 'number' },
        lastError: { type: 'string' },
        hasImage: { type: 'boolean' },
        sendBytes: { type: 'number' },
        fields: { type: 'array', items: { type: 'string' } },
      } },
      render(args, value) {
        const lines = ['状态: ' + value.status, '传输: ' + value.transport, '协议: ' + value.protocol, '通道: ' + value.channelCount]
        if (value.remote) lines.push('远端: ' + value.remote)
        if (Array.isArray(value.fields) && value.fields.length) lines.push('通道名: ' + value.fields.join(', '))
        lines.push('采样: ' + value.samples + ' 字节: ' + value.bytes + ' 图像: ' + (value.hasImage ? '有' : '无'))
        lines.push('解析: ' + value.parsed + ' 帧 / 失败 ' + value.parseErrors + ' 次')
        if (value.bytes > 0 && value.parsed === 0) {
          lines.push('⚠ 收到字节但 0 帧被解析：当前协议 ' + value.protocol + ' 与设备数据不匹配。')
          if (value.protocol !== 'text' && value.protocol !== 'json') lines.push('  若设备在 printf 键值行（如 "L:0, R:0, Kp:13.0"），把协议改成 text 并填 fields。')
        }
        if (value.lastError) lines.push('最近错误: ' + value.lastError)
        lines.push('下发: ' + value.sendBytes + ' 字节')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute() { return statusView() },
  }))

  makeTool(defineTool({
    name: 'mcu_send',
    description: '向下位机发送数据。可用 data(hex 字符串, 含空格也可)/text(文本)/channels+values(按写入协议打包通道值)。format 可选: follow(跟随接收协议)|json(强制一行JSON)|binary(强制二进制帧)。用于 AI 下发调参。',
    parameters: {
      data: { type: 'string', description: 'hex 字符串(可含空格)' },
      text: { type: 'string', description: '文本' },
      channels: { type: 'array', items: { type: 'number' }, description: '通道索引列表' },
      values: { type: 'array', items: { type: 'number' }, description: '对应通道值' },
      format: { type: 'string', description: '写入编码: follow|json|binary' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, bytes: { type: 'number' }, reason: { type: 'string' } } },
      render(args, value) { return [{ type: 'text', text: value.ok ? ('已发送 ' + value.bytes + ' 字节') : ('发送失败: ' + (value.reason || '')) }] },
    },
    async execute(args) {
      const r = send(args || {})
      return { ok: !!r.ok, bytes: r.bytes || 0, reason: r.reason || '' }
    },
  }))

  makeTool(defineTool({
    name: 'mcu_read_wave',
    description: '读取最近缓冲的波形数据（用于 AI 分析自动调参）。可选 range=样本数, channels=通道(用逗号分隔)。返回 {samples, wave:[{t,ch}], metrics:[{ch,n,min,max,mean,std,last}]}，其中 metrics 提供每路通道的 min/max/mean/std/last，便于 AI 快速判断稳定性/超调/纹波等。',
    parameters: {
      range: { type: 'number', description: '最近样本数(默认全部)' },
      channels: { type: 'string', description: '逗号分隔的通道索引, 如 "0,1"' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, samples: { type: 'number' }, wave: { type: 'array' }, metrics: { type: 'array' } } },
      render(args, value) {
        const metricStr = value.metrics ? value.metrics.map((m) => 'ch' + m.ch + ': min=' + m.min + ' max=' + m.max + ' mean=' + m.mean + ' std=' + m.std + ' last=' + m.last).join(' | ') : ''
        return [{ type: 'text', text: '读取到 ' + value.samples + ' 个样本' + (metricStr ? '\n' + metricStr : '') }] },
    },
    // stats 不随工具返回（未在 schema 声明）；面板走 /seekfree-api/read-wave 仍能拿到
    async execute(args) {
      const r = readWave(args || {})
      return { ok: true, samples: r.samples, wave: r.wave, metrics: r.metrics }
    },
  }))

  makeTool(defineTool({
    name: 'mcu_capture_img',
    description: '获取最新的一帧图像（若协议含图像）用于查看摄像头画面。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, image: { type: 'object', additionalProperties: true } } },
      render(args, value) { return [{ type: 'text', text: value.image ? ('图像 ' + value.image.width + 'x' + value.image.height + ' 已获取') : '暂无图像' }] },
    },
    // 无图像时不带 image 字段（null 不满足声明的 object 类型）
    async execute() {
      const image = state.buffer.getImage()
      return image ? { ok: true, image } : { ok: true }
    },
  }))

  makeTool(defineTool({
    name: 'mcu_list_ports',
    description: '枚举当前可用的串口（COM)列表（串口桥接用）。返回端口名数组。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, ports: { type: 'array' }, error: { type: 'string' } } },
      render(args, value) { return [{ type: 'text', text: value.ok ? ('可用串口: ' + (value.ports.length ? value.ports.join(', ') : '无') ) : ('枚举失败: ' + (value.error || '')) }] },
    },
    async execute() { return listPorts() },
  }))

  makeTool(defineTool({
    name: 'mcu_scope_read',
    description: '读取前端示波器「加载数据」导入的波形（CSV），返回每通道统计（min/max/mean/std/last）与可选抽样点，用于让助手分析同一份波形。未导入时返回 ok:false。',
    parameters: {
      sample: { type: 'number', description: '返回最近多少个采样点，0 表示只要统计（默认 0，最多 2000）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean', required: true } } },
      render(args, value) {
        if (!value || !value.ok) return [{ type: 'text', text: '未导入波形：' + ((value && value.message) || '') }]
        const lines = ['导入波形: ' + value.name + '  点数: ' + value.points + '  通道: ' + value.channels]
        for (const s of value.stats || []) {
          lines.push('ch' + s.ch + '  min ' + s.min + '  max ' + s.max + '  mean ' + s.mean + '  std ' + s.std + '  last ' + s.last)
        }
        if (Array.isArray(value.sample) && value.sample.length) {
          lines.push('', '最近 ' + value.sample.length + ' 个采样点（最多显示 20 行）:')
          const tail = value.sample.slice(-20)
          for (const w of tail) {
            const chs = Array.isArray(w.ch) ? w.ch.join(', ') : String(w.ch)
            lines.push('  t=' + w.t + '  [' + chs + ']')
          }
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) { return scopeSummary(Number((args && args.sample) || 0)) },
  }))

  // ---------- /seekfree-api/* REST + poll 流 ----------
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    const json = (res, obj) => {
      const t = JSON.stringify(obj)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(t)) })
      res.end(t)
    }
    const readBody = (req) => new Promise((resolve) => {
      let b = ''
      req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy() })
      req.on('end', () => resolve(b.trim() ? JSON.parse(b) : {}))
    })
    const route = (method, handler) => async (req, res) => {
      try {
        if ((req.method || 'GET').toUpperCase() !== method) { res.writeHead(405); res.end('method not allowed'); return }
        const args = method === 'POST' ? await readBody(req) : {}
        json(res, await handler(args, req))
      } catch (err) {
        json(res, { ok: false, message: String(err && err.message || err) })
      }
    }
    webServer.register({ kind: 'exact', path: '/seekfree-api/status', handler: route('GET', async () => status()) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/connect', handler: route('POST', async (a) => connect(a)) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/disconnect', handler: route('POST', async () => disconnect()) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/send', handler: route('POST', async (a) => send(a)) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/poll', handler: route('GET', async (a, req) => {
      const url = new URL(req.url, 'http://x')
      const n = Number(url.searchParams.get('n') || 500)
      return { ok: true, status: status(), waves: state.buffer.window(n), image: state.buffer.getImage() }
    }) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/read-wave', handler: route('GET', async (a, req) => {
      const url = new URL(req.url, 'http://x')
      return readWave({ range: url.searchParams.get('range'), channels: url.searchParams.get('channels') })
    }) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/capture-img', handler: route('GET', async () => captureImg()) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/list-ports', handler: route('GET', async () => listPorts()) })
  webServer.register({ kind: 'exact', path: '/seekfree-api/list-ips', handler: route('GET', async () => listIps()) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/console', handler: route('GET', async (a, req) => {
      const url = new URL(req.url, 'http://x')
      return consoleDump(Number(url.searchParams.get('n') || 100))
    }) })
    // 前端示波器「加载数据」把波形推上来，助手侧通过 mcu_scope_read 读同一份
    webServer.register({ kind: 'exact', path: '/seekfree-api/scope/import', handler: route('POST', async (a) => {
      const waves = Array.isArray(a && a.waves) ? a.waves : []
      if (!waves.length) return { ok: false, message: 'waves 为空' }
      state.importedScope = {
        name: String((a && a.name) || 'scope.csv'),
        waves,
        at: Date.now(),
      }
      return { ok: true, name: state.importedScope.name, count: waves.length }
    }) })
    webServer.register({ kind: 'exact', path: '/seekfree-api/scope/imported', handler: route('GET', async (a, req) => {
      const url = new URL(req.url, 'http://x')
      return scopeSummary(Number(url.searchParams.get('sample') || 0))
    }) })
  })

  console.log('[zf-assistant] ready (transport+protocol+api).')
}

export { apply, inject, name }
