// dsh-zf-assistant ── 工具输出契约测试（node --test）
//
// 复现宿主成功路径上的校验：dsh-tools 的 ToolRuntime.createSuccessResult 会对工具返回值跑
//   validateJsonSchemaValue(tool.output.schema, detached, "value")
// 返回值里多一个未声明字段、或出现 null / NaN / Infinity，都会抛 ToolOutputError，
// 现象是工具调用直接失败并回报 "tool output invalid: ... is not a declared property"。
//
// 覆盖：七个 mcu_* 工具的失败分支 + 一条 TCP 环回全链路（连接→收帧→状态/波形/图像/下发）。
import test from 'node:test'
import assert from 'node:assert'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { apply } from '../index.mjs'
import { createTransport } from '../lib/transport.mjs'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 用假 ctx 挂载插件，取到真实的工具定义（不启动 webServer 注入）──
const registered = new Map()
apply({
  tools: {
    register(tool) {
      registered.set(tool.name, tool)
      return () => registered.delete(tool.name)
    },
  },
  effect: (fn) => fn(),
  inject: () => {},
})

const violationsOf = (tool, value) => validateJsonSchemaValue(tool.output.schema, value, 'value')

// 调用工具，并按宿主的方式校验它的返回值
async function call(name, args) {
  const tool = registered.get(name)
  assert.ok(tool, '未注册工具：' + name)
  const value = await tool.execute(args || {})
  assert.deepEqual(violationsOf(tool, value), [], name + ' 返回值违反 output.schema')
  return value
}

test('七个工具都注册了，且都声明了 output.schema', () => {
  for (const name of ['mcu_connect', 'mcu_disconnect', 'mcu_status', 'mcu_send', 'mcu_read_wave', 'mcu_capture_img', 'mcu_list_ports']) {
    assert.ok(registered.has(name), '缺少工具：' + name)
    assert.ok(registered.get(name).output.schema, name + ' 没有 output.schema')
  }
})

test('反向对照：修复前的 status() 原样返回会被判违规（防止空跑通过）', () => {
  // 旧实现 execute() 直接 return status()，其中 transport/protocol/channelCount/remote/stats/config
  // 都不在 schema 声明里 —— 校验器必须能把这个形状挑出来。
  const legacy = { status: 'idle', transport: null, protocol: null, channelCount: 0, remote: null, stats: {}, config: null }
  assert.ok(violationsOf(registered.get('mcu_status'), legacy).length > 0, '校验器没有拦住未声明字段')
})

test('未连接状态：状态/波形/图像/发送/断开输出合规', async () => {
  const s = await call('mcu_status')
  assert.equal(s.ok, true)
  assert.equal(s.status, 'idle')
  assert.equal(s.transport, '-')
  assert.equal(s.channelCount, 0)
  assert.equal(s.remote, '')
  assert.equal(s.hasImage, false)

  const w = await call('mcu_read_wave')
  assert.equal(w.samples, 0)
  assert.deepEqual(w.wave, [])
  assert.deepEqual(w.metrics, [], 'metrics 必须是数组（修复前空缓冲返回 {}，类型不符）')

  const img = await call('mcu_capture_img')
  assert.equal(img.ok, true)
  assert.equal(img.image, undefined, '无图像时不带 image 字段（null 不满足 object 类型）')

  const sent = await call('mcu_send', { text: 'x' })
  assert.equal(sent.ok, false)
  assert.ok(sent.reason.length > 0)

  const off = await call('mcu_disconnect')
  assert.equal(off.ok, true)
})

test('mcu_connect：缺参数被参数校验拦下，连不上时回 {ok:false,message}', async () => {
  // defineTool 先校验 parameters（transport / protocol 必填），缺失时抛 ToolArgsError，不进入 execute
  await assert.rejects(() => registered.get('mcu_connect').execute({}), /missing required property/)

  // 真实失败分支：连一个没人监听的端口 → ECONNREFUSED → 工具回 {ok:false, message}
  const r = await call('mcu_connect', { transport: 'tcp-client', host: '127.0.0.1', port: 1, protocol: 'json' })
  assert.equal(r.ok, false)
  assert.ok(r.message.length > 0)
})

test('mcu_list_ports 输出合规（真实调用一次串口枚举）', async () => {
  const r = await call('mcu_list_ports')
  assert.equal(typeof r.ok, 'boolean')
  assert.ok(Array.isArray(r.ports))
})

test('TCP 环回：连接 → 收帧 → 状态/波形/图像/下发全部合规', async () => {
  // 随机挑一个本机高端口，占用则重试（tcp-server 监听 0 端口时拿不到端口号，
  // 而工具返回值里不含监听端口，所以这里显式指定端口）
  let port = 0
  let res = null
  for (let i = 0; i < 5 && !res; i++) {
    const candidate = 42000 + Math.floor(Math.random() * 2000)
    const r = await call('mcu_connect', { transport: 'tcp-server', protocol: 'json', channelCount: 2, port: candidate })
    if (r.ok) { port = candidate; res = r }
  }
  assert.ok(res, '本机端口未能监听')
  assert.ok(res.message.length > 0, 'connect 成功分支要带 message')

  const client = createTransport('tcp-client')
  try {
    await client.connect({ host: '127.0.0.1', port })
    await wait(60)
    client.send(Buffer.from(
      '{"t":1,"ch":[1,2]}\n' +
      '{"t":2,"ch":[3,4]}\n' +
      '{"type":"image","width":2,"height":2,"data":"AA==","contentType":"image/jpeg"}\n'
    ))
    await wait(150)

    const st = await call('mcu_status')
    assert.equal(st.status, 'connected')
    assert.equal(st.transport, 'tcp-server')
    assert.equal(st.protocol, 'json')
    assert.equal(st.channelCount, 2)
    assert.ok(st.samples >= 2, '采样已进缓冲，实际 ' + st.samples)
    assert.equal(st.hasImage, true)
    assert.ok(st.remote.includes(':'), 'remote 是 host:port 文本，实际 ' + JSON.stringify(st.remote))

    const w = await call('mcu_read_wave', { range: 10 })
    assert.equal(w.samples, 2)
    assert.equal(w.metrics.length, 2)
    assert.equal(w.metrics[0].min, 1)
    assert.equal(w.metrics[0].max, 3)
    assert.equal(w.metrics[0].last, 3)
    assert.equal(w.metrics[1].last, 4)

    const img = await call('mcu_capture_img')
    assert.ok(img.image, '应拿到最新一帧图像')
    assert.equal(img.image.width, 2)
    assert.equal(img.image.height, 2)

    const sent = await call('mcu_send', { text: 'go' })
    assert.equal(sent.ok, true)
    assert.equal(sent.bytes, 2)
    assert.equal(sent.reason, '')

    const off = await call('mcu_disconnect')
    assert.equal(off.ok, true)
  } finally {
    client.disconnect()
    await call('mcu_disconnect')
  }
})
