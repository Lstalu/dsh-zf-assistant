// dsh-zf-assistant ── 协议层（JSON / 自定义二进制帧 / 逐飞[已核准]）
// 输入字节流 → 输出事件 { waves: [{t,ch}], image: Frame|null, errorCount }
// 处理粘包/半包；二进制帧坏帧滑窗重同步。协议与传输无关，可独立替换。
export function createProtocol(type, config = {}) {
  switch (type) {
    case 'json': return new JsonProtocol(config)
    case 'custom': return new BinaryProtocol(config)
    case 'zf': return new SeekfreeProtocol(config)
    case 'text': return new TextProtocol(config)
    default: throw new Error('unknown protocol: ' + type)
  }
}

// ---------------- JSON 协议 ----------------
class JsonProtocol {
  constructor(config = {}) { this.type = 'json'; this.buf = ''; this.channelCount = config.channelCount || 0 }
  feed(buf) {
    this.buf += Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)
    const waves = []
    let image = null
    let errorCount = 0
    const lines = this.buf.split('\n')
    this.buf = lines.pop() // 残留在下一帧
    for (const line of lines) {
      const s = line.trim()
      if (!s) continue
      let obj
      try { obj = JSON.parse(s) } catch (e) { errorCount++; continue }
      if (obj && Array.isArray(obj.ch)) {
        const t = typeof obj.t === 'number' ? obj.t : Date.now()
        waves.push({ t, ch: obj.ch.map((v) => typeof v === 'number' ? v : Number(v)) })
      } else if (obj && obj.type === 'image') {
        image = { width: obj.width || 0, height: obj.height || 0, dataBase64: obj.data || '', contentType: obj.contentType || 'image/jpeg' }
      } else if (obj && typeof obj === 'object' && this.channelCount) {
        // 兼容 {"ch0":..,"ch1":..}
        const ch = []
        for (let i = 0; i < this.channelCount; i++) ch.push(Number(obj['ch' + i]) || 0)
        if (ch.some((v) => Number.isFinite(v))) waves.push({ t: Date.now(), ch })
      }
    }
    return { waves, image, errorCount }
  }
  // 将通道值编码为一行 JSON（供 mcu_send）
  encode(channels, values) {
    const ch = values || []
    return Buffer.from(JSON.stringify({ t: Date.now(), ch }) + '\n', 'utf8')
  }
}

// ---------------- 自定义/逐飞二进制帧（定长帧） ----------------
class BinaryProtocol {
  constructor(config = {}) {
    this.type = config.type || 'custom'
    this.frame = config.frame || {}
    // 帧配置
    this.header = asBytes(this.frame.header)
    this.frameLength = Number(this.frame.frameLength || 0) // 整帧字节数
    this.channels = Array.isArray(this.frame.channels) ? this.frame.channels : []
    this.endian = this.frame.endian === 'big' ? 'big' : 'little'
    this.checksum = this.frame.checksum || 'none'
    this.footer = asBytes(this.frame.footer)
    this.channelCount = this.channels.length || this.frame.channelCount || 0
    this.buf = [] // 字节数组（8bit）
  }
  feed(buf) {
    const waves = []
    let image = null
    let errorCount = 0
    for (const b of Buffer.isBuffer(buf) ? buf : Buffer.from(buf)) this.buf.push(b)
    while (true) {
      const idx = this._findHeader(this.buf)
      if (idx < 0) {
        // 无帧头：滑窗保留最后 header.length 个字节（可能是半帧头）
        this._trimToHeaderTail()
        break
      }
      if (idx > 0) this.buf.splice(0, idx)
      if (!this.frameLength || this.buf.length < this.frameLength) break // 等整帧
      const frame = this.buf.slice(0, this.frameLength)
      this.buf.splice(0, this.frameLength)
      const parsed = this._parseFrame(frame)
      if (parsed.ok) {
        if (parsed.image) image = parsed.image
        else waves.push(parsed.sample)
      } else {
        errorCount++
        // 坏帧：丢掉帧头首字节重同步
        this.buf.splice(0, 1)
      }
    }
    return { waves, image, errorCount }
  }
  _findHeader(arr) {
    const h = this.header
    if (!h || !h.length) return -2
    for (let i = 0; i <= arr.length - h.length; i++) {
      let m = true
      for (let j = 0; j < h.length; j++) if (arr[i + j] !== h[j]) { m = false; break }
      if (m) return i
    }
    return -1
  }
  _trimToHeaderTail() {
    const h = this.header
    const keep = h && h.length ? h.length - 1 : 0
    while (this.buf.length > keep) this.buf.shift()
  }
  _parseFrame(frame) {
    const h = this.header ? this.header.length : 0
    const f = this.footer ? this.footer.length : 0
    // 校验（对 header + payload 区）
    if (this.checksum && this.checksum !== 'none') {
      const calc = computeChecksum(frame.slice(0, frame.length - (f || (this.checksum ? 1 : 0))), this.checksum)
      const expect = frame[frame.length - 1 - (f || 0)]
      // 若配置了 footer，校验字节在 footer 之前；未配置则在帧末
      if (calc !== expect) return { ok: false }
    }
    // footer 校验
    if (f) {
      for (let i = 0; i < f; i++) if (frame[frame.length - f + i] !== this.footer[i]) return { ok: false }
    }
    // 解析通道
    const ch = []
    let isImage = false
    let imageFrame = null
    for (const c of this.channels) {
      const off = h + Number(c.offset || 0)
      const v = readValue(frame, off, c.type || 'u16', this.endian)
      if (v == null) continue
      const scaled = typeof c.scale === 'number' ? v * c.scale : v
      ch.push(scaled)
    }
    // 图像帧支持：若配置了 imageOffset/imageWidth/imageHeight/dataType
    if (this.frame.image && this.channels.length === 0) {
      imageFrame = parseImage(frame, this.frame.image, h)
      if (imageFrame) isImage = true
    }
    return { ok: true, image: imageFrame, sample: { t: Date.now(), ch } }
  }
  // 用帧配置反向编码一帧（供 mcu_send 下发通道值）
  encode(channels, values) {
    const f = this.frame
    const header = this.header
    const hlen = header ? header.length : 0
    const fLen = Number(f.frameLength || 0)
    if (!fLen) return Buffer.from([])
    const frame = Buffer.alloc(fLen)
    for (let i = 0; i < hlen; i++) if (i < fLen) frame[i] = header[i]
    const val = Array.isArray(values) ? values : []
    for (let i = 0; i < this.channels.length; i++) {
      const c = this.channels[i]
      const off = hlen + Number(c.offset || 0)
      const v = Number(val[i] || 0)
      if (off + sizeOf(c.type || 'u16') <= fLen) writeValue(frame, off, c.type || 'u16', v, this.endian)
    }
    const footer = this.footer
    const flen = footer ? footer.length : 0
    const checksumLen = this.checksum && this.checksum !== 'none' ? 1 : 0
    const csEnd = fLen - flen - checksumLen
    if (checksumLen) {
      const calc = computeChecksum(Array.from(frame.slice(0, csEnd)), this.checksum)
      frame[fLen - flen - 1] = calc
    }
    if (flen) for (let i = 0; i < flen; i++) frame[fLen - flen + i] = footer[i]
    return frame
  }
}

function writeValue(frame, off, type, value, endian) {
  const e = endian === 'big'
  switch (type) {
    case 'u8': frame.writeUInt8(value & 0xff, off); break
    case 's8': frame.writeInt8(value, off); break
    case 'u16': e ? frame.writeUInt16BE(value, off) : frame.writeUInt16LE(value, off); break
    case 's16': e ? frame.writeInt16BE(value, off) : frame.writeInt16LE(value, off); break
    case 'u32': e ? frame.writeUInt32BE(value, off) : frame.writeUInt32LE(value, off); break
    case 'f32': e ? frame.writeFloatBE(value, off) : frame.writeFloatLE(value, off); break
    default: break
  }
}

// 逐飞协议（已从 STC32G144K 开源库 seekfree_assistant.c/.h 核准）：
//   下行参数帧(PC→单片机): [0x55, 0x20, channel(1based), 和校验, float大端4B]
//   上行示波器帧(单片机→PC): [0xAA, 0x10|通道数, 校验, 长度, float大端×通道数]
class SeekfreeProtocol {
  constructor(config = {}) {
    this.type = 'zf'
    this.buf = [] // 字节暂存
    this.SEND_HEAD = 0xaa
    this.RECEIVE_HEAD = 0x55
    this.FUNC_SET_PARAM = 0x20
    this.FUNC_OSC = 0x10
    this.MAX_CH = 8
  }
  feed(buf) {
    const waves = []
    let image = null
    let errorCount = 0
    for (const b of Buffer.isBuffer(buf) ? buf : Buffer.from(buf)) this.buf.push(b)
    while (true) {
      // 找 0xAA 帧头
      let idx = -1
      for (let i = 0; i < this.buf.length; i++) if (this.buf[i] === this.SEND_HEAD) { idx = i; break }
      if (idx < 0) { if (this.buf.length > 1) this.buf.splice(0, this.buf.length - 1); break }
      if (idx > 0) this.buf.splice(0, idx)
      if (this.buf.length < 4) break // 等头+功能+校验+长度
      const channelByte = this.buf[1]
      const n = channelByte & 0x0f // 通道数
      const frameTotal = 4 + n * 4
      if (this.buf.length < frameTotal) break // 等整帧
      const frame = this.buf.slice(0, frameTotal)
      this.buf.splice(0, frameTotal)
      const checkSum = frame[2]
      const lengthByte = frame[3]
      const dat = frame.slice(4, frameTotal)
      // 校验 = head + channelByte + length + dat
      let s = (this.SEND_HEAD + channelByte + lengthByte) & 0xff
      for (const b of dat) s = (s + b) & 0xff
      const valid = (lengthByte === frameTotal) && (s === checkSum)
      if (valid) {
        const ch = []
        for (let c = 0; c < n; c++) ch.push(readFloatBE(dat, c * 4))
        waves.push({ t: Date.now(), ch })
      } else {
        errorCount++
        this.buf.splice(0, 1) // 坏帧丢1字节重同步
      }
    }
    return { waves, image, errorCount }
  }
  // 编码下行参数帧（每个通道一帧）
  encode(channels, values) {
    const ch = Array.isArray(channels) ? channels : []
    const vals = Array.isArray(values) ? values : []
    const out = []
    for (let i = 0; i < ch.length; i++) {
      const chanIdx = typeof ch[i] === 'number' ? ch[i] : i
      const v = Number(vals[i] || 0)
      const frame = buildParamFrame(this, chanIdx, v)
      out.push(...frame)
    }
    return Buffer.from(out)
  }
}

function readFloatBE(arr, off) {
  const b = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) { const x = arr[off + i]; if (x == null) return 0; b[i] = x }
  return b.readFloatBE(0)
}
function floatBE(v) {
  const b = Buffer.alloc(4)
  b.writeFloatBE(v, 0)
  return Array.from(b)
}
// [0x55, 0x20, channel+1, sum, floatBE]
function buildParamFrame(proto, chanIdx, value) {
  const channel = (chanIdx + 1) & 0xff // 1-based
  const dat = floatBE(value)
  let sum = (proto.RECEIVE_HEAD + proto.FUNC_SET_PARAM + channel) & 0xff
  for (const b of dat) sum = (sum + b) & 0xff
  return [proto.RECEIVE_HEAD, proto.FUNC_SET_PARAM, channel, sum, ...dat]
}

// ---------------- 工具函数 ----------------
function asBytes(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return Array.from(Buffer.from(v, 'latin1'))
  if (typeof v === 'number') return Buffer.from([v])
  return []
}

function readValue(frame, off, type, endian) {
  if (off < 0 || off + sizeOf(type) > frame.length) return null
  const b = Buffer.from(frame)
  const e = endian === 'big'
  switch (type) {
    case 'u8': return b.readUInt8(off)
    case 's8': return b.readInt8(off)
    case 'u16': return e ? b.readUInt16BE(off) : b.readUInt16LE(off)
    case 's16': return e ? b.readInt16BE(off) : b.readInt16LE(off)
    case 'u32': return e ? b.readUInt32BE(off) : b.readUInt32LE(off)
    case 'f32': return e ? b.readFloatBE(off) : b.readFloatLE(off)
    default: return null
  }
}
function sizeOf(type) {
  switch (type) { case 'u8': case 's8': return 1; case 'u16': case 's16': return 2; case 'u32': case 'f32': return 4; default: return 0 }
}
function computeChecksum(bytes, kind) {
  let s = 0
  if (kind === 'xor8') { for (const b of bytes) s ^= b; return s & 0xff }
  // sum8 / crc8(kind=sum8 简化)
  for (const b of bytes) s = (s + b) & 0xff
  return s & 0xff
}
function parseImage(frame, cfg, headerLen) {
  try {
    const dataOff = headerLen + Number(cfg.offset || 0)
    const width = Number(cfg.width || 0)
    const height = Number(cfg.height || 0)
    const dataType = cfg.dataType || 'jpeg'
    let dataBase64 = ''
    if (cfg.encoding === 'base64') {
      dataBase64 = Buffer.from(frame.slice(dataOff)).toString('base64')
    } else {
      // 原始像素 bytes（灰度/或打包）→ 用 canvas 侧按 width/height/dataType 渲染
      dataBase64 = Buffer.from(frame.slice(dataOff)).toString('base64')
    }
    return { width, height, dataBase64, contentType: dataType === 'jpeg' ? 'image/jpeg' : dataType === 'gray' ? 'image/gray' : 'application/octet-stream' }
  } catch (err) { return null }
}

// ---------------- 文本（键值行）协议 ----------------
// 适用于单片机 printf 出来的单行数据，例如：
//   L:0, R:0, GL:113, GR:113, Kp:55.0, Ki:4.2, Kd:1.3, ch:0.3\r\n
// 配置 fields（推荐）：['L','R','GL','GR','Kp','Ki','Kd','ch']，决定通道顺序与名称。
// 不配 fields 时按首次出现的顺序自动建立通道；缺字段的帧沿用上一次的值（保持曲线连续）。
class TextProtocol {
  constructor(config = {}) {
    this.type = 'text'
    this.buf = ''
    this.fields = Array.isArray(config.fields) && config.fields.length
      ? config.fields.map((f) => String(f).trim()).filter(Boolean)
      : null
    this.names = this.fields ? this.fields.slice() : []
    this.channelCount = this.names.length
    this.last = new Map()   // 各字段最近一次的值
  }
  feed(buf) {
    const waves = []
    let errorCount = 0
    this.buf += Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)
    let nl
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      const s = line.replace(/\r$/, '').trim()
      if (!s) continue
      const pairs = parseTextPairs(s)
      if (!pairs.length) { errorCount++; continue }
      for (const p of pairs) this.last.set(p.k, p.v)
      if (!this.fields) {
        for (const p of pairs) if (this.names.indexOf(p.k) < 0) this.names.push(p.k)
        this.channelCount = this.names.length
      }
      const ch = this.names.map((n) => {
        const v = this.last.get(n)
        return typeof v === 'number' ? v : 0
      })
      waves.push({ t: Date.now(), ch })
    }
    if (this.buf.length > 8192) this.buf = this.buf.slice(-4096) // 无换行的异常流防爆
    return { waves, image: null, errorCount }
  }
  // 文本下发：按通道顺序拼成 "name:value, name:value\r\n"
  encode(channels, values) {
    const vals = Array.isArray(values) ? values : []
    const idx = Array.isArray(channels) && channels.length ? channels : vals.map((_, i) => i)
    const parts = []
    for (let i = 0; i < idx.length; i++) {
      const n = this.names[idx[i]] || ('ch' + idx[i])
      const v = Number(vals[i])
      if (Number.isFinite(v)) parts.push(n + ':' + v)
    }
    return Buffer.from(parts.join(', ') + '\r\n', 'utf8')
  }
  fieldNames() { return this.names.slice() }
}

// 从一行里抠出 name:number 或 name=number（兼容负号、小数、科学计数）
const TEXT_PAIR_RE = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
function parseTextPairs(line) {
  const out = []
  TEXT_PAIR_RE.lastIndex = 0
  let m
  while ((m = TEXT_PAIR_RE.exec(line)) !== null) {
    const v = Number(m[2])
    if (Number.isFinite(v)) out.push({ k: m[1], v })
  }
  return out
}
