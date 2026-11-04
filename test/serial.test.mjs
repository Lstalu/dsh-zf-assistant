// dsh-zf-assistant ── 串口模块可测部分（node --test）
import test from 'node:test'
import assert from 'node:assert'
import { createTransport } from '../lib/transport.mjs'
import { listPorts } from '../lib/serial.mjs'

test('createTransport(serial) 构造出串口传输', () => {
  const t = createTransport('serial')
  assert.ok(t)
  assert.equal(typeof t.connect, 'function')
  assert.equal(typeof t.send, 'function')
  assert.equal(typeof t.onData, 'function')
})

test('mcu_list_ports 底层枚举 COM 口', async () => {
  const r = await listPorts()
  assert.equal(r.ok, true)
  assert.ok(Array.isArray(r.ports))
  // 本机至少有 COM 口（枚举到即证明 PowerShell System.IO.Ports 可用）
  console.log('ports:', r.ports.join(', '))
})
