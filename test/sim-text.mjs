// 本地模拟器：用真实 TCP 流灌「单片机 printf 键值行」，用来验证 text 协议与面板显示。
// 用法：node test/sim-text.mjs [端口=39501]
// 然后在「设置 → 设备调试」选 WiFi 通信 / TCP Client / 127.0.0.1 / 该端口 / 协议「文本键值行」，点连接。
import net from 'node:net'

const PORT = Number(process.argv[2] || 39501)
const server = net.createServer((sock) => {
  console.log('[sim] client connected')
  let n = 0
  const timer = setInterval(() => {
    n++
    const line = `L:${n % 50}, R:${n % 40}, GL:${113 + (n % 7)}, GR:${127 - (n % 5)}, Kp:13.0, Ki:0.9, Kd:0.0, ch:${(1.2 + (n % 3) * 0.1).toFixed(1)}\r\n`
    sock.write(line)
  }, 50)
  sock.on('error', () => clearInterval(timer))
  sock.on('close', () => { clearInterval(timer); console.log('[sim] client closed') })
})
server.listen(PORT, '127.0.0.1', () => console.log('[sim] listening ' + PORT))
