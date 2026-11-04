// dsh-zf-assistant ── 集成测试：TCP loopback 灌帧 → 协议解析（node --test）
import test from 'node:test'
import assert from 'node:assert'
import { createTransport } from '../lib/transport.mjs'
import { createProtocol } from '../lib/protocol.mjs'
import { DataBuffer } from '../lib/buffer.mjs'

function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

test('TCP Server <-> Client：字节流 → 协议解帧 → 缓冲', async () => {
  const server = createTransport('tcp-server')
  const client = createTransport('tcp-client')
  const buffer = new DataBuffer()
  const protocol = createProtocol('json', { channelCount: 2 })
  let recv = null
  server.onData((buf) => {
    const r = protocol.feed(buf)
    for (const w of r.waves) buffer.pushSample(w.t, w.ch)
    recv = r
  })

  const srv = await server.connect({ port: 0 })
  assert.ok(srv.port > 0, 'server got a port')
  await client.connect({ host: '127.0.0.1', port: srv.port })
  await wait(50)
  assert.equal(server.status().state, 'connected', 'server sees client')

  client.send(Buffer.from('{"t":1,"ch":[11,22]}\n{"t":2,"ch":[33,44]}\n'))
  await wait(80)

  assert.ok(recv, 'server received something')
  assert.equal(buffer.ring.length, 2, 'two samples buffered')
  assert.deepEqual(buffer.ring[0].ch, [11, 22])
  assert.deepEqual(buffer.ring[1].ch, [33, 44])

  // 服务端下发回客户端
  let clientGot = null
  client.onData((buf) => { clientGot = buf })
  await wait(10)
  server.send(Buffer.from('ACK'))
  await wait(60)
  assert.ok(clientGot, 'client received from server')
  assert.equal(clientGot.toString('utf8'), 'ACK')

  server.disconnect()
  client.disconnect()
})
