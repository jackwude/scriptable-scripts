// 🍼 得宝一键记录 v1.0
// ============================================================
// 用法：
// 1. Scriptable 新建脚本，命名「baby-record」，粘贴本代码
// 2. 在喂奶小组件（中号）上点击「🍼 喂奶」「💩 尿了」「💊 AD」
//    会自动打开本脚本并完成记录
// 3. 也可以直接运行本脚本：无参数时弹出选择菜单
//
// URL scheme 参数（可选）：
//   type=feed  喂奶（可带 amount=215 直接指定奶量，否则弹菜单选择）
//   type=wet   尿了
//   type=dirty 拉了
//   type=ad    吃 AD
//
// 需要权限：网络访问（首次运行 Scriptable 会弹窗询问）
// 记录写入 Supabase，与飞书群录入同一张表（source=scriptable）
// ============================================================

const SUPABASE_URL = "https://elkcynbsoopvizmuevma.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVsa2N5bmJzb29wdml6bXVldm1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NzU1OTksImV4cCI6MjA5MzE1MTU5OX0.LScczDOGWPPUNhnUEUk6l6AH_TrTO3OgwkOHaM48zuY"

const BJ_OFFSET = 8 * 60 * 60 * 1000  // 北京时间 = UTC + 8h

function nowBJ() {                    // 当前北京时间 ISO（+08:00）
  return new Date(Date.now() + BJ_OFFSET).toISOString().slice(0, 19) + "+08:00"
}
function nowHM() {                    // 当前北京时间 "HH:MM"
  return new Date(Date.now() + BJ_OFFSET).toISOString().slice(11, 16)
}

// ---------- 写 Supabase ----------
async function post(table, data) {
  const url = SUPABASE_URL + "/rest/v1/" + table
  const req = new Request(url)
  req.method = "POST"
  req.headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": "Bearer " + SUPABASE_KEY,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Prefer": "return=representation"
  }
  req.body = JSON.stringify(data)
  return await req.loadJSON()
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
  a.addAction("💩 尿了")
  a.addAction("💩 拉了")
  a.addAction("💊 吃AD")
  a.addCancelAction("取消")
  const idx = await a.presentAlert()
  return ["feed", "wet", "dirty", "ad"][idx]
}

async function chooseAmount() {
  const a = new Alert()
  a.title = "🍼 奶量（ml）"
  for (const v of [150, 180, 200, 215, 230]) {
    a.addAction(v + "ml")
  }
  a.addCancelAction("取消")
  const idx = await a.presentAlert()
  return [150, 180, 200, 215, 230][idx]
}

// ---------- 记录并确认 ----------
async function record(type, amount) {
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
    label = "💩 尿了"
  } else if (type === "dirty") {
    table = "diaper_records"
    data = Object.assign({ type: "dirty", amount: 1, recorded_at: ts }, sender())
    label = "💩 拉了"
  } else if (type === "ad") {
    table = "ad_records"
    data = Object.assign({ recorded_at: ts }, sender())
    label = "💊 吃了维生素AD"
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

  if (!type) {
    type = await chooseType()
    if (!type) return
  }
  if (type === "feed" && (!amount || isNaN(amount))) {
    amount = await chooseAmount()
    if (!amount) return
  }

  const msg = await record(type, amount)
  const a = new Alert()
  a.title = "得宝记录"
  a.message = msg
  a.addAction("好")
  await a.presentAlert()
}

await main()
Script.complete()