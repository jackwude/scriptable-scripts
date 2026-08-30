// 🍼 得宝一键记录 v1.5
// ============================================================
// 用法：
// 1. Scriptable 新建脚本，命名「baby-record」，粘贴本代码
// 2. 在喂奶小组件（中号）上点击「🍼 喂奶」「💦 尿了」「💩 拉了」「💊 AD」「🌡️ 体温」
//    会自动打开本脚本并完成记录
// 3. 也可以直接运行本脚本：无参数时弹出选择菜单
//
// URL scheme 参数（可选）：
//   type=feed   喂奶（可带 amount=215 直接指定奶量，否则弹动态菜单）
//   type=wet    尿了
//   type=dirty  拉了
//   type=ad     吃 AD
//   type=temp   体温（可带 temp=36.7 直接指定，否则弹动态档位）
//
// 需要权限：网络访问（首次运行 Scriptable 会弹窗询问）
// 记录写入 Supabase，与飞书群录入同一张表（source=scriptable）
//
// 自更新（v1.5）：手动运行（无 type 参数）时自动检查 GitHub
// 新版本并覆盖本地。按钮调用（带 type 参数）快速执行，跳过更新检查。
// 想关掉：SOURCE 改成空字符串 ""。
// ============================================================

const SOURCE = "https://raw.githubusercontent.com/jackwude/scriptable-scripts/main/baby-record.js"

async function checkAndSelfUpdate() {
  if (!SOURCE) return
  try {
    const req = new Request(SOURCE)
    req.timeoutInterval = 10
    const remote = await req.loadString()
    if (!remote || remote.startsWith("<")) return
    const fm = FileManager.iCloud().fileExists(module.filename)
      ? FileManager.iCloud() : FileManager.local()
    if (fm.readString(module.filename) === remote) return
    fm.writeString(module.filename, remote)
    const alert = new Alert()
    alert.title = "🍼 脚本已更新"
    alert.message = "已从 GitHub 下载新版本，请再运行一次。"
    alert.addAction("好")
    await alert.presentAlert()
    Script.exit()
  } catch (e) {
    // 静默失败，不影响使用
  }
}

const SUPABASE_URL = "https://elkcynbsoopvizmuevma.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVsa2N5bmJzb29wdml6bXVldm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NzU1OTksImV4cCI6MjA5MzE1MTU5OX0.LScczDOGWPPUNhnUEUk6l6AH_TrTO3OgwkOHaM48zuY"

const BJ_OFFSET = 8 * 60 * 60 * 1000  // 北京时间 = UTC + 8h

function nowBJ() {                    // 当前北京时间 ISO（+08:00）
  return new Date(Date.now() + BJ_OFFSET).toISOString().slice(0, 19) + "+08:00"
}
function nowHM() {                    // 当前北京时间 "HH:MM"
  return new Date(Date.now() + BJ_OFFSET).toISOString().slice(11, 16)
}

// ⚠️ 注意：URL scheme 参数优先级高于一切（type/amount 直接指定则跳过菜单）

async function fetchJSON(url, method, body) {
  const req = new Request(url)
  req.method = method || "GET"
  req.headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Prefer": "return=representation"
  }
  if (body) req.body = JSON.stringify(body)
  return await req.loadJSON()
}

// ---------- 写 Supabase ----------
async function post(table, data) {
  const url = SUPABASE_URL + "/rest/v1/" + table
  return await fetchJSON(url, "POST", data)
}

function sender() {
  return { source: "scriptable", sender_id: "scriptable", sender_name: "iPhone" }
}

// ---------- 菜单 ----------
async function chooseType() {
  const a = new Alert()
  a.title = "🍼 得宝记录"
  a.message = "选择要记录的内容："
  a.addAction("🍼 喂奶")
  a.addAction("💦 尿了")
  a.addAction("💩 拉了")
  a.addAction("💊 吃AD")
  a.addAction("🌡️ 体温")
  a.addCancelAction("取消")
  const idx = await a.presentAlert()
  return ["feed", "wet", "dirty", "ad", "temp"][idx]
}

// 动态奶量档位：拉最近 20 条配方奶记录，取最常喝的量（众数）→ [众数-10, 众数, 众数+10]
async function getAmountOptions() {
  const fallback = [150, 180, 200, 215]
  try {
    const url = SUPABASE_URL + "/rest/v1/feeding_records" +
      "?select=amount_ml&type=eq.formula&order=recorded_at.desc&limit=20"
    const rows = await fetchJSON(url)
    const amounts = rows.map(r => r.amount_ml).filter(v => typeof v === "number" && v > 0)
    if (amounts.length === 0) return fallback
    // 众数
    const freq = {}
    for (const v of amounts) freq[v] = (freq[v] || 0) + 1
    let mode = amounts[0], max = 0
    for (const k of Object.keys(freq)) {
      if (freq[k] > max) { max = freq[k]; mode = parseInt(k) }
    }
    return Array.from(new Set([mode - 10, mode, mode + 10])).sort((a, b) => a - b)
  } catch (e) {
    return fallback          // 网络失败用兜底档位
  }
}

async function chooseAmount() {
  const options = await getAmountOptions()
  const a = new Alert()
  a.title = "🍼 奶量（ml）"
  for (const v of options) {
    a.addAction(v + "ml")
  }
  a.addCancelAction("取消")
  const idx = await a.presentAlert()
  return options[idx]        // 取消返回 -1 → undefined，上层会退出
}

// 动态体温档位：拉最近 10 条体温，取最近一次为中心，±0.2、步进 0.1
async function getTempOptions() {
  const fallback = [36.5, 36.6, 36.7, 36.8, 36.9]
  try {
    const url = SUPABASE_URL + "/rest/v1/temperature_records" +
      "?select=temperature_c&order=recorded_at.desc&limit=10"
    const rows = await fetchJSON(url)
    const temps = rows.map(r => r.temperature_c).filter(v => typeof v === "number" && v > 30 && v < 42)
    if (temps.length === 0) return fallback
    const base = Math.round(temps[0] * 10) / 10   // 最近一次体温，1 位小数
    return [base - 0.2, base - 0.1, base, base + 0.1, base + 0.2]
  } catch (e) {
    return fallback
  }
}

async function chooseTemp() {
  const options = await getTempOptions()
  const a = new Alert()
  a.title = "🌡️ 体温（℃）"
  for (const v of options) {
    a.addAction(v.toFixed(1) + "℃")
  }
  a.addCancelAction("取消")
  const idx = await a.presentAlert()
  return options[idx]
}

// ---------- 记录并确认 ----------
async function record(type, amount, temp) {
  const ts = nowBJ()
  const hm = nowHM()
  let table, data, label
  if (type === "feed") {
    table = "feeding_records"
    data = Object.assign({ type: "formula", amount_ml: amount, recorded_at: ts }, sender())
    label = "🍼 紫白金一段 " + amount + "ml"
  } else if (type === "wet") {
    table = "diaper_records"
    data = Object.assign({ type: "wet", amount: 1, recorded_at: ts }, sender())
    label = "💦 尿了"
  } else if (type === "dirty") {
    table = "diaper_records"
    data = Object.assign({ type: "dirty", amount: 1, recorded_at: ts }, sender())
    label = "💩 拉了"
  } else if (type === "ad") {
    table = "ad_records"
    data = Object.assign({ recorded_at: ts }, sender())
    label = "💊 吃了维生素AD"
  } else if (type === "temp") {
    table = "temperature_records"
    data = Object.assign({ temperature_c: temp, recorded_at: ts }, sender())
    label = "🌡️ 体温 " + temp.toFixed(1) + "℃"
  } else {
    return "❌ 未知类型"
  }

  let resp
  try {
    resp = await post(table, data)
  } catch (e) {
    return "❌ 写入失败：" + e.message
  }
  const ok = Array.isArray(resp) && resp.length > 0 && resp[0].id
  return ok ? "✅ " + label + " · " + hm : "❌ 写入失败，未返回 id"
}

// ---------- 主流程 ----------
async function main() {
  const params = args.queryParameters || {}
  let type = (params.type || "").toLowerCase()
  let amount = parseInt(params.amount)
  let temp = params.temp ? parseFloat(params.temp) : NaN

  // 按钮调用（带 type 参数）→ 直接快速执行，跳过自更新
  // 手动运行（无参数）→ 先检查 GitHub 更新
  if (!type) {
    await checkAndSelfUpdate()
    type = await chooseType()
    if (!type) return
  }
  if (type === "feed" && (!amount || isNaN(amount))) {
    amount = await chooseAmount()
    if (!amount) return
  }
  if (type === "temp" && isNaN(temp)) {
    temp = await chooseTemp()
    if (temp === undefined) return
  }

  const msg = await record(type, amount, temp)
  const a = new Alert()
  a.title = "得宝记录"
  a.message = msg
  a.addAction("好")
  await a.presentAlert()
}

await main()
Script.complete()