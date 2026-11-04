// dsh-zf-assistant ── 传输层（TCP Server / TCP Client / UDP）
// 统一接口：connect(opts) / disconnect() / send(bytes) / onData(cb) / onStatus(cb) / status()
// 逐飞「无线串口」= TCP 透传，所以上位机开 TCP Server 收单片机 WiFi 模块连入即为其形态。
import net from 'node:net'
import dgram from 'node:dgram'
import { SerialTransport } from './serial.mjs'

const noop = () => {}

export function createTransport(type, opts = {}) {
  switch (type) {
    case 'tcp-server': return new TcpServerTransport(opts)
    case 'tcp-client': return new TcpClientTransport(opts)
    case 'udp': return new UdpTransport(opts)
    case 'serial': return new SerialTransport(opts)
    default: throw new Error('unknown transport: ' + type)
  }
}

class BaseTransport {
  constructor() {
    this.state = 'idle'
    this._onData = noop
    this._onStatus = noop
    this._onError = noop
    this.lastError = null
    this.remote = null
  }
  onData(cb) { this._onData = cb; return this }
  onStatus(cb) { this._onStatus = cb; return this }
  onError(cb) { this._onError = cb; return this }
  _set(state, extra) { this.state = state; this._onStatus({ state, ...extra }) }
  status() {
    return { state: this.state, remote: this.remote, lastError: this.lastError }
  }
}

class TcpServerTransport extends BaseTransport {
  constructor(opts = {}) { super(); this.opts = opts }
  connect(opts = {}) {
    return new Promise((resolve, reject) => {
      const port = Number(opts.port || this.opts.port || 0)
      this._set('listening', { port })
      try {
        const server = net.createServer((socket) => {
          this.remote = { host: socket.remoteAddress, port: socket.remotePort }
          this._socketRef = socket
          this._set('connected', { remote: this.remote })
          socket.on('data', (buf) => this._onData(buf, this.remote))
          socket.on('error', (err) => { this.lastError = String(err && err.message || err); this._onError(this.lastError) })
          socket.on('close', () => { if (this.state === 'connected') this._set('closed') })
        })
        this._server = server
        server.on('error', (err) => { this.lastError = String(err && err.message || err); this._set('error'); reject(this.lastError) })
        server.listen(port, () => {
          const addr = server.address()
          this.port = addr ? addr.port : port
          resolve({ state: 'listening', port: this.port })
        })
      } catch (err) { this.lastError = String(err && err.message || err); reject(this.lastError) }
    })
  }
  send(bytes) {
    if (this.state !== 'connected' || !this._socketRef) return { ok: false, reason: '未连接（无客户端）' }
    try { this._socketRef.write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)); return { ok: true } }
    catch (err) { return { ok: false, reason: String(err && err.message || err) } }
  }
  disconnect() {
    if (this._server) { try { this._server.close() } catch (e) {} this._server = null }
    if (this._socketRef) { try { this._socketRef.destroy() } catch (e) {} this._socketRef = null }
    this._set('closed')
    return { ok: true }
  }
}

class TcpClientTransport extends BaseTransport {
  constructor(opts = {}) { super(); this.opts = opts }
  connect(opts = {}) {
    return new Promise((resolve, reject) => {
      const host = String(opts.host || this.opts.host || '127.0.0.1')
      const port = Number(opts.port || this.opts.port || 0)
      if (!port) { reject('missing port'); return }
      this._set('connecting', { host, port })
      const socket = net.createConnection({ host, port })
      this._socket = socket
      socket.setNoDelay(true)
      socket.on('connect', () => {
        this.remote = { host, port }
        this._set('connected', { remote: this.remote })
        resolve({ state: 'connected', remote: this.remote })
      })
      socket.on('data', (buf) => this._onData(buf, this.remote))
      socket.on('error', (err) => { this.lastError = String(err && err.message || err); this._set('error'); reject(this.lastError) })
      socket.on('close', () => { if (this.state === 'connected') this._set('closed') })
    })
  }
  send(bytes) { return this._writeSocket(bytes) }
  _writeSocket(bytes) {
    if (this.state !== 'connected' || !this._socket) return { ok: false, reason: '未连接' }
    try { this._socket.write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)); return { ok: true } }
    catch (err) { return { ok: false, reason: String(err && err.message || err) } }
  }
  disconnect() {
    if (this._socket) { try { this._socket.destroy() } catch (e) {} this._socket = null }
    this._set('closed')
    return { ok: true }
  }
}

class UdpTransport extends BaseTransport {
  constructor(opts = {}) { super(); this.opts = opts }
  connect(opts = {}) {
    return new Promise((resolve, reject) => {
      const port = Number(opts.port || this.opts.port || 0)
      // remoteHost/remotePort 表达 UDP 发送目标；port 为本地绑定端口
      const remoteHost = opts.remoteHost || this.opts.remoteHost || null
      const remotePort = opts.remotePort ? Number(opts.remotePort) : null
      const socket = dgram.createSocket('udp4')
      this._socket = socket
      this.remote = remoteHost ? { host: remoteHost, port: remotePort } : null
      socket.on('message', (msg, rinfo) => {
        if (!this.remote) this.remote = { host: rinfo.address, port: rinfo.port }
        this._onData(msg, this.remote)
      })
      socket.on('error', (err) => { this.lastError = String(err && err.message || err); this._set('error'); reject(this.lastError) })
      socket.on('listening', () => {
        const addr = socket.address()
        this.port = addr.port
        this._set('connected', { port: addr.port })
        resolve({ state: 'connected', port: addr.port })
      })
      // 本地绑定端口；0 = 随机
      socket.bind(port)
    })
  }
  send(bytes) {
    if (!this._socket) return { ok: false, reason: '未绑定' }
    const target = this.remote || (this.opts.remoteHost ? { host: this.opts.remoteHost, port: this.opts.remotePort } : null)
    if (!target || !target.port) return { ok: false, reason: '缺少远程目标' }
    try {
      this._socket.send(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), target.port, target.host || '127.0.0.1')
      return { ok: true }
    } catch (err) { return { ok: false, reason: String(err && err.message || err) } }
  }
  disconnect() {
    if (this._socket) { try { this._socket.close() } catch (e) {} this._socket = null }
    this._set('closed')
    return { ok: true }
  }
}
