// dsh-zf-assistant ── 协议解析单元测试（node --test）
import test from 'node:test'
import assert from 'node:assert'
import { createProtocol } from '../lib/protocol.mjs'
import { DataBuffer } from '../lib/buffer.mjs'

test('JSON 协议：解析波形行（粘包多行）', () => {
  const p = createProtocol('json')
  const r = p.feed(Buffer.from('{"t":1,"ch":[1,2]}\n{"t":2,"ch":[3,4]}\n'))
  assert.equal(r.waves.length, 2)
  assert.deepEqual(r.waves[0].ch, [1, 2])
  assert.deepEqual(r.waves[1].ch, [3, 4])
})

test('JSON 协议：半包残留到下一帧', () => {
  const p = createProtocol('json')
  const r1 = p.feed(Buffer.from('{"t":1,"ch":[1,2]}'))
  assert.equal(r1.waves.length, 0)
  const r2 = p.feed(Buffer.from('\n{"t":2,"ch":[3,4]}\n'))
  assert.equal(r2.waves.length, 2)
})

test('JSON 协议：图像帧', () => {
  const p = createProtocol('json')
  const r = p.feed(Buffer.from('{"type":"image","width":10,"height":8,"data":"AAAA"}\n'))
  assert.ok(r.image)
  assert.equal(r.image.width, 10)
  assert.equal(r.image.dataBase64, 'AAAA')
})

test('自定义二进制帧：定长帧解析', () => {
  const frame = {
    header: [0xaa, 0x55],
    frameLength: 7,
    channels: [{ offset: 0, type: 'u16' }, { offset: 2, type: 's16' }],
    endian: 'little',
    checksum: 'sum8',
  }
  const p = createProtocol('custom', { frame })
  // 构造一帧：AA 55 + u16(258=0x0102) + s16(-2=0xFFFE) + checksum
  const body = [0x02, 0x01, 0xfe, 0xff]
  const sum = (0xaa + 0x55 + 0x02 + 0x01 + 0xfe + 0xff) & 0xff
  const frameBytes = Buffer.from([0xaa, 0x55, ...body, sum])
  const r = p.feed(frameBytes)
  assert.equal(r.waves.length, 1)
  assert.equal(r.waves[0].ch[0], 258)
  assert.equal(r.waves[0].ch[1], -2)
})

test('自定义二进制帧：半包（分两次）', () => {
  const frame = { header: [0xaa, 0x55], frameLength: 4, channels: [{ offset: 0, type: 'u8' }], checksum: 'none' }
  const p = createProtocol('custom', { frame })
  const r1 = p.feed(Buffer.from([0xaa, 0x55]))
  assert.equal(r1.waves.length, 0)
  const r2 = p.feed(Buffer.from([0x07, 0x00]))
  assert.equal(r2.waves.length, 1)
  assert.equal(r2.waves[0].ch[0], 7)
})

test('自定义二进制帧：坏帧重同步', () => {
  const frame = { header: [0xaa, 0x55], frameLength: 4, channels: [{ offset: 0, type: 'u8' }], checksum: 'none' }
  const p = createProtocol('custom', { frame })
  // 垃圾 + 一帧
  const r = p.feed(Buffer.from([0x01, 0x02, 0xaa, 0x55, 0x09, 0x99, 0xaa, 0x55, 0x0a, 0x00]))
  assert.equal(r.waves.length, 2)
  assert.equal(r.waves[0].ch[0], 9)
  assert.equal(r.waves[1].ch[0], 10)
})

test('逐飞协议：解析 0xAA 示波器帧（2通道，大端float）', () => {
  const p = createProtocol('zf')
  // 构造：[0xAA, 0x10|2=0x12, checkSum, length=4+2*4=12, floatBE(1.0), floatBE(2.0)]
  const b = Buffer.alloc(12); b[0] = 0xaa; b[1] = 0x12; b[3] = 12
  b.writeFloatBE(1.0, 4); b.writeFloatBE(2.0, 8)
  let sum = 0; for (let i = 0; i < 12; i++) { if (i === 2) continue; sum = (sum + b[i]) & 0xff }
  b[2] = sum
  const r = p.feed(b)
  assert.equal(r.waves.length, 1)
  assert.equal(r.waves[0].ch[0], 1)
  assert.equal(r.waves[0].ch[1], 2)
})

test('逐飞协议：encode 生成 0x55 参数帧（通道1based + 大端float + 和校验）', () => {
  const p = createProtocol('zf')
  const buf = p.encode([0, 1], [100.5, 200.25])
  assert.equal(buf.length, 16) // 两帧，每帧8字节
  assert.equal(buf[0], 0x55) // RECEIVE_HEAD
  assert.equal(buf[1], 0x20) // RECEIVE_SET_PARAMETER
  assert.equal(buf[2], 0x01) // 通道0 → 1based=1
  const f1 = buf.slice(0, 8)
  const check = (0x55 + 0x20 + 0x01 + f1[4] + f1[5] + f1[6] + f1[7]) & 0xff
  assert.equal(f1[3], check) // 和校验
  assert.equal(Buffer.from(f1.slice(4, 8)).readFloatBE(0), 100.5) // 大端float
  assert.equal(buf[8 + 2], 0x02) // 通道1 → 1based=2
})

test('DataBuffer：窗口与通道过滤', () => {
  const b = new DataBuffer({ maxSamples: 3 })
  for (let i = 0; i < 5; i++) b.pushSample(i, [i, i * 10])
  assert.equal(b.ring.length, 3) // 环形保留最近 3
  const w = b.window(10, [1])
  assert.equal(w.length, 3)
  // 通道过滤 1：值为 i*10 → 最后 3 个为 20,30,40
  assert.equal(w[0].ch[1], 20)
})

test('JSON encode：通道值→一行 JSON', () => {
  const p = createProtocol('json')
  const buf = p.encode([0, 1], [5, 6])
  const s = buf.toString('utf8').trim()
  const obj = JSON.parse(s)
  assert.deepEqual(obj.ch, [5, 6])
})

// ---- text（文本键值行）----
test('text 协议：按 fields 顺序解析 printf 键值行', () => {
  const p = createProtocol('text', { fields: ['L', 'R', 'GL', 'GR', 'Kp', 'Ki', 'Kd', 'ch'] })
  const r = p.feed(Buffer.from('L:0, R:0, GL:113, GR:127, Kp:13.0, Ki:0.9, Kd:0.0, ch:1.2\r\n'))
  assert.equal(r.errorCount, 0)
  assert.equal(r.waves.length, 1)
  assert.deepEqual(r.waves[0].ch, [0, 0, 113, 127, 13, 0.9, 0, 1.2])
  assert.deepEqual(p.fieldNames(), ['L', 'R', 'GL', 'GR', 'Kp', 'Ki', 'Kd', 'ch'])
})

test('text 协议：不配 fields 时按首次出现顺序建通道', () => {
  const p = createProtocol('text')
  const r = p.feed(Buffer.from('A:1, B:2\nB:3, C:4\n'))
  assert.equal(r.waves.length, 2)
  assert.deepEqual(p.fieldNames(), ['A', 'B', 'C'])
  // 第二行没有 A → 沿用上一次的值 1，曲线不断档
  assert.deepEqual(r.waves[1].ch, [1, 3, 4])
  assert.equal(p.channelCount, 3)
})

test('text 协议：无法识别的行只累计 errorCount，不影响后续行', () => {
  const p = createProtocol('text', { fields: ['Kp'] })
  const r = p.feed(Buffer.from('boot ok, 初始化完成\nKp:55\n'))
  assert.equal(r.errorCount, 1)
  assert.equal(r.waves.length, 1)
  assert.deepEqual(r.waves[0].ch, [55])
})

test('text 协议：半包残留到下一帧（粘包/分片）', () => {
  const p = createProtocol('text', { fields: ['x', 'y'] })
  assert.equal(p.feed(Buffer.from('x:1, y:')).waves.length, 0)
  const r = p.feed(Buffer.from('2\r\nx:3, y:4\r\n'))
  assert.equal(r.waves.length, 2)
  assert.deepEqual(r.waves[0].ch, [1, 2])
  assert.deepEqual(r.waves[1].ch, [3, 4])
})

test('text 协议：encode 生成 name:value 行', () => {
  const p = createProtocol('text', { fields: ['Kp', 'Ki'] })
  assert.equal(p.encode([0, 1], [55, 4.2]).toString('utf8'), 'Kp:55, Ki:4.2\r\n')
})
