/* global window, fetch, Blob, URL */
// dsh-zf-assistant ── 浏览器半体：「设备调试」面板（settings.section 槽位）
// 与宿主经 /seekfree-api/* 通信（同源轮询）。
window.__ModuleLoader__.load({
  id: "dsh-zf-assistant",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { useState, useEffect, useRef } = React;
    const h = React.createElement;

    const api = (path, body) =>
      fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined).then((r) => r.json());

    const KEY = "dsh-zf-assistant.config";
    const loadCfg = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch (e) { return {} } };
    const saveCfg = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)) } catch (e) {} };

    const S = {
      card: { display: "flex", flexDirection: "column", gap: 10, padding: "4px 0 16px", maxWidth: 960 },
      panel: { border: "1px solid #d4d8de", borderRadius: 8, padding: "10px 12px" },
      row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
      label: { fontSize: 12, color: "#66707a", marginBottom: 4 },
      input: { padding: "5px 9px", border: "1px solid #d4d8de", borderRadius: 6, background: "transparent", color: "inherit", fontFamily: "inherit", fontSize: 13, minWidth: 70 },
      sel: { padding: "5px 8px", border: "1px solid #d4d8de", borderRadius: 6, background: "transparent", color: "inherit", fontFamily: "inherit", fontSize: 13 },
      btn: { padding: "5px 12px", border: "1px solid #d4d8de", borderRadius: 6, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 13 },
      btnPrimary: { padding: "6px 14px", border: "1px solid #3b82f6", borderRadius: 6, background: "#3b82f6", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 },
      tab: { flex: 1, padding: "8px 10px", border: "1px solid transparent", borderRadius: 6, background: "transparent", cursor: "pointer", fontSize: 13, color: "#66707a" },
      tabActive: { flex: 1, padding: "8px 10px", border: "1px solid #3b82f6", borderRadius: 6, background: "#eff6ff", cursor: "pointer", fontSize: 13, color: "#1d4ed8", fontWeight: 600 },
      mute: { color: "#66707a", fontSize: 12 },
    };
    const CH_COLORS = ["#38bdf8", "#f472b6", "#4ade80", "#fbbf24", "#a78bfa", "#fb7185", "#34d399", "#60a5fa"];

    const hexToStr = (hex) => { const s = String(hex || ""); const o = []; for (let i = 0; i + 1 < s.length; i += 2) o.push(parseInt(s.slice(i, i + 2), 16).toString(16).padStart(2, "0").toUpperCase()); return o.join(" ") };
    const asciiToStr = (hex) => { const s = String(hex || ""); let o = ""; for (let i = 0; i + 1 < s.length; i += 2) { const b = parseInt(s.slice(i, i + 2), 16); o += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : "." } return o };
    const fmtTime = (t) => { const d = new Date(t); const p = (n) => (n < 10 ? "0" + n : "" + n); return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "." + String(d.getMilliseconds()).padStart(3, "0") };
    const FLOAT_KEY = "dsh-zf-assistant.floatbox";
    const loadFloatBox = (key) => { try { return JSON.parse(localStorage.getItem(key || FLOAT_KEY) || "{}") } catch (e) { return {} } };
    const saveFloatBox = (v, key) => { try { localStorage.setItem(key || FLOAT_KEY, JSON.stringify(v)) } catch (e) {} };
    const FLOAT_ON_KEY = "dsh-zf-assistant.floatOn";
    // 主题背景色（标题栏调色盘写入，刷新后保持）
    const THEME_KEY = "dsh-zf-assistant.themeBg";
    const THEME_PRESETS = ["#ffffff", "#f5f6f8", "#fef9ef", "#eef7ff", "#f0fdf4", "#fdf2f8", "#0f172a", "#1f2937", "#1e293b", "#0b1220", "#134e4a", "#3b0764"];
    const loadThemeBg = () => { try { return localStorage.getItem(THEME_KEY) || "#ffffff" } catch (e) { return "#ffffff" } };
    const saveThemeBg = (v) => { try { localStorage.setItem(THEME_KEY, v) } catch (e) {} };
    const isDarkColor = (hex) => {
      const s = String(hex || "").replace("#", "");
      const n = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
      const r = parseInt(n.slice(0, 2), 16) || 0, g = parseInt(n.slice(2, 4), 16) || 0, b = parseInt(n.slice(4, 6), 16) || 0;
      return (r * 299 + g * 587 + b * 114) / 1000 < 128;
    };
    // 参数调试的通道配置（命名 / 最小值 / 最大值 / 步进）
    const TUNE_CFG_KEY = "dsh-zf-assistant.tuneCfg";
    const loadTuneCfg = () => { try { return JSON.parse(localStorage.getItem(TUNE_CFG_KEY) || "{}") } catch (e) { return {} } };
    const saveTuneCfg = (v) => { try { localStorage.setItem(TUNE_CFG_KEY, JSON.stringify(v)) } catch (e) {} };
    const loadFloatOn = () => { try { const v = localStorage.getItem(FLOAT_ON_KEY); return v === null ? true : v === "1" } catch (e) { return true } };
    const saveFloatOn = (v) => { try { localStorage.setItem(FLOAT_ON_KEY, v ? "1" : "0") } catch (e) {} };

    // 浮窗缩放热区：四条边（5px）+ 四个角（14px），贴边放不超出边框
    const RESIZE_HANDLES = [
      ["n", { top: 0, left: 12, right: 12, height: 5, cursor: "ns-resize" }],
      ["s", { bottom: 0, left: 12, right: 12, height: 5, cursor: "ns-resize" }],
      ["w", { top: 12, bottom: 12, left: 0, width: 5, cursor: "ew-resize" }],
      ["e", { top: 12, bottom: 12, right: 0, width: 5, cursor: "ew-resize" }],
      ["nw", { top: 0, left: 0, width: 14, height: 14, cursor: "nwse-resize" }],
      ["ne", { top: 0, right: 0, width: 14, height: 14, cursor: "nesw-resize" }],
      ["sw", { bottom: 0, left: 0, width: 14, height: 14, cursor: "nesw-resize" }],
      ["se", { bottom: 0, right: 0, width: 14, height: 14, cursor: "nwse-resize" }],
    ];

    // 浮窗：标题栏拖动移动，八向拖边缩放，位置与尺寸记在 localStorage
    const ZF_TOP_SAFE = 40;   // 顶部窗口标题栏高度：浮窗不能压上去，否则鼠标事件被 Electron 的窗口拖动区吞掉
    function FloatFrame({ title, onClose, children, storageKey, z }) {
      const frameKey = storageKey || FLOAT_KEY;
      const seed = useRef(null);
      if (!seed.current) {
        const s = loadFloatBox(frameKey);
        seed.current = {
          x: typeof s.x === "number" ? s.x : Math.max(12, (window.innerWidth || 1280) - 470),
          y: typeof s.y === "number" ? Math.max(ZF_TOP_SAFE, s.y) : 84,
          w: typeof s.w === "number" ? s.w : 460,
          h: typeof s.h === "number" ? s.h : 680,
        };
      }
      const [box, setBox] = useState(seed.current);
      const [collapsed, setCollapsed] = useState(false);
      // 主题背景色：整个插件底色，标题栏右侧调色盘可改
      const [bg, setBg] = useState(loadThemeBg);
      const [showColor, setShowColor] = useState(false);
      const darkBg = isDarkColor(bg);
      const fg = darkBg ? "#e8eaed" : "#111827";
      // 取色器的两种拖动（色板 / 色相条）都在原生弹层里跑，事件频率极高。
      // 只要拖动过程中改 React 状态，就要重渲染整棵树（参数面板 8 行滑块 + 示波器 canvas），
      // 主线程一被占住，原生弹层自己也跟着卡 —— 这就是色相条顿的原因。
      // 做法：拖动中只直接改 DOM 的 background（合成层，零重渲染），停手 220ms 后再一次性提交。
      const rootRef = useRef(null);
      const bgPending = useRef(null);
      const bgCommitTimer = useRef(0);
      const pickBg = (v) => {
        bgPending.current = v;
        const el = rootRef.current;
        if (el) el.style.background = v;          // 拖动中只碰 DOM，不触发 React
        clearTimeout(bgCommitTimer.current);
        bgCommitTimer.current = setTimeout(() => {
          const val = bgPending.current;
          if (val == null) return;
          setBg(val);                              // 停手后提交：同步标题栏/示波器配色
          themeStore.set(val);
          saveThemeBg(val);
        }, 220);
      };
      // 界面缩放：zoom 会真实改变布局尺寸，缩小时小窗里也能装下全部内容
      const scaleKey = frameKey + ".scale";
      const [scale, setScale] = useState(() => {
        try {
          const v = parseFloat(localStorage.getItem(scaleKey));
          return v >= 0.4 && v <= 1.3 ? v : 1;
        } catch (e) { return 1; }
      });
      const applyScale = (v) => {
        const n = Math.max(0.4, Math.min(1.3, Math.round(v * 10) / 10));
        setScale(n);
        try { localStorage.setItem(scaleKey, String(n)) } catch (e) {}
      };
      const boxRef = useRef(box); boxRef.current = box;
      const dragging = useRef(null);
      useEffect(() => {
        const onMove = (e) => {
          const d = dragging.current; if (!d) return;
          if (d.kind === "move") {
            const b = boxRef.current;
            setBox(Object.assign({}, b, {
              x: Math.max(0, Math.min((window.innerWidth || 1280) - 140, e.clientX - d.dx)),
              y: Math.max(ZF_TOP_SAFE, Math.min((window.innerHeight || 800) - 44, e.clientY - d.dy)),
            }));
            return;
          }
          if (d.kind !== "resize") return;
          const s = d.start, dx = e.clientX - d.sx, dy = e.clientY - d.sy;
          const MINW = 360, MINH = 320;
          let x = s.x, y = s.y, w = s.w, h = s.h;
          if (d.dir.indexOf("e") >= 0) w = s.w + dx;
          if (d.dir.indexOf("s") >= 0) h = s.h + dy;
          if (d.dir.indexOf("w") >= 0) { w = s.w - dx; x = s.x + dx; }
          if (d.dir.indexOf("n") >= 0) { h = s.h - dy; y = s.y + dy; }
          if (w < MINW) { if (d.dir.indexOf("w") >= 0) x = s.x + (s.w - MINW); w = MINW; }
          if (h < MINH) { if (d.dir.indexOf("n") >= 0) y = s.y + (s.h - MINH); h = MINH; }
          if (x < 0) { w += x; x = 0; }
          if (y < ZF_TOP_SAFE) { h += y - ZF_TOP_SAFE; y = ZF_TOP_SAFE; }
          setBox({ x, y, w, h });
        };
        const onUp = () => { if (dragging.current) { dragging.current = null; saveFloatBox(boxRef.current, frameKey) } };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      }, []);
      const onHeadDown = (e) => { dragging.current = { kind: "move", dx: e.clientX - box.x, dy: e.clientY - box.y } };
      const onResizeDown = (dir) => (e) => {
        e.stopPropagation(); e.preventDefault();
        const b = boxRef.current;
        dragging.current = { kind: "resize", dir, sx: e.clientX, sy: e.clientY, start: { x: b.x, y: b.y, w: b.w, h: b.h } };
      };
      return h("div", {
        className: "zf-float-frame",
        ref: rootRef,
        style: {
          position: "fixed", left: box.x, top: box.y, width: box.w, height: collapsed ? 44 : box.h,
          zIndex: z || 9000, display: "flex", flexDirection: "column",
          WebkitAppRegion: "no-drag",
          background: bg, color: fg,
          border: "1px solid #d4d8de", borderRadius: 10, boxShadow: "0 14px 38px rgba(0,0,0,.20)", overflow: "hidden",
        },
      },
        h("div", { onMouseDown: onHeadDown, style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", cursor: "move", userSelect: "none", borderBottom: "1px solid " + (darkBg ? "rgba(255,255,255,.14)" : "#e5e7eb"), background: darkBg ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.03)" } },
          h("span", { style: { fontWeight: 600, fontSize: 13 } }, title),
          h("span", { style: { flex: 1 } }),
          // 调色盘：切换插件背景色
          h("button", { title: "主题颜色", style: Object.assign({}, S.btn, { position: "relative", zIndex: 6, padding: "1px 7px", fontSize: 12, color: fg }), onClick: (e) => { e.stopPropagation(); setShowColor((v) => !v) } }, "🎨"),
          h("button", { title: "缩小界面（0.4 倍时小窗可装下全部参数）", style: Object.assign({}, S.btn, { position: "relative", zIndex: 5, padding: "1px 7px", fontSize: 12 }), onClick: () => applyScale(scale - 0.1) }, "−"),
          h("span", { title: "界面缩放比例", style: { position: "relative", zIndex: 5, fontSize: 11, color: "#6b7280", minWidth: 34, textAlign: "center", userSelect: "none" } }, Math.round(scale * 100) + "%"),
          h("button", { title: "放大界面", style: Object.assign({}, S.btn, { position: "relative", zIndex: 5, padding: "1px 7px", fontSize: 12 }), onClick: () => applyScale(scale + 0.1) }, "+"),
          h("button", { style: Object.assign({}, S.btn, { position: "relative", zIndex: 5, padding: "1px 8px", fontSize: 12 }), onClick: () => setCollapsed((v) => !v) }, collapsed ? "▢" : "—"),
          h("button", { style: Object.assign({}, S.btn, { position: "relative", zIndex: 5, padding: "1px 8px", fontSize: 12 }), onClick: onClose }, "✕")),
        showColor ? h("div", { style: { position: "absolute", top: 44, right: 8, zIndex: 30, background: "#ffffff", color: "#111827", border: "1px solid #d4d8de", borderRadius: 8, padding: 10, boxShadow: "0 10px 28px rgba(0,0,0,.22)", display: "flex", flexDirection: "column", gap: 8, minWidth: 196 } },
          h("div", { style: { fontSize: 12, color: "#66707a" } }, "插件背景色"),
          h("div", { style: { display: "grid", gridTemplateColumns: "repeat(6, 24px)", gap: 6 } },
            THEME_PRESETS.map((c) => h("button", {
              key: c, title: c,
              style: { width: 24, height: 24, borderRadius: 6, cursor: "pointer", background: c, border: String(c).toLowerCase() === String(bg).toLowerCase() ? "2px solid #3b82f6" : "1px solid #d4d8de" },
              onClick: () => pickBg(c)
            }))),
          h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
            h("input", { type: "color", value: bg, style: { width: 40, height: 28, padding: 0, border: "1px solid #d4d8de", borderRadius: 6, background: "none", cursor: "pointer" }, onChange: (e) => pickBg(e.target.value) }),
            h("span", { style: { fontSize: 12, color: "#66707a", flex: 1 } }, bg),
            h("button", { style: Object.assign({}, S.btn, { padding: "3px 9px", fontSize: 12 }), onClick: () => pickBg("#ffffff") }, "重置"))) : null,
        collapsed ? null : h("div", { style: { flex: 1, overflow: "auto", padding: "10px 12px", zoom: scale } }, children),
        collapsed ? null : RESIZE_HANDLES.map((hd) => h("div", {
          key: hd[0],
          onMouseDown: onResizeDown(hd[0]),
          style: Object.assign({ position: "absolute", zIndex: 3, background: "transparent" }, hd[1]),
        }))
      );
    }

    // ---------------- 侧边栏入口（sidebar.panellist + main 配对） ----------------
    // 与 @linxin666/dsh-client-ui-skill-explorer 同一套契约：
    //   sidebar.panellist 注册图标行（宿主负责按钮/文字/高亮），main 注册被选中时挂载的页面。
    const ZF_PANEL_ID = "zf-device-debug";
    const ZF_PANEL_ORDER = 40;   // 插件 0 / 自动化任务 10 / 灵枢 20 / 技能中心 30

    // 全局浮窗开关：侧栏图标与 shell.overlay 常驻宿主共享（同一模块实例）
    let zfFloatOpen = false;
    let zfCtx = null;   // apply 里赋值，供 ZfMainPage 调 ctx.layout
    const zfFloatSubs = new Set();
    const setZfFloatOpen = (v) => { zfFloatOpen = !!v; zfFloatSubs.forEach((fn) => { try { fn(zfFloatOpen) } catch (e) {} }); };
    // pointerdown / mousedown / click 会连着来，防抖避免开关好几下
    let zfToggleAt = 0;
    const toggleZfFloat = () => { const now = Date.now(); if (now - zfToggleAt < 400) return; zfToggleAt = now; setZfFloatOpen(!zfFloatOpen); };

    // 常驻在 shell.overlay 里的浮窗宿主：切页面也不卸载
    function ZfFloatHost() {
      const [open, setOpen] = useState(zfFloatOpen);
      useEffect(() => { zfFloatSubs.add(setOpen); return () => { zfFloatSubs.delete(setOpen) }; }, []);
      if (!open) return null;
      return h(FloatFrame, { title: "内置智能串口助手 · 设备调试", onClose: () => setZfFloatOpen(false) },
        h(DevicePanel, { forceDock: true, forceFloat: true }));
    }

    function ZfPanelIcon({ size }) {
      const stop = (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (err) {} };
      return h("svg", {
        "data-dsh-panel-entry": ZF_PANEL_ID,
        // pointerdown 比宿主 click 更早，拦下来宿主就不会切主区；三层都绑，哪个先到都能开
        onPointerDown: (e) => { stop(e); toggleZfFloat(); },
        onMouseDown: (e) => { stop(e); toggleZfFloat(); },
        onClick: (e) => { stop(e); toggleZfFloat(); },
        viewBox: "0 0 16 16",
        width: size, height: size,
        fill: "none", stroke: "currentColor",
        strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round",
        "aria-hidden": "true",
        style: { cursor: "pointer", pointerEvents: "auto" },
      },
        h("path", { d: "M14.2 1.8v12.4H1.8" }),
        h("path", { d: "M3.2 8.4h2.1l1.2-3.2 1.9 6.4 1.3-3.2h2.2l1.1 1.8h1.5" }));
    }

    // 兜底页：宿主切主区时不做任何渲染，打开浮窗并立刻把主区切回会话
    function ZfMainPage() {
      useEffect(() => {
        setZfFloatOpen(true);
        // selectPanel(null) = 清空主区面板 = 回到会话视图；延后一拍等宿主完成切换
        const t = setTimeout(() => {
          try {
            const L = zfCtx && zfCtx.layout;
            if (L && typeof L.selectPanel === "function") L.selectPanel(null);
          } catch (e) {}
        }, 30);
        return () => clearTimeout(t);
      }, []);
      return null;
    }
    const SCOPE_PAD = { l: 56, r: 14, t: 14, b: 30 };
    const SCOPE_Y_TICKS = 10;
    const SCOPE_X_TICKS = 10;

    const scopeAutoRange = (waves, enabled) => {
      let min = Infinity, max = -Infinity;
      const n = waves ? waves.length : 0;
      const en = enabled || [];
      for (let c = 0; c < (en.length || 1); c++) {
        if (en.length && en[c] === false) continue;
        for (let i = 0; i < n; i++) {
          const v = waves[i] && waves[i].ch ? waves[i].ch[c] : undefined;
          if (typeof v === "number" && v === v) { if (v < min) min = v; if (v > max) max = v; }
        }
      }
      if (min === Infinity) return { y0: -0.5, yLen: 1 };
      const m = Math.max(Math.abs(min), Math.abs(max), 1e-9) * 1.08;
      return { y0: -m, yLen: 2 * m };   // 0 点居中，上下对称
    };

    const fmtTick = (v, span) => {
      if (!Number.isFinite(v)) return "";
      const a = Math.abs(v);
      if (span >= 1e5 || a >= 1e6) return (v / 1000).toFixed(0) + "k";
      if (span >= 1e4) return (v / 1000).toFixed(1) + "k";
      if (span >= 1e3) return v.toFixed(0);
      if (span >= 10) return v.toFixed(0);
      if (span >= 1) return v.toFixed(1);
      if (span >= 0.1) return v.toFixed(2);
      return v.toFixed(Math.min(5, Math.max(3, Math.ceil(-Math.log10(span)) + 1)));
    };

    // 主题色订阅：调色盘改动后通知示波器等子组件重绘
    const themeStore = {
      bg: loadThemeBg(),
      subs: new Set(),
      set(v) { this.bg = v; this.subs.forEach((f) => { try { f(v) } catch (e) {} }) },   // 写盘由 pickBg 统一 debounce，这里只更新内存并通知
      sub(f) { this.subs.add(f); return () => { this.subs.delete(f) } },
    };
    // 示波器色板：底色跟随主题，网格/边框/刻度按背景明暗自动切换
    const scopePalette = (bg) => {
      const dark = isDarkColor(bg);
      return dark
        ? { bg: bg, gridMinor: "rgba(255,255,255,.05)", gridMajor: "rgba(255,255,255,.12)", border: "rgba(255,255,255,.24)", tick: "#9aa7b8", zeroY: "#8fa3bf", zeroX: "#e5484d" }
        : { bg: bg, gridMinor: "rgba(0,0,0,.035)", gridMajor: "rgba(0,0,0,.09)", border: "rgba(0,0,0,.20)", tick: "#6b7280", zeroY: "#8fa3bf", zeroX: "#e5484d" };
    };

    function drawScope(ctx, W, Ht, waves, enabled, view, themeBg) {
      const L = SCOPE_PAD.l, R = W - SCOPE_PAD.r, T = SCOPE_PAD.t, B = Ht - SCOPE_PAD.b;
      const iw = Math.max(1, R - L), ih = Math.max(1, B - T);
      const pal = scopePalette(themeBg || "#ffffff");
      ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, Ht);

      const ar = scopeAutoRange(waves, enabled);
      const lock = (view && view.lock) || {};
      const auto = !view || view.auto !== false;
      // X 轴：0 点默认落在画布正中（与 Y 轴一致），可用 xOffset / 拖动平移
      const xLen = Math.max(1e-6, (view && view.xLen) || 100);
      const xOffset = (view && typeof view.xOffset === "number") ? view.xOffset : 0;
      const x0 = -xLen / 2 + xOffset;
      // 等比例：Y 轴范围由「X 范围 × 画布高宽比」推出，缩放时纵横比例不变
      // 0 点默认落在画布正中，用 yOffset 可整体上下平移
      const viewYLen = (view && typeof view.yLen === "number" && view.yLen > 0) ? view.yLen : 0;
      const lockYLen = !!lock.yLen && viewYLen > 0;
      // 锁住 Y 的起点或长度，就不能让自动跟随再改它
      const useAuto = auto && !lockYLen && !lock.y0;
      const yLen = useAuto ? ar.yLen : Math.max(1e-9, viewYLen || (xLen * (ih / iw)));
      const yOffset = (view && typeof view.yOffset === "number") ? view.yOffset : 0;
      const y0 = useAuto ? ar.y0 : (-yLen / 2 + yOffset);

      // 次网格
      ctx.strokeStyle = pal.gridMinor; ctx.lineWidth = 1;
      for (let i = 0; i <= SCOPE_X_TICKS * 5; i++) { const x = Math.round(L + iw * i / (SCOPE_X_TICKS * 5)) + 0.5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke(); }
      for (let i = 0; i <= SCOPE_Y_TICKS * 5; i++) { const y = Math.round(T + ih * i / (SCOPE_Y_TICKS * 5)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
      // 主网格
      ctx.strokeStyle = pal.gridMajor; ctx.lineWidth = 1;
      for (let i = 0; i <= SCOPE_X_TICKS; i++) { const x = Math.round(L + iw * i / SCOPE_X_TICKS) + 0.5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, B); ctx.stroke(); }
      for (let i = 0; i <= SCOPE_Y_TICKS; i++) { const y = Math.round(T + ih * i / SCOPE_Y_TICKS) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }
      // 边框
      ctx.strokeStyle = pal.border; ctx.lineWidth = 1;
      ctx.strokeRect(L + 0.5, T + 0.5, iw, ih);

      // X = 0 参考线（红色实线，始终提示时间轴零点）
      if (0 >= x0 && 0 <= x0 + xLen) {
        const px = Math.round(L + iw * (0 - x0) / xLen) + 0.5;
        ctx.strokeStyle = pal.zeroX; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, B); ctx.stroke();
      }
      // Y = 0 参考线（浅蓝虚线，提示幅值零点）
      if (0 >= y0 && 0 <= y0 + yLen) {
        const py = Math.round(B - ih * (0 - y0) / yLen) + 0.5;
        ctx.save();
        ctx.strokeStyle = pal.zeroY; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(L, py); ctx.lineTo(R, py); ctx.stroke();
        ctx.restore();
      }

      // 刻度数字
      ctx.fillStyle = pal.tick;
      ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (let i = 0; i <= SCOPE_Y_TICKS; i++) {
        const val = y0 + yLen * (1 - i / SCOPE_Y_TICKS);
        ctx.fillText(fmtTick(val, yLen), L - 7, T + ih * i / SCOPE_Y_TICKS);
      }
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (let i = 0; i <= SCOPE_X_TICKS; i++) {
        const val = x0 + xLen * i / SCOPE_X_TICKS;
        ctx.fillText(fmtTick(val, xLen), L + iw * i / SCOPE_X_TICKS, B + 7);
      }

      // 曲线
      if (!waves || !waves.length) return;
      const en = enabled || [];
      const n = waves.length;
      for (let c = 0; c < (en.length || 1); c++) {
        if (en.length && en[c] === false) continue;
        ctx.strokeStyle = CH_COLORS[c % CH_COLORS.length]; ctx.lineWidth = 1.5;
        ctx.beginPath();
        let first = true;
        for (let i = 0; i < n; i++) {
          const v = waves[i] && waves[i].ch ? waves[i].ch[c] : undefined;
          if (typeof v !== "number" || v !== v) continue;
          const px = n > 1 ? i / (n - 1) : 0;
          const x = L + iw * px;
          const y = B - ih * (v - y0) / yLen;
          if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    function ScopeCanvas({ waves, enabled, view, onChange }) {
      const wrapRef = useRef(null);
      const ref = useRef(null);
      const latest = useRef({});
      // 跟随主题背景色：调色盘一改，示波器底色/网格/刻度同步重绘
      const [tbg, setTbg] = useState(themeStore.bg);
      useEffect(() => themeStore.sub((v) => setTbg(v)), []);
      latest.current = { waves, enabled, view, onChange, tbg };

      const paint = () => {
        const cv = ref.current; if (!cv) return;
        const wrap = wrapRef.current;
        const W = Math.max(320, Math.round((wrap && wrap.clientWidth) || 800));
        const Ht = 340;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const pw = Math.round(W * dpr), ph = Math.round(Ht * dpr);
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
        cv.style.width = W + "px"; cv.style.height = Ht + "px";
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const lp = latest.current;
        drawScope(ctx, W, Ht, lp.waves, lp.enabled, lp.view, lp.tbg);
      };

      useEffect(paint, [waves, enabled, view, tbg]);
      useEffect(() => {
        const wrap = wrapRef.current; if (!wrap) return;
        let t = null;
        const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(paint, 60); });
        ro.observe(wrap);
        return () => { ro.disconnect(); clearTimeout(t); };
      }, []);
      useEffect(() => {
        const cv = ref.current; if (!cv) return;
        const onWheel = (e) => {
          e.preventDefault();
          const lp = latest.current;
          const v = lp.view || {};
          const cb = lp.onChange;
          if (typeof cb !== "function") return;
          const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;   // 下滚缩小（范围放大）
          const rect = cv.getBoundingClientRect();
          const fx = (e.clientX - rect.left - SCOPE_PAD.l) / Math.max(1, rect.width - SCOPE_PAD.l - SCOPE_PAD.r);
          const cx = Math.max(0, Math.min(1, fx));
          const lock = v.lock || {};
          const curXOff = typeof v.xOffset === "number" ? v.xOffset : 0;
          const curXLen = Math.max(1e-6, v.xLen || 100);
          // 等比缩放：X / Y 按同一比例变化，纵横比例恒定；0 点保持居中
          const ih = Math.max(1, rect.height - SCOPE_PAD.t - SCOPE_PAD.b);
          const iw = Math.max(1, rect.width - SCOPE_PAD.l - SCOPE_PAD.r);
          const autoNow = v.auto !== false;
          const lockYLenNow = !!lock.yLen && typeof v.yLen === "number" && v.yLen > 0;
          const useAutoForWheel = autoNow && !lockYLenNow && !lock.y0;
          const curYLen = useAutoForWheel
            ? scopeAutoRange(lp.waves, lp.enabled).yLen
            : Math.max(1e-9, (typeof v.yLen === "number" && v.yLen > 0) ? v.yLen : curXLen * (ih / iw));
          const xLen = lock.xLen ? curXLen : Math.max(2, curXLen * k);
          // 缩放锚点：锁「起点」时钉住起点数值（长度变化用 offset 补偿），否则以鼠标位置为锚
          const curX0 = -curXLen / 2 + curXOff;
          const hit = curX0 + cx * curXLen;
          const xOffset = lock.x0 ? (curX0 + xLen / 2) : (hit - cx * xLen + xLen / 2);
          const curYOff = typeof v.yOffset === "number" ? v.yOffset : 0;
          const curY0 = useAutoForWheel ? scopeAutoRange(lp.waves, lp.enabled).y0 : (-curYLen / 2 + curYOff);
          const nextYLen = lock.yLen ? curYLen : curYLen * k;
          const nextYOff = lock.y0 ? (curY0 + nextYLen / 2) : curYOff;
          cb({ xLen, xOffset, yLen: nextYLen, yOffset: nextYOff, auto: false, lock });
        };
        cv.addEventListener("wheel", onWheel, { passive: false });
        return () => cv.removeEventListener("wheel", onWheel);
      }, []);
      // 按住左键拖动平移：水平改 X 起点，垂直改 Y 轴 0 点位置（默认居中）
      useEffect(() => {
        const cv = ref.current; if (!cv) return;
        let drag = null;
        const onDown = (e) => {
          if (e.button !== 0) return;
          const v = latest.current.view || {};
          const rect = cv.getBoundingClientRect();
          const iw = Math.max(1, rect.width - SCOPE_PAD.l - SCOPE_PAD.r);
          const ih = Math.max(1, rect.height - SCOPE_PAD.t - SCOPE_PAD.b);
          const xLen = Math.max(1e-6, v.xLen || 100);
          const auto = v.auto !== false;
          drag = {
            sx: e.clientX, sy: e.clientY,
            xOffset: typeof v.xOffset === "number" ? v.xOffset : 0,
            xLen,
            yLen: auto
              ? scopeAutoRange(latest.current.waves, latest.current.enabled).yLen
              : Math.max(1e-9, (typeof v.yLen === "number" && v.yLen > 0) ? v.yLen : xLen * (ih / iw)),
            yOffset: typeof v.yOffset === "number" ? v.yOffset : 0,
            iw, ih
          };
          cv.style.cursor = "grabbing";
          e.preventDefault();
        };
        const onMove = (e) => {
          if (!drag) return;
          const cb = latest.current.onChange;
          if (typeof cb !== "function") return;
          const dx = (e.clientX - drag.sx) / drag.iw;
          const dy = (e.clientY - drag.sy) / drag.ih;
          const lk = (latest.current.view && latest.current.view.lock) || {};
          // 拖动只改视口位置，不改缩放比例；锁住的那一维保持不动
          cb({
            xOffset: lk.x0 ? drag.xOffset : (drag.xOffset - dx * drag.xLen),
            xLen: drag.xLen,
            yLen: drag.yLen,
            yOffset: lk.y0 ? drag.yOffset : (drag.yOffset + dy * drag.yLen),
            auto: false,
            lock: lk
          });
        };
        const onUp = () => { if (drag) { drag = null; cv.style.cursor = "grab"; } };
        cv.style.cursor = "grab";
        cv.addEventListener("mousedown", onDown);
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return () => { cv.removeEventListener("mousedown", onDown); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
      }, []);

      return h("div", { ref: wrapRef, style: { width: "100%", overflow: "hidden", borderRadius: 6, border: "1px solid " + (isDarkColor(tbg) ? "rgba(255,255,255,.24)" : "#e4e8ee"), background: tbg } },
        h("canvas", { ref, style: { display: "block", width: "100%" } }));
    }

    // ---------------- 图像传输面板（仿逐飞：保存视频 / 显示模式 / 保存图片 / 二值化） ----------------
    function ImageView({ image, bytesCount }) {
      const cvRef = useRef(null);
      const [binarize, setBinarize] = useState(false);
      const [dispMode, setDispMode] = useState("fit");   // fit | real | zoom
      const [zoom, setZoom] = useState(100);
      const [recording, setRecording] = useState(false);
      const [fps, setFps] = useState(0);
      const [rate, setRate] = useState(0);
      const [size, setSize] = useState({ w: 0, h: 0 });
      const framesRef = useRef(0);
      const lastTRef = useRef(Date.now());
      const bytesRef = useRef(0);
      const lastBytesRef = useRef(0);
      const recorderRef = useRef(null);
      const chunksRef = useRef([]);
      bytesRef.current = bytesCount || 0;

      // 每秒结算一次帧率与字节速率
      useEffect(() => {
        const id = setInterval(() => {
          const now = Date.now();
          const dt = Math.max(0.2, (now - lastTRef.current) / 1000);
          setFps(Math.round(framesRef.current / dt));
          setRate(Math.round((bytesRef.current - lastBytesRef.current) / dt));
          framesRef.current = 0;
          lastTRef.current = now;
          lastBytesRef.current = bytesRef.current;
        }, 1000);
        return () => clearInterval(id);
      }, []);

      // 画到 canvas（二值化在这里做，保存图片/录制视频都取这块 canvas）
      useEffect(() => {
        if (!image || !image.dataBase64) return;
        const im = new Image();
        im.onload = () => {
          const cv = cvRef.current;
          if (!cv) return;
          const w = im.naturalWidth || im.width || 0;
          const hh = im.naturalHeight || im.height || 0;
          if (!w || !hh) return;
          cv.width = w; cv.height = hh;
          const ctx = cv.getContext("2d");
          ctx.drawImage(im, 0, 0);
          if (binarize) {
            const d = ctx.getImageData(0, 0, w, hh);
            const p = d.data;
            for (let i = 0; i < p.length; i += 4) {
              const g = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
              const v = g > 127 ? 255 : 0;
              p[i] = p[i + 1] = p[i + 2] = v; p[i + 3] = 255;
            }
            ctx.putImageData(d, 0, 0);
          }
          setSize({ w, h: hh });
          framesRef.current++;
        };
        im.src = (image.contentType === "image/jpeg" ? "data:image/jpeg;base64," : "data:application/octet-stream;base64,") + image.dataBase64;
      }, [image, binarize]);

      const savePic = () => {
        const cv = cvRef.current;
        if (!cv || !cv.width) return;
        cv.toBlob((b) => {
          if (!b) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = "zf-frame-" + Date.now() + ".png";
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1500);
        }, "image/png");
      };

      const startRec = () => {
        const cv = cvRef.current;
        if (!cv || !cv.width || !cv.captureStream) return;
        try {
          const stream = cv.captureStream(10);
          const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
          chunksRef.current = [];
          rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
          rec.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: "video/webm" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "zf-video-" + Date.now() + ".webm";
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1500);
            setRecording(false);
          };
          rec.start();
          recorderRef.current = rec;
          setRecording(true);
        } catch (e) { /* 浏览器不支持录制时静默 */ }
      };
      const stopRec = () => {
        const r = recorderRef.current;
        recorderRef.current = null;
        if (r && r.state !== "inactive") r.stop();
      };

      const iconBtn = (label, icon, onClick, active) => h("button", {
        title: label,
        onClick,
        style: {
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 13px", borderRadius: 10, cursor: "pointer",
          background: active ? "#e8effc" : "#f4f5f7",
          border: "1px solid " + (active ? "#b9cdf3" : "#e3e5e8"),
          color: active ? "#1d4ed8" : "#1f2328",
          fontSize: 13
        }
      }, h("span", { style: { fontSize: 15, lineHeight: 1 } }, icon), label);

      const canvasStyle = { display: "block", borderRadius: 6, background: "#fff", imageRendering: "pixelated" };
      if (dispMode === "fit") { canvasStyle.maxWidth = "100%"; canvasStyle.maxHeight = 460; canvasStyle.width = "auto"; canvasStyle.height = "auto"; }
      else if (dispMode === "real") { canvasStyle.width = size.w || "auto"; }
      else { canvasStyle.width = Math.max(1, Math.round((size.w || 0) * zoom / 100)); }

      return h("div", { style: S.panel },
        h("div", { style: { fontWeight: 600, marginBottom: 8 } }, "实时图像" + (size.w ? "（" + size.w + "×" + size.h + "）" : "")),
        h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } },
          iconBtn(recording ? "停止录制并保存" : "保存视频（录制收到的帧）", recording ? "⏹" : "🎬", recording ? stopRec : startRec, recording),
          iconBtn("自适应显示（缩放到框内）", "⤢", () => setDispMode("fit"), dispMode === "fit"),
          iconBtn("原始尺寸（1:1 像素）", "▣", () => setDispMode("real"), dispMode === "real"),
          iconBtn("按百分比缩放", "%", () => setDispMode("zoom"), dispMode === "zoom"),
          dispMode === "zoom" ? h("input", { type: "number", min: 10, max: 800, step: 10, value: zoom, onChange: (e) => setZoom(Math.max(10, Math.min(800, Number(e.target.value) || 100))), style: Object.assign({}, S.input, { width: 78 }) }) : null,
          iconBtn("保存图片", "🖼", savePic, false),
          iconBtn("显示二值化图像", "◐", () => setBinarize((v) => !v), binarize)),
        h("div", { style: { overflow: "auto", maxHeight: 500, background: "#fafbfc", border: "1px solid #eceef1", borderRadius: 8, padding: 8 } },
          image && image.dataBase64
            ? h("canvas", { ref: cvRef, style: canvasStyle })
            : h("div", { style: Object.assign({}, S.mute, { padding: 24 }) }, "暂无图像（单片机按图像帧协议上行）")),
        h("div", { style: { display: "flex", gap: 22, marginTop: 10, fontSize: 12.5, color: "#5b6472" } },
          h("span", null, "宽度: ", h("b", { style: { color: "#1f2328" } }, size.w || 0)),
          h("span", null, "高度: ", h("b", { style: { color: "#1f2328" } }, size.h || 0)),
          h("span", null, "FPS: ", h("b", { style: { color: "#1f2328" } }, fps)),
          h("span", null, "字节数/秒: ", h("b", { style: { color: "#1f2328" } }, rate))));
    }

    // ---------------- 参数调试面板 ----------------
    function TunePanel({ nCh, names, onSend, cfg, onCfg, audit, onAuditClear }) {
      const [vals, setVals] = useState(() => Array.from({ length: 8 }, () => 0));
      const [showCfg, setShowCfg] = useState(false);
      // 每通道配置：用户自定义优先，缺省回落内置规则（通道6=目标速度 0~1000 整数，其余 PID 0~200 两位小数）
      const get = (i) => {
        const base = i === 6
          ? { min: 0, max: 1000, step: 1, dec: 0, jump: 50 }
          : { min: 0, max: 200, step: 0.1, dec: 2, jump: 1 };
        const u = (cfg && cfg[i]) || {};
        const step = (Number.isFinite(u.step) && u.step > 0) ? u.step : base.step;
        const dec = step >= 1 ? 0 : 2;
        return {
          name: u.name || "",
          min: Number.isFinite(u.min) ? u.min : base.min,
          max: Number.isFinite(u.max) ? u.max : base.max,
          step, dec,
          jump: step >= 1 ? step : 1,
        };
      };
      const clamp = (i, v) => { const c = get(i); let n = Number(v); if (!Number.isFinite(n)) n = 0; n = Math.max(c.min, Math.min(c.max, n)); const f = Math.pow(10, c.dec); return Math.round(n * f) / f };
      const setVal = (i, v) => setVals((a) => { const c = a.slice(); c[i] = clamp(i, v); return c });
      const nameOf = (i) => get(i).name || (names && names[i]) || "通道" + i;
      return h("div", { style: Object.assign({}, S.card, { maxWidth: "none", width: "100%" }) },
        h("div", { style: S.row },
          h("span", { style: { fontWeight: 600 } }, "参数调试（通道 0-" + (nCh - 1) + "，下发用 0x55 参数帧）"),
          h("span", { style: { flex: 1 } }),
          h("button", { style: showCfg ? S.btnPrimary : S.btn, onClick: () => setShowCfg((v) => !v) }, showCfg ? "⚙ 收起通道设置" : "⚙ 通道设置")),

        // 通道设置：命名 / 最小值 / 最大值 / 步进
        showCfg ? h("div", { style: Object.assign({}, S.panel, { marginTop: 8, marginBottom: 8 }) },
          h("div", { style: { fontWeight: 600, fontSize: 13, marginBottom: 6 } }, "通道设置（留空名称则用协议字段名）"),
          h("div", { style: Object.assign({}, S.row, { fontSize: 11, color: "#8a919e" }) },
            h("span", { style: { minWidth: 28 } }, "#"),
            h("span", { style: { flex: 2, minWidth: 90 } }, "命名"),
            h("span", { style: { flex: 1, minWidth: 70 } }, "最小值"),
            h("span", { style: { flex: 1, minWidth: 70 } }, "最大值"),
            h("span", { style: { flex: 1, minWidth: 60 } }, "步进")),
          Array.from({ length: nCh }).map((_, i) => {
            const c = get(i);
            const upd = (patch) => { if (onCfg) onCfg(i, patch) };
            return h("div", { key: i, style: S.row },
              h("span", { style: { minWidth: 28, color: "#8a919e" } }, String(i)),
              h("input", { style: Object.assign({}, S.input, { flex: 2, minWidth: 90 }), type: "text", value: c.name, placeholder: nameOf(i), onChange: (e) => upd({ name: e.target.value }) }),
              h("input", { style: Object.assign({}, S.input, { flex: 1, minWidth: 70 }), type: "number", value: c.min, onChange: (e) => upd({ min: Number(e.target.value) }) }),
              h("input", { style: Object.assign({}, S.input, { flex: 1, minWidth: 70 }), type: "number", value: c.max, onChange: (e) => upd({ max: Number(e.target.value) }) }),
              h("input", { style: Object.assign({}, S.input, { flex: 1, minWidth: 60 }), type: "number", min: 0.001, step: 0.01, value: c.step, onChange: (e) => upd({ step: Number(e.target.value) }) }));
          }),
          h("div", { style: Object.assign({}, S.row, { marginTop: 4 }) },
            h("button", { style: S.btn, onClick: () => { if (onCfg) { for (let i = 0; i < nCh; i++) onCfg(i, { name: "", min: undefined, max: undefined, step: undefined }) } } }, "恢复默认"))) : null,

        Array.from({ length: nCh }).map((_, i) => {
          const c = get(i);
          return h("div", { key: i, style: Object.assign({}, S.panel, { marginBottom: 8 }) },
            h("div", { style: S.row },
              h("span", { style: { fontWeight: 600, minWidth: 82 } }, nameOf(i)),
              h("button", { style: S.btn, onClick: () => setVal(i, vals[i] - c.jump) }, "−"),
              h("input", { style: Object.assign({}, S.input, { width: 80, textAlign: "center" }), type: "number", value: vals[i], min: c.min, max: c.max, step: c.step, onChange: (e) => setVal(i, e.target.value) }),
              h("button", { style: S.btn, onClick: () => setVal(i, vals[i] + c.jump) }, "+"),
              h("input", { style: Object.assign({}, S.input, { flex: 1 }), type: "range", min: c.min, max: c.max, step: c.step, value: vals[i], onChange: (e) => setVal(i, e.target.value) }),
              h("button", { style: S.btnPrimary, onClick: () => onSend([i], [vals[i]]) }, "下发")));
        }),
        h("div", { style: S.row },
          h("button", { style: S.btnPrimary, onClick: () => onSend(Array.from({ length: nCh }, (_, i) => i), vals.slice(0, nCh)) }, "全部下发")),

        // 下发审计：每次点「下发」记一条（时间 / 通道=值 / 实际发出的帧字节）
        audit && audit.length ? h("div", { style: Object.assign({}, S.panel, { marginTop: 10 }) },
          h("div", { style: S.row },
            h("span", { style: { fontWeight: 600, fontSize: 13 } }, "下发审计（" + audit.length + " 条）"),
            h("span", { style: { flex: 1 } }),
            h("button", { style: S.btn, onClick: () => onAuditClear && onAuditClear() }, "清空")),
          h("div", { style: { maxHeight: 190, overflow: "auto", fontSize: 11, fontFamily: "monospace", lineHeight: 1.75, marginTop: 4 } },
            audit.map((a, k) => h("div", { key: k, style: { borderBottom: "1px solid #f0f2f5", padding: "2px 0", display: "flex", gap: 8 } },
              h("span", { style: { color: "#8a919e", flexShrink: 0 } }, fmtTime(a.t)),
              h("span", { style: { color: "#1f2328", flexShrink: 0, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, a.label),
              h("span", { style: { color: "#0b62d6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, "→ " + (a.hex || "-")))))) : null);
    }

    // ---------------- 主面板 ----------------
    function DevicePanel({ forceDock, forceFloat }) {
      const [cfg, setCfg] = useState(() => {
        const saved = loadCfg();
        const c = Object.assign({ mode: "wifi", transport: "tcp-server", host: "0.0.0.0", port: 8080, protocol: "json", channelCount: 7, com: "COM3", baud: 115200, dataBits: 8, stopBits: "One", parity: "None", flowControl: "None", fields: "L,R,GL,GR,Kp,Ki,Kd,ch", consoleAscii: false, consoleTimestamp: true, sendHex: false, autoSendMs: 0, scopeAuto: true, writeFormat: "follow", channelNames: ["左实际", "右实际", "左目标", "右目标", "Kp", "Ki", "Kd", "差速"], cfgVersion: 3 }, saved);
        // 迁移：旧版本(无 cfgVersion)默认通道数=2；若保存值仍为旧默认2，升到新默认7（配8参数单片机）
        if ((saved.cfgVersion || 0) < 2 && c.channelCount === 2) c.channelCount = 7;
        if (!saved.cfgVersion || saved.cfgVersion < 2) c.cfgVersion = 2;
        // 迁移 v3：通道名换成这台车的实际含义（只有仍是上一版默认名时才替换，保留用户自定义）
        if ((saved.cfgVersion || 0) < 3 && Array.isArray(c.channelNames) && c.channelNames[0] === "左轮Kp") {
          c.channelNames = ["左实际", "右实际", "左目标", "右目标", "Kp", "Ki", "Kd", "差速"];
        }
        if ((saved.cfgVersion || 0) < 3) c.cfgVersion = 3;
        return c;
      });
      const [status, setStatus] = useState(null);
      const [waves, setWaves] = useState([]);
      const [scopePaused, setScopePaused] = useState(false);   // 加载了本地数据后暂停实时刷新
      const scopePausedRef = useRef(false);
      const scopeFileRef = useRef(null);
      const [image, setImage] = useState(null);
      const [tab, setTab] = useState("console");
      const [ports, setPorts] = useState([]);
      const [portDesc, setPortDesc] = useState({});
      const [ips, setIps] = useState([]);
      const [recv, setRecv] = useState([]);
      const [recvCount, setRecvCount] = useState(0);
      const [sendCount, setSendCount] = useState(0);
      const [sendHistory, setSendHistory] = useState([]);
      const [sendText, setSendText] = useState("");
      const [audit, setAudit] = useState([]);   // 下发审计：最新在前，最多 100 条
      const [scopeEnabled, setScopeEnabled] = useState(Array.from({ length: 8 }, () => true));
      const [scopeView, setScopeView] = useState({ xLen: 100, xOffset: 0, yOffset: 0, auto: true });
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState(null);
      const [floatOn, setFloatOn] = useState(loadFloatOn);
      const [tuneFloat, setTuneFloat] = useState(false);   // 参数调试独立悬浮窗
      const [tuneCfg, setTuneCfg] = useState(loadTuneCfg); // 通道配置：命名/最小/最大/步进
      const setTuneCfgField = (i, patch) => setTuneCfg((c) => {
        const n = Object.assign({}, c);
        n[i] = Object.assign({}, n[i] || {}, patch);
        // 值为 undefined 的键直接删掉，回到内置默认
        Object.keys(n[i]).forEach((k) => { if (n[i][k] === undefined) delete n[i][k] });
        saveTuneCfg(n);
        return n;
      });
      const sendRef = useRef(null);
      const rgx = useRef({ recv: [], send: [] });

      const setCfgField = (k, v) => setCfg((c) => { const n = Object.assign({}, c, { [k]: v }); saveCfg(n); return n; });
      const setMode = (m) => setCfg((c) => { const n = Object.assign({}, c, { mode: m }); saveCfg(n); return n; });
      // text 协议：把界面上的字段串（逗号/空格分隔）解析成通道顺序表
      const textFields = () => {
        if (cfg.protocol !== "text") return null;
        const f = String(cfg.fields || "").split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
        return f.length ? f : null;
      };
      const makeConnectBody = () => {
        const f = textFields();
        const body = { protocol: cfg.protocol, channelCount: f ? f.length : cfg.channelCount };
        if (f) body.fields = f;
        if (cfg.mode === "serial") return Object.assign(body, { transport: "serial", com: cfg.com, baud: cfg.baud, dataBits: cfg.dataBits, parity: cfg.parity, stopBits: cfg.stopBits, flowControl: cfg.flowControl });
        return Object.assign(body, { transport: cfg.transport, host: cfg.host, port: cfg.port });
      };
      const loadPorts = () => { api("/seekfree-api/list-ports").then((r) => { if (r && r.ok) { setPorts(r.ports || []); setPortDesc((r && r.descriptions) || {}) } }).catch(() => { setPorts([]); setPortDesc({}) }) };
      const loadIps = () => { api("/seekfree-api/list-ips").then((r) => { if (r && r.ok) setIps(r.ips || []); }).catch(() => setIps([])) };
      const pushLog = (which, line) => { const a = rgx.current[which].concat([{ t: Date.now(), line }]); if (a.length > 50) a.shift(); rgx.current[which] = a; if (which === "send") setSendHistory(a.slice()) };

      useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const [p, cc] = await Promise.all([api("/seekfree-api/poll?n=500"), api("/seekfree-api/console?n=80")]);
            if (!alive) return;
            if (p.status) setStatus(p.status);
            if (p.waves && p.waves.length && !scopePausedRef.current) setWaves(p.waves);
            if (p.image) setImage(p.image);
            if (cc && cc.ok) { setRecv(cc.recv || []); setRecvCount(cc.recvCount || 0); setSendCount(cc.sendCount || 0); }
          } catch (e) { if (alive) setMsg("轮询失败: " + String(e)); }
        };
        tick();
        const id = setInterval(tick, 150);
        return () => { alive = false; clearInterval(id); };
      }, []);

      useEffect(() => { if (cfg.mode === "serial") loadPorts(); else loadIps(); }, [cfg.mode]);

      // 修暗色模式下原生 <option> 下拉弹层文字看不清：给面板内 option 设显式可读颜色（白底深字）
      useEffect(() => {
        const st = document.createElement("style");
        st.setAttribute("data-zf-option-style", "1");
        st.textContent = ".zf-assistant-panel option, .zf-assistant-panel select option { background-color:#ffffff !important; color:#111827 !important; }";
        document.head.appendChild(st);
        return () => { if (st.parentNode) st.parentNode.removeChild(st); };
      }, []);

      const connect = async () => { setBusy(true); setMsg(null); try { const r = await api("/seekfree-api/connect", makeConnectBody()); setMsg(r && r.ok ? (r.message || "已连接") : (r && r.message) || "连接失败"); } catch (e) { setMsg("连接失败: " + String(e)); } setBusy(false); };
      const disconnect = async () => { const r = await api("/seekfree-api/disconnect", {}); setMsg((r && r.message) || "已断开"); };
      const statusBtn = () => { api("/seekfree-api/status").then(setStatus); };

      const sendNow = async () => {
        const body = cfg.sendHex ? { data: sendText } : { text: sendText };
        try {
          const r = await api("/seekfree-api/send", body);
          if (r && r.ok) { setMsg(r.message || "已发送"); setSendCount((c) => c + (r.bytes || 0)); pushLog("send", (cfg.sendHex ? "[HEX] " : "") + sendText); }
          else setMsg((r && r.reason) || (r && r.message) || "发送失败");
        } catch (e) { setMsg("发送失败: " + String(e)); }
      };
      // 通道值下发，携带写入协议格式；成功时记一条审计（时间 / 通道=值 / 实际帧字节）
      const pushAudit = (ch, vals, hex) => {
        const label = ch.map((i, k) => ((chNames && chNames[i]) || "通道" + i) + "=" + vals[k]).join(", ");
        setAudit((a) => { const n = [{ t: Date.now(), label, hex: hex || "" }].concat(a); return n.length > 100 ? n.slice(0, 100) : n });
      };
      const sendChannels = (ch, vals) => api("/seekfree-api/send", { channels: ch, values: vals, format: cfg.writeFormat }).then((r) => {
        setMsg((r && r.message) || (r && r.reason) || "发送");
        if (r && r.ok) pushAudit(ch, vals, r.hex);
      }).catch((e) => setMsg("发送失败: " + String(e)));
      useEffect(() => { sendRef.current = sendNow; }, [sendText, cfg.sendHex, cfg.writeFormat]);

      useEffect(() => {
        if (!cfg.autoSendMs || cfg.autoSendMs <= 0) return;
        const id = setInterval(() => { try { sendRef.current && sendRef.current() } catch (e) {} }, cfg.autoSendMs);
        return () => clearInterval(id);
      }, [cfg.autoSendMs]);

      const clearRecv = () => { setRecv([]); setRecvCount(0); };
      const saveData = () => {
        const lines = recv.map((r) => (cfg.consoleTimestamp ? fmtTime(r.t) + "  " : "") + (cfg.consoleAscii ? asciiToStr(r.hex) : hexToStr(r.hex))).join("\n");
        const blob = new Blob([lines], { type: "text/plain" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "zf-recv.txt"; a.click();
      };
      const sendFile = (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { const bytes = Array.from(new Uint8Array(rd.result)); const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(""); api("/seekfree-api/send", { data: hex }).then((r) => setMsg((r && r.message) || "发送文件完成")); };
        rd.readAsArrayBuffer(f);
      };

      // 可观测性：字节在涨但解析帧数为 0 → 协议不匹配，直接在面板上说清楚
      // 宿主插件未重载时 status 里没有 feed，此时"缺失"不等于"0 帧"，不能据此报警
      const stStats = (status && status.stats) || {};
      const feedStats = (status && status.feed) || {};
      const hasFeed = typeof feedStats.parsed === "number";
      const isConnected = !!status && status.status === "connected";
      const samplesCount = stStats.totalSamples || 0;
      const bytesCount = stStats.totalBytes || 0;
      const parsedCount = hasFeed ? feedStats.parsed : 0;
      const parseErrCount = hasFeed ? (feedStats.errors || 0) : 0;
      const mismatch = isConnected && hasFeed && bytesCount > 0 && parsedCount === 0;
      // 通道名优先用后端 text 协议的实际字段顺序
      const chNames = (status && Array.isArray(status.fields) && status.fields.length) ? status.fields : (cfg.channelNames || []);
      // text 协议的通道数以字段顺序表为准，避免字段多于通道数时被截断
      const nCh = Math.max(1, Math.min(8, Math.max(Number(cfg.channelCount) || 1, cfg.protocol === "text" ? chNames.length : 0)));
      const badge = (text, color) => h("span", { style: { padding: "1px 8px", borderRadius: 10, fontSize: 12, background: color, color: "#fff" } }, text);

      /* ---- 示波器数据：保存为 CSV / 从 CSV 加载 ---- */
      const saveScopeData = () => {
        if (!waves.length) { setMsg("当前没有波形数据可保存"); return; }
        const head = "time," + Array.from({ length: nCh }, (_, i) => ((chNames && chNames[i]) || "ch" + i)).join(",");
        const rows = waves.map((w) => {
          const cols = Array.from({ length: nCh }, (_, i) => { const v = Number(w.ch && w.ch[i]); return Number.isFinite(v) ? v : 0; });
          return [w.t, ...cols].join(",");
        });
        const blob = new Blob([head + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "scope-" + new Date().toISOString().replace(/[:.]/g, "-") + ".csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        setMsg("已保存 " + waves.length + " 个采样点");
      };
      // 把导入的波形同步给后端，助手侧可用 mcu_scope_read 读同一份（失败不影响本地显示）
      const postScopeImport = (name, waves) => {
        fetch("/seekfree-api/scope/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name, waves: waves }),
        }).then((r) => r.json()).then((r) => {
          if (r && r.ok) setMsg("已加载 " + waves.length + " 个采样点，并已同步给助手（" + name + "）");
        }).catch(() => {});
      };
      const loadScopeData = (file) => {
        if (!file) return;
        const rd = new FileReader();
        rd.onload = () => {
          const text = String(rd.result || "");
          const lines = text.split(/\r?\n/).filter((s) => s.trim().length);
          if (lines.length < 2) { setMsg("文件为空，或不是「时间,通道...」格式的 CSV"); return; }
          const out = [];
          for (let i = 1; i < lines.length; i++) {
            const p = lines[i].split(",");
            const t = Number(p[0]);
            const ch = Array.from({ length: nCh }, (_, k) => { const v = Number(p[k + 1]); return Number.isFinite(v) ? v : 0; });
            out.push({ t: Number.isFinite(t) ? t : i, ch });
          }
          if (!out.length) { setMsg("没有解析出任何采样点"); return; }
          scopePausedRef.current = true;
          setScopePaused(true);
          setWaves(out);
          setMsg("已加载 " + out.length + " 个采样点，实时刷新已暂停");
          postScopeImport(file.name, out);
        };
        rd.onerror = () => setMsg("读取文件失败");
        rd.readAsText(file);
      };
      const stColor = status && ["connected", "listening"].includes(status.status) ? "#18794e" : (status && status.status === "error" ? "#b42318" : "#8a6d3b");

      const floatBar = forceDock ? null : h("div", { style: S.row },
        h("button", { style: floatOn ? S.btnPrimary : S.btn, onClick: () => { const n = !floatOn; setFloatOn(n); saveFloatOn(n) } }, floatOn ? "🪟 悬浮窗（点此停靠）" : "🪟 变成悬浮窗"),
        h("span", { style: S.mute }, floatOn ? "拖标题栏移动 · 右下角缩放 · 位置自动记忆" : "当前嵌在设置页里"));

      const configCard = h("div", { style: S.panel },
        h("div", { style: S.label }, "通信通道（串口 / WiFi）"),
        h("div", { style: S.row },
          h("button", { style: Object.assign({}, S.btn, { flex: 1, padding: "7px 12px", fontWeight: cfg.mode === "wifi" ? 600 : 400, borderColor: cfg.mode === "wifi" ? "#1d4ed8" : "#d4d8de", background: cfg.mode === "wifi" ? "#1d4ed8" : "transparent", color: cfg.mode === "wifi" ? "#ffffff" : "inherit" }), onClick: () => setMode("wifi") }, "📶 WiFi 通信"),
          h("button", { style: Object.assign({}, S.btn, { flex: 1, padding: "7px 12px", fontWeight: cfg.mode === "serial" ? 600 : 400, borderColor: cfg.mode === "serial" ? "#1d4ed8" : "#d4d8de", background: cfg.mode === "serial" ? "#1d4ed8" : "transparent", color: cfg.mode === "serial" ? "#ffffff" : "inherit" }), onClick: () => setMode("serial") }, "🔌 串口通信")),
        cfg.mode === "serial"
          ? h("div", { style: Object.assign({}, S.row, { marginTop: 8 }) },
              h("select", { style: S.sel, value: cfg.com, onChange: (e) => setCfgField("com", e.target.value) }, (ports.length ? ports : ["COM1"]).map((p) => h("option", { key: p, value: p }, portDesc[p] ? p + "（" + portDesc[p] + "）" : p))),
              h("select", { style: S.sel, value: cfg.baud, onChange: (e) => setCfgField("baud", Number(e.target.value)) }, [9600, 19200, 38400, 57600, 115200, 230400, 460800, 512000, 921600].map((b) => h("option", { key: b, value: b }, b))),
              h("select", { style: S.sel, value: cfg.dataBits, onChange: (e) => setCfgField("dataBits", Number(e.target.value)) }, [5, 6, 7, 8].map((b) => h("option", { key: b, value: b }, b))),
              h("select", { style: S.sel, value: cfg.stopBits, onChange: (e) => setCfgField("stopBits", e.target.value) }, [["One", "1"], ["OnePointFive", "1.5"], ["Two", "2"]].map(([v, l]) => h("option", { key: v, value: v }, l))),
              h("select", { style: S.sel, value: cfg.parity, onChange: (e) => setCfgField("parity", e.target.value) }, [["None", "无"], ["Odd", "奇校验"], ["Even", "偶校验"], ["Mark", "Mark"], ["Space", "Space"]].map(([v, l]) => h("option", { key: v, value: v }, l))),
              h("select", { style: S.sel, value: cfg.flowControl, onChange: (e) => setCfgField("flowControl", e.target.value) }, [["None", "无"], ["XOnXOff", "XOn/XOff"], ["RequestToSend", "RTS/CTS"], ["RequestToSendXOnXOff", "RTS/CTS + XOn/XOff"]].map(([v, l]) => h("option", { key: v, value: v }, l))),
              h("button", { style: S.btn, onClick: loadPorts }, "刷新串口"))
          : h("div", { style: Object.assign({}, S.row, { marginTop: 8 }) },
              h("select", { style: S.sel, value: cfg.transport, onChange: (e) => setCfgField("transport", e.target.value) }, [["tcp-server", "TCP Server"], ["tcp-client", "TCP Client"], ["udp", "UDP"]].map(([v, l]) => h("option", { key: v, value: v }, l))),
              h("select", { style: S.sel, value: cfg.host, onChange: (e) => setCfgField("host", e.target.value) }, (ips.some((x) => x.addr === cfg.host) ? ips : [{ addr: cfg.host, label: "" }].concat(ips)).map((x) => h("option", { key: x.addr, value: x.addr }, x.label ? x.addr + "（" + x.label + "）" : x.addr))),
              h("input", { style: Object.assign({}, S.input, { width: 80 }), type: "number", placeholder: "端口", value: cfg.port, onChange: (e) => setCfgField("port", Number(e.target.value)) })),
        h("div", { style: Object.assign({}, S.row, { marginTop: 8 }) },
          h("select", { style: S.sel, value: cfg.protocol, onChange: (e) => setCfgField("protocol", e.target.value) }, [["json", "JSON"], ["custom", "自定义二进制帧"], ["zf", "逐飞协议"], ["text", "文本键值行"]].map(([v, l]) => h("option", { key: v, value: v }, l))),
          h("select", { style: S.sel, value: cfg.writeFormat, onChange: (e) => setCfgField("writeFormat", e.target.value) }, [["follow", "写入:跟随接收"], ["json", "写入:JSON"], ["binary", "写入:二进制帧"]].map(([v, l]) => h("option", { key: v, value: v }, l))),
          h("input", { style: Object.assign({}, S.input, { width: 70 }), type: "number", placeholder: "通道", value: cfg.channelCount, onChange: (e) => setCfgField("channelCount", Number(e.target.value)) }),
          h("button", { style: S.btnPrimary, onClick: connect, disabled: busy }, "连接"),
          h("button", { style: S.btn, onClick: disconnect }, "断开"),
          h("button", { style: S.btn, onClick: statusBtn }, "状态")),
        cfg.protocol === "text" ? h("div", { style: Object.assign({}, S.row, { marginTop: 6 }) },
          h("span", { style: S.label }, "字段顺序"),
          h("input", { style: Object.assign({}, S.input, { flex: 1 }), placeholder: "如 L,R,GL,GR,Kp,Ki,Kd,ch", value: cfg.fields, onChange: (e) => setCfgField("fields", e.target.value) }),
          h("span", { style: S.mute }, "按此顺序命名示波器通道")) : null,
        h("div", { style: Object.assign({}, S.row, { marginTop: 4, flexWrap: "wrap" }) }, badge(status && status.status || "idle", stColor), h("span", { style: S.mute }, "  传输 " + (status && status.transport || "-") + " / " + (status && status.remote && status.remote.port ? status.remote.port : "") + " / 采样 " + samplesCount + " / 解析 " + (hasFeed ? parsedCount : "—") + (parseErrCount ? " / 失败 " + parseErrCount : "") + " / 字节 " + bytesCount)),
        mismatch ? h("div", { style: { color: "#b42318", fontSize: 12.5, marginTop: 2 } }, "⚠ 已收到 " + bytesCount + " 字节，但没有一帧被解析：当前协议「" + cfg.protocol + "」与设备数据不符。" + (cfg.protocol === "text" ? "请检查字段顺序与行格式。" : "若设备在 printf 键值行，请把协议切到「文本键值行」。")) : null,
        !hasFeed ? h("div", { style: { color: "#8a6d3b", fontSize: 12, marginTop: 2 } }, "宿主插件还是旧版本：拿不到解析统计，重启 DSH（退出后重开）才会生效。") : null,
        h("div", { style: { fontSize: 12.5, minHeight: 18, marginTop: 2 } }, msg || ""));

      const tabs = h("div", { style: S.row },
        h("button", { style: tab === "console" ? S.tabActive : S.tab, onClick: () => setTab("console") }, "串口助手"),
        h("button", { style: tab === "scope" ? S.tabActive : S.tab, onClick: () => setTab("scope") }, "示波器"),
        h("button", { style: tab === "image" ? S.tabActive : S.tab, onClick: () => setTab("image") }, "图像传输"),
        h("button", { style: tab === "tune" ? S.tabActive : S.tab, onClick: () => setTab("tune") }, "参数调试"));

      let content;
      if (tab === "console") {
        content = h("div", { style: Object.assign({}, S.card, { maxWidth: "none", width: "100%" }) },
          h("div", { style: S.panel },
            h("div", { style: S.row },
              h("label", { style: S.mute }, h("input", { type: "checkbox", checked: cfg.consoleAscii, onChange: (e) => setCfgField("consoleAscii", e.target.checked) }), " ASCII显示"),
              h("label", { style: S.mute }, h("input", { type: "checkbox", checked: cfg.consoleTimestamp, onChange: (e) => setCfgField("consoleTimestamp", e.target.checked) }), " 显示时间戳"),
              h("button", { style: S.btn, onClick: clearRecv }, "清除显示"),
              h("button", { style: S.btn, onClick: saveData }, "保存数据"),
              h("span", { style: S.mute }, "接收计数: " + recvCount)),
            h("div", { style: { maxHeight: 240, overflowY: "auto", marginTop: 8, fontSize: 11.5, lineHeight: 1.6, fontFamily: "monospace", border: "1px solid #d4d8de", borderRadius: 6, padding: 8 } },
              recv.length ? recv.map((r, i) => h("div", { key: i, style: { whiteSpace: "pre-wrap" } }, (cfg.consoleTimestamp ? fmtTime(r.t) + "  " : "") + (cfg.consoleAscii ? (r.text != null ? r.text : asciiToStr(r.hex)) : hexToStr(r.hex)))) : h("div", { style: S.mute }, "暂无接收数据"))),
          h("div", { style: S.panel },
            h("div", { style: S.row },
              h("label", { style: S.mute }, h("input", { type: "checkbox", checked: cfg.sendHex, onChange: (e) => setCfgField("sendHex", e.target.checked) }), " HEX发送"),
              h("label", { style: S.mute }, "周期(ms):"),
              h("input", { style: Object.assign({}, S.input, { width: 70 }), type: "number", value: cfg.autoSendMs, onChange: (e) => setCfgField("autoSendMs", Number(e.target.value)) }),
              h("label", { style: S.mute }, h("input", { type: "checkbox", checked: cfg.autoSendMs > 0, onChange: (e) => setCfgField("autoSendMs", e.target.checked ? 100 : 0) }), " 自动发送"),
              h("button", { style: S.btn, onClick: () => { setSendHistory([]); rgx.current.send = [] } }, "清除发送"),
              h("span", { style: S.mute }, "发送计数: " + sendCount),
              h("label", { style: S.mute }, h("input", { type: "file", style: { display: "none" }, onChange: sendFile }), "发送文件")),
            h("div", { style: Object.assign({}, S.row, { marginTop: 6 }) },
              h("input", { style: Object.assign({}, S.input, { flex: 1 }), placeholder: cfg.sendHex ? "HEX, 如 AA55" : "发送内容", value: sendText, onChange: (e) => setSendText(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") sendNow() } }),
              h("button", { style: S.btnPrimary, onClick: sendNow }, "发送")),
            h("div", { style: { maxHeight: 120, overflowY: "auto", marginTop: 6, fontSize: 11.5, lineHeight: 1.6, fontFamily: "monospace" } },
              sendHistory.length ? sendHistory.map((s, i) => h("div", { key: i }, s.line)) : h("div", { style: S.mute }, "发送历史（最多保留50条）"))));
      } else if (tab === "scope") {
        const lastVals = [];
        if (waves.length) for (let c = 0; c < nCh; c++) lastVals.push(Number(waves[waves.length - 1].ch[c]) || 0);
        const sv = scopeView || { xLen: 100, xOffset: 0, yOffset: 0, auto: true };
        const lk = sv.lock || {};
        const ar = scopeAutoRange(waves, scopeEnabled);
        const xLenNow = Math.max(1e-6, sv.xLen || 100);
        const x0Now = -xLenNow / 2 + (typeof sv.xOffset === "number" ? sv.xOffset : 0);
        const lkYLen = !!lk.yLen && typeof sv.yLen === "number" && sv.yLen > 0;
        const useAuto = sv.auto !== false && !lkYLen && !lk.y0;
        const yLenNow = useAuto ? ar.yLen : ((typeof sv.yLen === "number" && sv.yLen > 0) ? sv.yLen : ar.yLen);
        const y0Now = useAuto ? ar.y0 : (-yLenNow / 2 + (typeof sv.yOffset === "number" ? sv.yOffset : 0));
        const numOf = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
        const setX0 = (v) => { const n = numOf(v); if (n === null) return; setScopeView(Object.assign({}, sv, { auto: false, xOffset: n + xLenNow / 2 })); };
        const setXLen = (v) => { const n = numOf(v); if (n === null || n <= 0) return; setScopeView(Object.assign({}, sv, { auto: false, xLen: n, xOffset: x0Now + n / 2 })); };
        const setY0 = (v) => { const n = numOf(v); if (n === null) return; setScopeView(Object.assign({}, sv, { auto: false, yOffset: n + yLenNow / 2 })); };
        const setYLen = (v) => { const n = numOf(v); if (n === null || n <= 0) return; setScopeView(Object.assign({}, sv, { auto: false, yLen: n })); };
        const toggleLock = (key) => setScopeView(Object.assign({}, sv, { lock: Object.assign({}, lk, { [key]: !lk[key] }) }));
        const lockBtn = (key) => h("button", {
          title: lk[key] ? "已锁定（拖动/缩放不改这个值）" : "点击锁定这个值",
          style: { background: "none", border: "none", cursor: "pointer", padding: "0 3px", fontSize: 13, lineHeight: 1, opacity: lk[key] ? 1 : 0.38 },
          onClick: () => toggleLock(key)
        }, lk[key] ? "🔒" : "🔓");
        content = h("div", { style: Object.assign({}, S.card, { maxWidth: "none", width: "100%" }) },
          h(ScopeCanvas, { waves, enabled: scopeEnabled, view: scopeView, onChange: setScopeView }),
          h("div", { style: Object.assign({}, S.row, { marginTop: 4, gap: 6, flexWrap: "wrap" }) },
            h("span", { style: S.mute }, "X轴的起点:"), h("input", { style: Object.assign({}, S.input, { width: 110 }), type: "number", step: 1, value: Math.round(x0Now * 1000) / 1000, onChange: (e) => setX0(e.target.value) }), lockBtn("x0"),
            h("span", { style: S.mute }, "X轴的长度:"), h("input", { style: Object.assign({}, S.input, { width: 110 }), type: "number", step: 1, value: Math.round(xLenNow * 1000) / 1000, onChange: (e) => setXLen(e.target.value) }), lockBtn("xLen"),
            h("span", { style: { width: 12 } }),
            h("span", { style: S.mute }, "Y轴的起点:"), h("input", { style: Object.assign({}, S.input, { width: 110 }), type: "number", step: 0.1, value: Math.round(y0Now * 1000) / 1000, onChange: (e) => setY0(e.target.value) }), lockBtn("y0"),
            h("span", { style: S.mute }, "Y轴的长度:"), h("input", { style: Object.assign({}, S.input, { width: 110 }), type: "number", step: 0.1, value: Math.round(yLenNow * 1000) / 1000, onChange: (e) => setYLen(e.target.value) }), lockBtn("yLen")),
          h("div", { style: Object.assign({}, S.row, { marginTop: 4 }) },
            h("button", { style: S.btn, onClick: () => setScopeView({ xLen: 100, xOffset: 0, yOffset: 0, auto: false }) }, "显示全部"),
            h("button", { style: sv.auto !== false ? S.btnPrimary : S.btn, onClick: () => setScopeView({ xLen: 100, xOffset: 0, yOffset: 0, auto: true }) }, "自动跟随"),
            h("button", { style: S.btn, onClick: () => scopeFileRef.current && scopeFileRef.current.click() }, "加载数据"),
            h("button", { style: S.btn, onClick: saveScopeData }, "保存数据"),
            h("button", { style: S.btn, onClick: () => { setWaves([]); scopePausedRef.current = false; setScopePaused(false); } }, "清除波形"),
            h("input", {
              ref: scopeFileRef,
              type: "file",
              accept: ".csv,text/csv,text/plain",
              style: { display: "none" },
              onChange: (e) => { const f = e.target.files && e.target.files[0]; loadScopeData(f); e.target.value = ""; }
            }),
            scopePaused ? h("button", { style: S.btnPrimary, onClick: () => { scopePausedRef.current = false; setScopePaused(false); } }, "恢复实时") : null,
            h("span", { style: S.mute }, scopePaused ? "已暂停实时刷新（显示本地数据）" : (sv.auto !== false ? "滚轮整体缩放（以鼠标位置为中心）" : "手动视图（已缩放）· 点「自动跟随」恢复"))),
          h("div", { style: Object.assign({}, S.row, { marginTop: 6, alignItems: "center" }) },
            h("span", { style: S.label }, "通道开关"),
            Array.from({ length: nCh }).map((_, i) => {
              const on = scopeEnabled[i] !== false;
              const col = CH_COLORS[i % CH_COLORS.length];
              return h("button", {
                key: i,
                title: on ? "已开启：点击关闭，示波器不再显示该通道" : "已关闭：点击开启，示波器显示该通道",
                style: Object.assign({}, S.btn, {
                  display: "inline-flex", alignItems: "center", gap: 5,
                  minWidth: 76, padding: "5px 11px", borderRadius: 999,
                  background: on ? col : "#f2f4f7",
                  border: "1px solid " + (on ? col : "#dcdfe4"),
                  color: on ? "#ffffff" : "#98a2b3",
                  fontWeight: on ? 600 : 400,
                  opacity: on ? 1 : 0.9,
                  boxShadow: on ? "0 1px 4px " + col + "70" : "none",
                  transition: "background .15s ease, color .15s ease, border-color .15s ease, box-shadow .15s ease"
                }),
                onClick: () => setScopeEnabled((a) => { const c = a.slice(); c[i] = (c[i] === false); return c })
              }, h("span", { style: { fontSize: 11, lineHeight: 1 } }, on ? "●" : "○"), chNames[i] || "ch" + i);
            }),
            h("span", { style: Object.assign({}, S.mute, { marginLeft: 6 }) }, "通道数值:"),
            Array.from({ length: nCh }).map((_, i) => h("span", {
              key: i,
              style: {
                fontSize: 11, minWidth: 40,
                color: scopeEnabled[i] === false ? "#c6ccd6" : CH_COLORS[i % CH_COLORS.length],
                textDecoration: scopeEnabled[i] === false ? "line-through" : "none"
              }
            }, String(lastVals[i] || 0).slice(0, 8)))));
      } else if (tab === "image") {
        content = h(ImageView, { image, bytesCount });
      } else {
        content = h("div", null,
          h("div", { style: Object.assign({}, S.row, { marginBottom: 10 }) },
            h("button", { style: tuneFloat ? S.btnPrimary : S.btn, onClick: () => setTuneFloat((v) => !v) },
              tuneFloat ? "🪟 参数调试已是悬浮窗（点此关闭）" : "🪟 参数调试弹出为悬浮窗"),
            h("span", { style: S.mute }, "弹出后可在设备调试页上随意拖动、缩放")),
          h(TunePanel, { nCh, names: chNames, onSend: sendChannels, cfg: tuneCfg, onCfg: setTuneCfgField, audit: audit, onAuditClear: () => setAudit([]) }));
      }

      const panelBody = h("div", { style: Object.assign({}, S.card, { maxWidth: (forceDock || forceFloat || floatOn) ? "none" : 960, width: "100%", boxSizing: "border-box" }), className: "zf-assistant-panel" },
        h("div", null, h("h3", { style: { margin: "0 0 6px" } }, "设备调试（内置智能串口助手）")),
        floatBar,
        configCard,
        tabs,
        content);

      // 参数调试浮窗独立于主面板形态：主面板停靠在设置页时也要能弹出
      const tuneWin = tuneFloat ? h(FloatFrame, {
        title: "内置智能串口助手 · 参数调试",
        storageKey: "dsh-zf-assistant.floatbox.tune",
        z: 9100,
        onClose: () => setTuneFloat(false)
      }, h(TunePanel, { nCh, names: chNames, onSend: sendChannels, cfg: tuneCfg, onCfg: setTuneCfgField, audit: audit, onAuditClear: () => setAudit([]) })) : null;

      if (forceDock || !(forceFloat || floatOn)) return h("div", null, panelBody, tuneWin);
      return h("div", null,
        h(FloatFrame, { title: "内置智能串口助手 · 设备调试", onClose: () => { setFloatOn(false); saveFloatOn(false) } }, panelBody),
        tuneWin);
    }

    const name = "zf-assistant";
    const inject = ["slots", "layout"];   // layout 用于 selectPanel(null) 把主区切回会话
    function apply(ctx) {
      zfCtx = ctx;
      // [修复] 改走 slots.inject 惰性注册。
      // settings.section 由官方设置页的入口声明，声明时机晚于本插件客户端入口加载；
      // DSH 0.1.6 起槽位是严格 children-table 契约：声明缺席时 register 直接抛
      //   slot "settings.section" is not declared (a parent entry's children table must declare it)
      // 该错误被原来的 try/catch 静默吞掉（只留一行 console.warn）→「设备调试」面板整个消失。
      // inject 在声明已就绪时同步执行、否则挂在声明方 register 之后，加载顺序不再影响结果。
      // 与官方 dsh-client-ui-settings-* / dsh-at-file / quota-meter 的写法一致。
      ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register(
        { name: "settings.section", id: "zf-assistant", order: 80, label: () => "设备调试" },
        () => React.createElement(DevicePanel, {})
      )));

      // 侧边栏入口 + 主区页面（点左侧栏图标后在主区打开设备调试）
      ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register(
        { name: "sidebar.panellist", id: ZF_PANEL_ID, order: ZF_PANEL_ORDER, label: () => "设备调试" },
        ZfPanelIcon
      )));
      // 浮窗常驻在 shell.overlay：切页面不卸载
      ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register(
        { name: "shell.overlay", id: "zf-float-host", order: 90 },
        ZfFloatHost
      )));
      // 兜底：宿主若仍把主区切走，ZfMainPage 不渲染任何内容，只负责把浮窗打开
      ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register(
        { name: "main", key: ZF_PANEL_ID, inject: () => ({}) },
        ZfMainPage
      )));
    }

    module.exports = { name, inject, apply };
    return module.exports;
  },
});
