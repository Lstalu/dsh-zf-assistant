// dsh-zf-assistant ── 数据环形缓冲（波形 / 图像 / 原始字节）
// 波形用环形队列，图像只保留最新帧，原始字节做滚动窗口。
// 供 Agent 工具读取（mcu_read_wave / mcu_capture_img）与面板可视化。

export class DataBuffer {
  constructor(opts = {}) {
    this.maxSamples = opts.maxSamples || 10000
    this.maxBytes = opts.maxBytes || 1 << 20 // 1MB 滚动窗口
    this.ring = [] // { t, ch: number[] }
    this.image = null // { width, height, dataBase64, contentType }
    this.bytes = [] // 原始字节滚动窗口
    this.totalSamples = 0
    this.totalBytes = 0
    this.droppedSamples = 0
  }

  // 记录一帧波形：ch 为各通道值数组（如 [1.0, 2.0, ...]）
  pushSample(t, ch) {
    const frame = { t, ch: Array.isArray(ch) ? ch.slice() : [] }
    this.ring.push(frame)
    this.totalSamples += 1
    if (this.ring.length > this.maxSamples) {
      this.ring.shift()
      this.droppedSamples += 1
    }
    return frame
  }

  // 记录一帧图像（仅保留最新）
  setImage(frame) {
    if (frame && typeof frame === 'object') {
      this.image = {
        width: frame.width || 0,
        height: frame.height || 0,
        dataBase64: frame.dataBase64 || frame.data || '',
        contentType: frame.contentType || 'image/jpeg',
      }
    } else {
      this.image = null
    }
    return this.image
  }

  // 记录原始字节（滚动窗口）
  pushBytes(buf) {
    if (!buf || !buf.length) return
    this.totalBytes += buf.length
    for (let i = 0; i < buf.length; i++) this.bytes.push(buf[i])
    while (this.bytes.length > this.maxBytes) this.bytes.shift()
  }

  // 取最近窗口的波形：range=样本数（默认全部），channels=只取指定通道
  window(range, channels) {
    const n = Math.min(this.ring.length, range && range > 0 ? range : this.ring.length)
    const start = this.ring.length - n
    const pick = (frame) => {
      if (!channels || !channels.length) return { t: frame.t, ch: frame.ch }
      const ch = {}
      for (const c of channels) {
        if (typeof c === 'number' && c >= 0 && c < frame.ch.length) ch[c] = frame.ch[c]
        else if (typeof c === 'string' && Number.isFinite(Number(c))) {
          const idx = Number(c)
          if (idx >= 0 && idx < frame.ch.length) ch[idx] = frame.ch[idx]
        }
      }
      return { t: frame.t, ch }
    }
    const out = []
    for (let i = start; i < this.ring.length; i++) out.push(pick(this.ring[i]))
    return out
  }

  getImage() {
    return this.image
  }

  // 原始字节（可选读最近 n 字节）
  bytesWindow(n) {
    const take = n && n > 0 ? n : this.bytes.length
    return this.bytes.slice(Math.max(0, this.bytes.length - take))
  }

  stats() {
    return {
      totalSamples: this.totalSamples,
      totalBytes: this.totalBytes,
      droppedSamples: this.droppedSamples,
      samplesInRing: this.ring.length,
      hasImage: !!this.image,
    }
  }

  clear() {
    this.ring = []
    this.image = null
    this.bytes = []
    this.totalSamples = 0
    this.totalBytes = 0
    this.droppedSamples = 0
  }
}
