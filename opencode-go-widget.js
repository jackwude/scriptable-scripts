// opencode-go-widget.js — OpenCode Go 用量 iOS 桌面小组件 v1.1
// v1.1 (2026-08-31): 修复中号组件高度超限(172pt>158pt)导致标题/文字被切边；
//                    顺序改为 5H → 周 → 月；压缩字号与间距重算高度 ≤145pt
// 数据源：~/.hermes/scripts/opencode-go-widget-bridge.py 写入 iCloud 的 opencode-go-widget-data.json
//        （Mac sidecar 每 15 分钟抓 opencode.ai 用量 → iCloud 同步到 iPhone）
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
function loadData() {
  const fms = []
  try { fms.push(FileManager.iCloud()) } catch (e) {}
  fms.push(FileManager.local())
  for (const fm of fms) {
    try {
      const p = fm.joinPath(fm.documentsDirectory(), "opencode-go-widget-data.json")
      if (fm.fileExists(p)) {
        const obj = JSON.parse(fm.readString(p))
        if (obj && obj.meters) return obj
      }
    } catch (e) {}
  }
  return null
}

// ==================== 工具函数 ====================
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
  if (pct >= 85) return new Color("#ff453a")   // 红
  if (pct >= 50) return new Color("#ff9f0a")   // 橙
  return new Color("#30d158")                  // 绿
}

// ==================== 小组件渲染 ====================
// 高度账（中号上限 ~158pt，留安全余量）：
//   padding 12+10 + header 17 + 3行×(3+13+4+11) + footer 11 ≈ 145pt ✅
async function buildWidget(data) {
  const w = new ListWidget()
  const darkBg = new LinearGradient()
  darkBg.colors = [new Color("#1c1c1e"), new Color("#111113")]
  darkBg.locations = [0, 1]
  w.backgroundGradient = darkBg
  w.spacing = 0
  w.setPadding(12, 14, 10, 14)

  // ---- 标题行（14pt 防撑高） ----
  const header = w.addStack()
  const title = header.addText("OpenCode Go")
  title.font = Font.boldSystemFont(14)
  title.textColor = Color.white()
  header.addSpacer(null)
  if (data.updated_at) {
    const up = header.addText(data.updated_at.slice(5))  // MM-DD HH:MM
    up.font = Font.mediumSystemFont(9)
    up.textColor = new Color("#8e8e93")
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
    lb.textColor = new Color("#aeaeb2")
    top.addSpacer(null)
    const pv = top.addText(pct.toFixed(0) + "%")
    pv.font = Font.boldMonospacedSystemFont(12)
    pv.textColor = barColor(pct)
    w.addSpacer(3)

    // 进度条：底槽(暗) + fill(亮) + spacer
    const bar = w.addStack()
    bar.size = new Size(BAR_W, 4)
    bar.cornerRadius = 2
    bar.backgroundColor = new Color("#2c2c2e")
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
    st.textColor = m.status === "ok" ? barColor(pct) : new Color("#ff9f0a")
    const rt = bot.addText("重置 " + fmtReset(m.reset_in_sec))
    rt.font = Font.mediumSystemFont(9)
    rt.textColor = new Color("#8e8e93")
    w.addSpacer(5)
  }

  const foot = w.addStack()
  foot.addSpacer(null)
  const ft = foot.addText("状态 正常")
  ft.font = Font.mediumSystemFont(9)
  ft.textColor = new Color("#30d158")

  return w
}

// ==================== 入口 ====================
if (config.runsInWidget) {
  const data = loadData()
  if (!data) {
    const w = new ListWidget()
    w.addText("⚠️ 暂无数据")
    w.addText("请在 Mac 运行数据桥脚本")
    Script.setWidget(w)
  } else {
    Script.setWidget(await buildWidget(data))
  }
} else {
  await checkAndSelfUpdate()
  const data = loadData()
  const w = data ? await buildWidget(data) : null
  if (w) { await w.presentMedium() } else {
    const e = new Alert()
    e.title = "⚠️ 没有数据"
    e.message = "请先在 Mac 上运行：python3 ~/.hermes/scripts/opencode-go-widget-bridge.py\n（会抓用量并写入 iCloud，等同步后重试）"
    e.addAction("好")
    await e.presentAlert()
  }
}
Script.complete()