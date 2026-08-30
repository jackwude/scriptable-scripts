// 🍼 得宝喂奶小组件 v3.3（支持 GitHub 自更新）
// ============================================================
// 用法：
// 1. iPhone 安装 Scriptable App
// 2. 新建脚本 → 粘贴本代码 → 命名（如"喂奶小组件"）
// 3. 桌面添加 Scriptable 小组件（小/中/大均可），选本脚本
// 4. 锁屏编辑 → 添加 Scriptable 圆形小组件，选本脚本
//
// 需要权限：
// - 网络访问（首次运行 Scriptable 会弹窗询问，允许即可）
// - 无其他权限。数据只读，不写入任何东西。
//
// 自更新（v2.0 新增）：
// - 在 Scriptable App 内运行时自动检查 GitHub 仓库新版本，
//   有更新则覆盖本地脚本并提示重新运行。之后不用再手动复制代码。
// - 小组件刷新路径不联网（config.runsInWidget 直接跳过），
//   锁屏/桌面小组件永远用本地已存代码，不会因网络请求白屏。
// - 想关掉更新：把 SOURCE 改成空字符串 "" 即可。
//
// 刷新：脚本请求 1 分钟刷新一次（iOS 实际由系统调度，不保证精确）；
//        打开 Scriptable App 运行一次可立即刷新。
//
// 点击跳转（v2.4 新增）：
// - 中/大号：顶部「距上次喂奶」和「最近记录」区域 → 打开 baby-tracker
// - 小号：整卡 → 打开 baby-tracker
// - 锁屏：不设跳转（防误触）；底部「更新时间」不参与跳转
// ============================================================

// ---------- GitHub 自更新（仅在 App 内运行时检查） ----------
const SOURCE = "https://raw.githubusercontent.com/jackwude/scriptable-scripts/main/baby-feeding-widget.js"

async function checkAndSelfUpdate() {
  if (!SOURCE || config.runsInWidget) return   // 小组件路径不联网
  try {
    const req = new Request(SOURCE)
    req.timeoutInterval = 10
    const remote = await req.loadString()
    if (!remote || remote.startsWith("<")) return  // 远程返回 HTML = 链接错了，不写入
    const fm = FileManager.iCloud().fileExists(module.filename)
      ? FileManager.iCloud() : FileManager.local()
    if (fm.readString(module.filename) === remote) return  // 无变化
    fm.writeString(module.filename, remote)      // 覆盖自己
    const alert = new Alert()
    alert.title = "🍼 脚本已更新"
    alert.message = "已从 GitHub 下载新版本，请再运行一次。"
    alert.addAction("好")
    await alert.presentAlert()
    Script.exit()                                 // 退出，下次运行就是新代码
  } catch (e) {
    // 网络失败静默跳过，不影响正常使用
  }
}

const SUPABASE_URL = "https://elkcynbsoopvizmuevma.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVsa2N5bmJzb29wdml6bXVldm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NzU1OTksImV4cCI6MjA5MzE1MTU5OX0.LScczDOGWPPUNhnUEUk6l6AH_TrTO3OgwkOHaM48zuY"

const BJ_OFFSET = 8 * 60 * 60 * 1000  // 北京时间 = UTC + 8h
const LIMIT = 50                      // 拉 50 条足够今日统计 + 最近列表
const TRACKER_URL = "https://debao.indevs.in"  // 点击跳转的 baby-tracker 网页

// ---------- 北京时间工具 ----------
function bjTime(ts) {                 // 时间戳 → "HH:MM"（北京时间）
  return new Date(ts + BJ_OFFSET).toISOString().slice(11, 16)
}
function bjDay(ts) {                  // 时间戳 → "YYYY-MM-DD"（北京时间）
  return new Date(ts + BJ_OFFSET).toISOString().slice(0, 10)
}

// ---------- 状态颜色（对齐前端：2.5h绿 / 3h黄 / 3.5h橙 / 超3.5h红） ----------
function statusColor(mins) {
  if (mins < 150) return Color.green()
  if (mins < 180) return new Color("#F9A825")
  if (mins < 210) return Color.orange()
  return Color.red()
}
function fmtElapsed(mins) {           // 分钟 → "42分钟" / "3小时07分" / "1天3小时"
  if (mins < 60) return mins + "分钟"
  const h = Math.floor(mins / 60), m = mins % 60
  if (h < 24) return h + "小时" + (m > 0 ? String(m).padStart(2, "0") + "分" : "")
  return Math.floor(h / 24) + "天" + (h % 24) + "小时"
}
function fmtElapsedShort(mins) {      // 锁屏/条形紧凑版 → "42m" / "3h07m"
  if (mins < 60) return mins + "m"
  const h = Math.floor(mins / 60), m = mins % 60
  if (h < 24) return h + "h" + String(m).padStart(2, "0") + "m"
  return Math.floor(h / 24) + "d" + (h % 24) + "h"
}

// ---------- 拉数据 ----------
async function fetchFeeds() {
  const url = SUPABASE_URL + "/rest/v1/feeding_records" +
    "?select=amount_ml,recorded_at&order=recorded_at.desc&limit=" + LIMIT
  const req = new Request(url)
  req.headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Accept": "application/json"
  }
  return await req.loadJSON()         // [{amount_ml, recorded_at}, ...]
}

// 拉最新体重（进度条目标用：150ml/kg/天）
async function fetchLatestWeight() {
  const url = SUPABASE_URL + "/rest/v1/weight_records" +
    "?select=weight_g&order=recorded_at.desc&limit=1"
  const req = new Request(url)
  req.headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Accept": "application/json"
  }
  const rows = await req.loadJSON()
  return rows.length > 0 && rows[0].weight_g ? rows[0].weight_g : null
}

// ---------- 汇总 ----------
function summarize(feeds) {
  const now = Date.now()
  const today = bjDay(now)
  let todayMl = 0, todayCount = 0
  let list = []                       // 前 5 条：{time, ml}
  for (const f of feeds) {
    const ts = Date.parse(f.recorded_at)
    const day = bjDay(ts)
    if (day === today) {
      todayMl += f.amount_ml || 0
      todayCount++
    }
    if (list.length < 5) list.push({ time: bjTime(ts), ml: f.amount_ml || 0, ts })
  }
  const last = feeds.length > 0 ? feeds[0] : null
  const lastTs = last ? Date.parse(last.recorded_at) : null
  return {
    todayMl, todayCount, list,
    hasData: feeds.length > 0,
    lastTime: lastTs ? bjTime(lastTs) : "--:--",
    lastMl: last ? last.amount_ml || 0 : 0,
    lastMins: lastTs ? Math.round((now - lastTs) / 60000) : -1,
    lastDay: lastTs ? bjDay(lastTs) : null,
    today: today,
    updatedAt: bjTime(now)            // 本次渲染/拉数据时间（北京时间）
  }
}

// ---------- 渲染 ----------
function addQuickButton(parent, label, type) {   // 快捷记录按钮（中间件样式）
  const btn = parent.addStack()
  btn.backgroundColor = Color.dynamic(new Color("#EEF0F6"), new Color("#2C2C2E"))
  btn.cornerRadius = 8
  btn.setPadding(7, 12, 7, 12)
  btn.url = "scriptable:///run/baby-record?type=" + type
  const t = btn.addText(label)
  t.font = Font.mediumSystemFont(13)
  t.textColor = Color.dynamic(new Color("#111111"), Color.white())
  return btn
}

function renderWidget(s) {
  const w = new ListWidget()
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"))
  w.setPadding(10, 12, 10, 12)

  if (!s.hasData) {
    w.addText("⚠️ 暂无喂奶数据").font = Font.mediumSystemFont(14)
    w.addText("请检查网络/Supabase").font = Font.systemFont(11)
    w.textColor = Color.gray()
    return w
  }
  const color = statusColor(s.lastMins)

  // 顶部行：标题 + 上次明细 + 距上次喂奶（合并成一行，点击 → baby-tracker）
  const top = w.addStack()
  top.layoutHorizontally()
  top.centerAlignContent()
  top.url = TRACKER_URL
  const sym = SFSymbol.named("cup.and.saucer.fill")
  sym.applyMediumWeight()
  const icon = top.addImage(sym.image)
  icon.imageSize = new Size(14, 14)
  icon.tintColor = color
  top.addSpacer(5)
  const t1 = top.addText("上次喂奶")
  t1.font = Font.mediumSystemFont(13)
  t1.textColor = Color.dynamic(new Color("#111111"), Color.white())
  top.addSpacer(5)
  const d1 = top.addText(s.lastTime + " · " + s.lastMl + "ml" + (s.lastDay !== s.today ? "（昨天）" : ""))
  d1.font = Font.systemFont(11)
  d1.textColor = Color.gray()
  top.addSpacer(null)
  const e1 = top.addText(s.lastMins >= 0 ? fmtElapsed(s.lastMins) : "--")
  e1.font = Font.boldSystemFont(22)
  e1.textColor = color
  w.addSpacer(6)

  // 单张全宽卡：上=两列头，中=全宽进度条，下=明细行（空间全利用）
  const card = w.addStack()
  card.layoutVertically()
  card.backgroundColor = Color.dynamic(new Color("#F2F4F8"), new Color("#2A2C31"))
  card.cornerRadius = 10
  card.setPadding(8, 10, 8, 10)

  const cardText = Color.dynamic(new Color("#111111"), Color.white())
  const cardSub = Color.gray()

  // 第一行：左=今日奶量，右=今日次数
  const head = card.addStack()
  head.layoutHorizontally()
  const colA = head.addStack()
  colA.layoutVertically()
  const c1t = colA.addText("今日奶量")
  c1t.font = Font.systemFont(10)
  c1t.textColor = cardSub
  const c1v = colA.addText(s.todayMl + "ml")
  c1v.font = Font.boldSystemFont(18)
  c1v.textColor = cardText
  head.addSpacer(null)
  const colB = head.addStack()
  colB.layoutVertically()
  const c2t = colB.addText("今日次数")
  c2t.font = Font.systemFont(10)
  c2t.textColor = cardSub
  const c2v = colB.addText(s.todayCount + " 次")
  c2v.font = Font.boldSystemFont(18)
  c2v.textColor = cardText

  card.addSpacer(5)

  // 全宽进度条：目标 = 体重kg × 150ml/kg（WHO 中间值）
  if (s.weightG) {
    const target = Math.round((s.weightG / 1000) * 150)
    const pct = Math.min(1, s.todayMl / target)
    const bar = card.addStack()
    bar.layoutHorizontally()
    bar.cornerRadius = 3
    bar.backgroundColor = Color.dynamic(new Color("#DDE1E8"), new Color("#3A3D44"))
    bar.size = new Size(280, 6)       // 近全宽底槽（中号卡内部约290pt）
    // 🔴 fill 在 spacer 前：已喝（亮色）在左，未喝（底槽）在右
    const fill = bar.addStack()
    fill.backgroundColor = pct >= 1 ? Color.green() : color
    fill.cornerRadius = 3
    fill.size = new Size(Math.round(280 * pct), 6)
    bar.addSpacer(null)
    card.addSpacer(3)
    // 明细行：左=进度数值，右=间隔（填满底部空间）
    const capRow = card.addStack()
    capRow.layoutHorizontally()
    const cap = capRow.addText(s.todayMl + " / " + target + "ml")
    cap.font = Font.systemFont(9)
    cap.textColor = cardSub
    capRow.addSpacer(null)
    const itv = capRow.addText(s.todayCount > 0 ? "间隔约 " + fmtElapsed(Math.round(1440 / s.todayCount)) : "还没有记录")
    itv.font = Font.systemFont(9)
    itv.textColor = cardSub
  }
  w.addSpacer(6)

  // 快捷记录行（点击 → 打开 baby-record 脚本一键入库）
  const quickRow = w.addStack()
  quickRow.layoutHorizontally()
  quickRow.addSpacer(null)
  addQuickButton(quickRow, "🍼 喂奶", "feed")
  quickRow.addSpacer(6)
  addQuickButton(quickRow, "💦 尿了", "wet")
  quickRow.addSpacer(6)
  addQuickButton(quickRow, "💩 拉了", "dirty")
  quickRow.addSpacer(6)
  addQuickButton(quickRow, "💊 AD", "ad")
  quickRow.addSpacer(null)
  w.addSpacer(4)

  // 底部提示 + 更新时间
  w.addSpacer(null)
  const footRow = w.addStack()
  footRow.layoutHorizontally()
  const foot = footRow.addText(s.lastMins >= 210 ? "🍼 该喂奶啦" : s.lastMins >= 180 ? "⏰ 快到时间了" : "")
  foot.font = Font.systemFont(10)
  foot.textColor = color
  footRow.addSpacer(null)
  const upd = footRow.addText("更新 " + s.updatedAt)
  upd.font = Font.systemFont(9)
  upd.textColor = Color.gray()

  w.refreshAfterDate = new Date(Date.now() + 60 * 1000)
  return w
}

function renderSmall(s) {
  const w = new ListWidget()
  w.backgroundColor = Color.dynamic(new Color("#FFFFFF"), new Color("#1C1C1E"))
  w.setPadding(12, 12, 12, 12)
  if (!s.hasData) {
    w.addText("⚠️ 暂无数据").font = Font.mediumSystemFont(13)
    return w
  }
  const color = statusColor(s.lastMins)
  w.url = TRACKER_URL
  const e = w.addText(s.lastMins >= 0 ? fmtElapsed(s.lastMins) : "--")
  e.font = Font.boldSystemFont(30)
  e.textColor = color
  const d = w.addText("上次 " + s.lastTime + " · " + s.lastMl + "ml")
  d.font = Font.systemFont(11)
  d.textColor = Color.gray()
  w.addSpacer(4)
  const t = w.addText("今日 " + s.todayMl + "ml · " + s.todayCount + "次")
  t.font = Font.systemFont(12)
  t.textColor = Color.dynamic(new Color("#111111"), Color.white())
  w.addSpacer(null)
  const upd = w.addText("更新 " + s.updatedAt)
  upd.font = Font.systemFont(10)
  upd.textColor = Color.gray()
  w.refreshAfterDate = new Date(Date.now() + 60 * 1000)
  return w
}

function renderCircular(s) {
  const w = new ListWidget()
  const color = statusColor(s.lastMins)
  const stack = w.addStack()
  stack.layoutVertically()
  stack.centerAlignContent()
  const e = stack.addText(s.hasData && s.lastMins >= 0 ? fmtElapsedShort(s.lastMins) : "--")
  e.font = Font.boldSystemFont(16)
  e.textColor = color
  const d = stack.addText("距喂奶")
  d.font = Font.systemFont(9)
  d.textColor = Color.dynamic(new Color("#333333"), new Color("#CCCCCC"))
  return w
}

function renderInline(s) {
  const w = new ListWidget()
  const color = statusColor(s.lastMins)
  if (!s.hasData) {
    w.addText("🍼 暂无数据").textColor = color
    return w
  }
  const t = w.addText("🍼 " + s.lastTime + " · " + fmtElapsedShort(s.lastMins))
  t.textColor = color
  return w
}

// ---------- 主流程 ----------
async function main() {
  let feeds = []
  let weightG = null
  try {
    feeds = await fetchFeeds()
  } catch (err) {
    const w = new ListWidget()
    w.addText("⚠️ 加载失败").font = Font.mediumSystemFont(13)
    w.addText("请检查网络后重试").font = Font.systemFont(10)
    w.textColor = Color.red()
    return w
  }
  try { weightG = await fetchLatestWeight() } catch (e) { weightG = null }
  const s = summarize(feeds)
  s.weightG = weightG
  const family = config.widgetFamily || "medium"
  if (family === "accessoryCircular") return renderCircular(s)
  if (family === "accessoryInline") return renderInline(s)
  if (family === "small") return renderSmall(s)
  return renderWidget(s)              // medium / large 共用
}

await checkAndSelfUpdate()            // 自更新检查（仅 App 内，小组件跳过）
const widget = await main()
if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentMedium()
}
Script.complete()