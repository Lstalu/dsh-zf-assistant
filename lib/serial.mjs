// dsh-zf-assistant ── 串口传输：spawn 常驻 pwsh 桥接进程（System.IO.Ports）
// 统一接口与 TCP/UDP 一致：connect / disconnect / send(bytes) / onData(cb) / status()
// 说明：宿主无原生 serialport，采用 PowerShell 桥接；真实硬件数据需连上 COM 口实测。
import { spawn, execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE = join(__dirname, '../bridge/serial-bridge.ps1')
const noop = () => {}

// 解析 PowerShell 可执行文件：优先 env ZF_POWERSHELL，Win32 默认 powershell.exe(5.1, 保证存在并含 System.IO.Ports)
function resolvePS() {
  if (process.env.ZF_POWERSHELL) return process.env.ZF_POWERSHELL
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
}

// 枚举可用 COM 口（以 GetPortNames 为准，再用 WMI 补「设备描述」）
export function listPorts() {
  return new Promise((resolve) => {
    const ps = resolvePS()
    execFile(ps, ['-NoProfile', '-Command', '[System.IO.Ports.SerialPort]::GetPortNames()'], { timeout: 8000 }, (err, stdout) => {
      if (err) { resolve({ ok: false, ports: [], descriptions: {}, error: String(err && err.message || err) }); return }
      const ports = String(stdout || '').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean)
      // GetPortNames 不含描述；USB 转串口(如 COM15)不在 WMI 列表里，所以只用来补描述，不能当主列表
      // 用 Get-PnpDevice（约 2s）而不是 Get-CimInstance（首次 13s，会被超时杀掉）
      // 注意：PowerShell 5.1 控制台默认按 OEM 代码页(GBK)输出，Node 按 UTF-8 解码会变乱码，
      //       必须在命令开头把 OutputEncoding 设成 UTF8，否则「蓝牙链接上的标准串行」会显示成一串方块
      const psDesc = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-PnpDevice -Class Ports -Status OK | Select-Object -ExpandProperty FriendlyName | ConvertTo-Json -Compress'
      execFile(ps, ['-NoProfile', '-Command', psDesc], { timeout: 15000 }, (err2, out2) => {
        const descriptions = {}
        if (!err2) {
          let arr = []
          try {
            const j = JSON.parse(String(out2 || '').trim() || 'null')
            arr = Array.isArray(j) ? j : (j ? [j] : [])
          } catch (e) { arr = [] }
          for (const name of arr) {
            const m = String(name || '').match(/^(.*?)\s*\((COM\d+)\)\s*$/)
            if (m) descriptions[m[2]] = m[1].trim()
          }
        }
        resolve({ ok: true, ports, descriptions })
      })
    })
  })
}

// 网卡别名 + 描述 -> 中文说明（本机地址下拉用）
// 顺序要紧：Wi-Fi Direct（Windows 移动热点）必须先于 Wireless 判断，否则会被当成普通无线网卡。
function labelOf(alias, desc, ip) {
  const a = String(alias || '')
  const d = String(desc || '')
  const all = a + ' ' + d
  if (/Wi-?Fi Direct/i.test(d) || /^192\.168\.137\./.test(String(ip || ''))) return '本机热点网络'
  if (/VMware|VMnet|VirtualBox|Hyper-V|vEthernet|Virtual Ethernet|TAP-Windows|TAP Adapter|QMTAP|Sangfor|OrayBox|aTrust/i.test(all)) return '虚拟网络'
  if (/Wireless|Wi-?Fi|WLAN|802\.11/i.test(d) || /^WLAN$|无线/i.test(a)) return '无线网络'
  if (/Bluetooth/i.test(d) || /蓝牙/i.test(a)) return '蓝牙网络'
  if (/Ethernet|GbE|PCIe/i.test(d) || /以太网/i.test(a)) return '有线网络'
  return '本机网络'
}

// 枚举本机 IPv4（「本机地址」下拉：0.0.0.0 / 127.0.0.1 / 各网卡）
export function listIps() {
  return new Promise((resolve) => {
    const ps = resolvePS()
    // 同 listPorts：先把控制台输出编码设成 UTF8，否则网卡名里的中文会变成乱码
    const cmd = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ad = @{}; Get-NetAdapter | ForEach-Object { $ad[[int]$_.ifIndex] = $_.InterfaceDescription }; Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { [pscustomobject]@{ IPAddress = $_.IPAddress; InterfaceAlias = $_.InterfaceAlias; InterfaceDescription = $ad[[int]$_.InterfaceIndex] } } | ConvertTo-Json -Compress'
    execFile(ps, ['-NoProfile', '-Command', cmd], { timeout: 20000 }, (err, stdout) => {
      const items = [
        { addr: '0.0.0.0', label: '所有地址都将开启侦听' },
        { addr: '127.0.0.1', label: '本地回环地址' }
      ]
      if (!err) {
        let arr = []
        try {
          const j = JSON.parse(String(stdout || '').trim() || 'null')
          arr = Array.isArray(j) ? j : (j ? [j] : [])
        } catch (e) { arr = [] }
        for (const x of arr) {
          const ip = String(x.IPAddress || '').trim()
          if (!ip || /^169\.254\./.test(ip) || ip === '127.0.0.1' || ip === '0.0.0.0') continue
          items.push({ addr: ip, label: labelOf(x.InterfaceAlias, x.InterfaceDescription, ip) })
        }
      }
      resolve({ ok: true, ips: items })
    })
  })
}

export class SerialTransport {
  constructor(opts = {}) {
    this.opts = opts
    this.state = 'idle'
    this.child = null
    this.lastError = null
    this.remote = null
    this._onData = noop
    this._onStatus = noop
    this._onError = noop
  }
  onData(cb) { this._onData = cb; return this }
  onStatus(cb) { this._onStatus = cb; return this }
  onError(cb) { this._onError = cb; return this }
  _set(state, extra) { this.state = state; this._onStatus({ state, ...extra }) }
  status() { return { state: this.state, remote: this.remote, lastError: this.lastError } }

  connect(opts = {}) {
    return new Promise((resolve, reject) => {
      const com = String(opts.com || opts.port || this.opts.com || this.opts.port || '')
      const baud = Number(opts.baud || this.opts.baud || 115200)
      const dataBits = Number(opts.dataBits || this.opts.dataBits || 8)
      const parity = String(opts.parity || this.opts.parity || 'None')
      const stopBits = String(opts.stopBits || this.opts.stopBits || 'One')
      const handshake = String(opts.handshake || this.opts.handshake || 'None')
      if (!com) { reject('缺少 COM 口（如 COM3）'); return }
      this._set('connecting', { port: com, baud, dataBits, parity, stopBits, handshake })
      let child
      try {
        child = spawn(resolvePS(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', BRIDGE, com, String(baud), String(dataBits), parity, stopBits, handshake], { stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (err) {
        this.lastError = String(err && err.message || err); this._set('error'); reject(this.lastError); return
      }
      this.child = child
      this.remote = { port: com, baud, dataBits, parity, stopBits, handshake }
      let opened = false
      let settled = false
      const succeed = () => { if (!settled) { settled = true; opened = true; this._set('connected', { port: com, baud, dataBits, parity, stopBits, handshake }); resolve({ state: 'connected', port: com, baud, dataBits, parity, stopBits, handshake }) } }
      child.stdout.on('data', (buf) => {
        if (!opened) succeed()
        this._onData(buf)
      })
      child.stderr.on('data', (d) => {
        const s = String(d).trim()
        if (/ZF-READY/.test(s)) { succeed() }
        else if (s && !/ZF-READY/.test(s)) { this.lastError = s; this._onError(s) }
      })
      child.on('error', (err) => { if (!settled) { settled = true; this.lastError = String(err && err.message || err); this._set('error'); reject(this.lastError) } })
      child.on('exit', (code) => {
        this._set('closed', { code })
        if (!settled) { settled = true; reject('串口桥接退出(exit ' + code + ') ' + (this.lastError || '')) }
      })
      // 安全兜底：桥接既未就绪也未退出时，超时判定失败（避免挂死）
      setTimeout(() => {
        if (!settled) { settled = true; this._set('error'); reject('串口桥接在时限内未就绪: ' + (this.lastError || '')) }
      }, 20000)
    })
  }

  send(bytes) {
    if (!this.child || this.state !== 'connected') return { ok: false, reason: '串口未连接' }
    try { this.child.stdin.write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)); return { ok: true } }
    catch (err) { return { ok: false, reason: String(err && err.message || err) } }
  }

  disconnect() {
    if (this.child) { try { this.child.kill() } catch (e) {} this.child = null }
    this._set('closed')
    return { ok: true }
  }
}
