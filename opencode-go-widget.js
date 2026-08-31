// opencode-go-widget.js — OpenCode Go 用量 iOS 桌面小组件 v1.3
// v1.3 (2026-08-31): 明暗模式自适应(Color.dynamic, 对齐 baby widget 规范)；
//                    refreshAfterDate 10min 匹配数据源频率(watch 哨兵 10min 写 JSON)
// v1.2 (2026-08-31): 修复 iPhone 读不到 iCloud 数据 → 读前先 downloadFileFromiCloud
//                    (Mac 每次覆盖写入后 iPhone 端文件变云端占位符, readString 直接报错)
// v1.1 (2026-08-31): 修复中号组件高度超限(172pt>158pt)导致标题/文字被切边；
//                    顺序改为 5H → 周 → 月；压缩字号与间距重算高度 ≤145pt
// 数据源：~/.hermes/scripts/opencode-go-usage-card.py --watch 每次抓取顺带写入
//        iCloud 的 opencode-go-widget-data.json（Mac sidecar 每 10 分钟）
// 用法：Scriptable 添加小组件，选择本脚本，中号(medium)；或 App 内运行预览
// 权限：无（只读 iCloud 文件）

const SOURCE = "https://raw.githubusercontent.com/jackwude/scriptable-scripts/main/opencode-go-widget.js"

// ==================== 自更新（仅 App 内运行，小组件不联网） ====================
async function checkAndSelfUpdate() {
  if (!SOURCE) return
  try {
    const req = new Request(SOURCE)
    req.timeoutInterval = 10
    const remote = await req.loadString()
    if (!remote || remote.startsWith("<")) return   // HTML = 链接错
    const fm = FileManager.iCloud().fileExists(module.filename)
      ? FileManager.iCloud() : FileManager.local()
    if (fm.readString(module.filename) === remote) return
    fm.writeString(module.filename, remote)
    const alert = new Alert()
    alert.title = "📊 OpenCode Go 小组件已更新"
    alert.message = "已从 GitHub 下载新版本，请再运行一次。"
    alert.addAction("好")
    await alert.presentAlert()
    Script.exit()
  } catch (e) { /* 静默失败 */ }
}

// ==================== 读数据（iCloud 优先，本地兜底） ====================
// v1.2: 必须先 downloadFileFromiCloud —— Mac 每次覆盖写入后，iPhone 端文件
// 变成"云端占位符(未下载)"，直接 readString 会报错导致 loadData 返回 null。
// 官方：downloadFileFromiCloud 对本地文件也安全，可无条件调用。
async function loadData() {
  const fms = []
  try { fms.push(FileManager.iCloud()) } catch (e) {}
  fms.push(FileManager.local())
  for (const fm of fms) {
    try {
      const p = fm.joinPath(fm.documentsDirectory(), "opencode-go-widget-data.json")
      if (fm.fileExists(p)) {
        if (fm.downloadFileFromiCloud) {
          await fm.downloadFileFromiCloud(p)
        }
        const obj = JSON.parse(fm.readString(p))
        if (obj && obj.meters) return obj
      }
    } catch (e) {}
  }
  return null
}

// ==================== 工具函数 ====================
// 明暗自适应（v1.3，对齐 baby-feeding-widget 规范：Color.dynamic(亮,暗)）
const C = {
  bg:      Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E")),
  title:   Color.dynamic(new Color("#111111"), Color.white()),
  sub:     Color.dynamic(new Color("#8E8E93"), new Color("#8E8E93")),
  sub2:    Color.dynamic(new Color("#6C6C70"), new Color("#AEAEB2")),
  track:   Color.dynamic(new Color("#DDE1E8"), new Color("#2C2C2E")),
  ok:      Color.dynamic(new Color("#248A3D"), new Color("#30D158")),
}

function fmtReset(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  if (sec >= 86400) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600)
    return d + "天" + h + "小时"
  }
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
    return h + "小时" + m + "分"
  }
  const m = Math.floor(sec / 60)
  return m > 0 ? m + "分钟" : "即将重置"
}

function barColor(pct) {
  // 明暗两套：亮模式用深色系保证对比度，暗模式用 iOS 亮色
  if (pct >= 85) return Color.dynamic(new Color("#D70015"), new Color("#FF453A"))   // 红
  if (pct >= 50) return Color.dynamic(new Color("#C93400"), new Color("#FF9F0A"))   // 橙
  return Color.dynamic(new Color("#248A3D"), new Color("#30D158"))                  // 绿
}

// ==================== 小组件渲染 ====================
// 高度账（中号上限 ~158pt，留安全余量）：
//   padding 12+10 + header 17 + 3行×(3+13+4+11) + footer 11 ≈ 145pt ✅
async function buildWidget(data) {
  const w = new ListWidget()
  w.backgroundColor = C.bg                    // v1.3 明暗自适应
  w.spacing = 0
  w.setPadding(12, 14, 10, 14)

  // ---- 标题行（14pt 防撑高） ----
  const header = w.addStack()
  const title = header.addText("OpenCode Go")
  title.font = Font.boldSystemFont(14)
  title.textColor = C.title
  header.addSpacer(null)
  if (data.updated_at) {
    const up = header.addText(data.updated_at.slice(5))  // MM-DD HH:MM
    up.font = Font.mediumSystemFont(9)
    up.textColor = C.sub
  }
  w.addSpacer(6)

  // 顺序：5H → 周 → 月（用户指定 2026-08-31）
  const rows = [
    { key: "rollingUsage", label: "5H" },
    { key: "weeklyUsage",  label: "周" },
    { key: "monthlyUsage", label: "月" },
  ]

  // 进度条固定基准宽（中号内宽 ~306 - padding 28）
  const BAR_W = 240

  for (const r of rows) {
    const m = data.meters[r.key]
    if (!m) continue
    const pct = Math.min(100, Math.max(0, m.percent))

    // 上行：label + 百分比（11/12pt）
    const top = w.addStack()
    const lb = top.addText(r.label)
    lb.font = Font.mediumSystemFont(11)
    lb.textColor = C.sub2
    top.addSpacer(null)
    const pv = top.addText(pct.toFixed(0) + "%")
    pv.font = Font.boldMonospacedSystemFont(12)
    pv.textColor = barColor(pct)
    w.addSpacer(3)

    // 进度条：底槽(暗) + fill(亮) + spacer
    const bar = w.addStack()
    bar.size = new Size(BAR_W, 4)
    bar.cornerRadius = 2
    bar.backgroundColor = C.track
    const fill = bar.addStack()
    fill.size = new Size(Math.max(3, Math.round(BAR_W * pct / 100)), 4)
    fill.cornerRadius = 2
    fill.backgroundColor = barColor(pct)
    bar.addSpacer(null)
    w.addSpacer(3)

    // 下行：状态点 + 剩余时间（9pt 右对齐）
    const bot = w.addStack()
    bot.addSpacer(null)
    const st = bot.addText("● ")
    st.font = Font.mediumSystemFont(9)
    st.textColor = m.status === "ok" ? barColor(pct) : C.sub2
    const rt = bot.addText("重置 " + fmtReset(m.reset_in_sec))
    rt.font = Font.mediumSystemFont(9)
    rt.textColor = C.sub
    w.addSpacer(5)
  }

  const foot = w.addStack()
  foot.addSpacer(null)
  const ft = foot.addText("状态 正常")
  ft.font = Font.mediumSystemFont(9)
  ft.textColor = C.ok

  // v1.3：请求 10 分钟刷新，匹配数据源频率（iOS 按此尽早调度，实际时机由系统决定）
  w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000)

  return w
}

// ==================== 入口 ====================
if (config.runsInWidget) {
  const data = await loadData()
  if (!data) {
    const w = new ListWidget()
    w.addText("⚠️ 暂无数据")
    w.addText("等待 iCloud 同步…")
    Script.setWidget(w)
  } else {
    Script.setWidget(await buildWidget(data))
  }
} else {
  await checkAndSelfUpdate()
  const data = await loadData()
  const w = data ? await buildWidget(data) : null
  if (w) { await w.presentMedium() } else {
    const e = new Alert()
    e.title = "⚠️ 没有数据"
    e.message = "iCloud 里还没同步到数据文件。\n请确认 Mac 端 watch 哨兵正常（每 10 分钟写 JSON 到 iCloud Scriptable 目录）。"
    e.addAction("好")
    await e.presentAlert()
  }
}
Script.complete()