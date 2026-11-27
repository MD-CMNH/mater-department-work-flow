// LINE alerts for the Department Work Plan (LINE Messaging API). Messages are Flex cards with a plain-text
// fallback: if LINE refuses a card, the same content goes out as text so no alert is lost.
//   POST {type:"escalation", ...}      from the app: urgent report -> alert group
//   POST {type:"decision", dept, ...}  from the app: MD's decision -> that department's subscribed heads
//   POST {type:"summary", text}        from the app (executive account): monthly summary -> alert group
//   POST {type:"botinfo"}              from the app: the bot's LINE ID for the "add friend" link
//   POST {type:"reminder", dry?}       from pg_cron (header x-cron-secret), Mon–Fri 17:30: status card to the alert
//                                      group + a personal nudge to subscribed heads whose department has not sent.
//                                      dry:true returns the messages without sending.
//   POST {type:"quota"}                (header x-cron-secret) this month's LINE message quota, usage and alert-group size
//   POST {type:"test"}                 (header x-cron-secret) sends one card of each kind to the alert group, marked as a test
//   LINE webhook (x-line-signature):
//     - the first group the bot joins becomes the alert group (app_secret 'line_to')
//     - 1:1 chat "ผูก <code>" subscribes a head to a department, "เลิก" unsubscribes, "id" replies the chat's ID
// Secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET. Optional: LINE_TO (overrides the saved group; with neither,
//          messages are broadcast to all friends), CRON_SECRET (else app_secret 'dwp_cron'), SITE_URL.
// Deploy with --no-verify-jwt (auth is checked here).
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function lineApi(path: string, body?: unknown) {
  const r = await fetch("https://api.line.me/v2/bot/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN") },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error("LINE " + r.status + ": " + (await r.text()));
  return r.status === 200 ? await r.json().catch(() => ({})) : {};
}
// settings kept in public.app_secret (RLS on, no policies: only the service role reads it)
async function setting(name: string) {
  const { data } = await admin.from("app_secret").select("value").eq("name", name).maybeSingle();
  return (data?.value as string) ?? "";
}
const cut = (s: string, n = 4900) => (s.length > n ? s.slice(0, n - 10) + "\n…" : s);
const SITE = () => env("SITE_URL") || "https://md-cmnh.github.io/mater-department-work-flow/work.html";
const ICON = () => SITE().replace(/work\.html.*$/, "") + "icons/icon-192.png";

// ---------------------------------------------------------------- Flex cards
type Card = { alt: string; text: string; flex: Record<string, unknown> };
const C = { teal: "#1E9E9E", ink: "#1C2621", mute: "#6A716B", line: "#E7E2D6", red: "#C0392B", redSoft: "#FBE7E5",
  green: "#1E7A45", greenSoft: "#E2F3E8", amber: "#C77C12", amberSoft: "#FBEFD9", track: "#EAE6DC" };
type Node = Record<string, unknown>;
const T = (text: string, o: Node = {}): Node => ({ type: "text", text: text || " ", wrap: true, ...o });
const sep = (): Node => ({ type: "separator", color: C.line });
const box = (contents: Node[], o: Node = {}): Node => ({ type: "box", layout: "vertical", contents, ...o });
const field = (label: string, value: string): Node | null =>
  value ? box([T(label, { size: "xs", color: C.mute }), T(value, { size: "sm", color: C.ink })], { spacing: "xs" }) : null;
const header = (title: string, sub: string, color: string): Node => ({
  type: "box", layout: "horizontal", backgroundColor: color, paddingAll: "16px", spacing: "md",
  contents: [
    { type: "image", url: ICON(), size: "xxs", aspectMode: "fit", flex: 0 },
    box([T(title, { color: "#FFFFFF", weight: "bold", size: "md" }), T(sub, { color: "#FFFFFFDD", size: "xs" })],
      { justifyContent: "center" }),
  ],
});
const button = (label: string, uri: string, color: string): Node =>
  ({ type: "button", style: "primary", color, height: "sm", action: { type: "uri", label, uri } });
const bubble = (head: Node, body: (Node | null)[], foot: Node, size = "mega"): Node => ({
  type: "bubble", size, header: head,
  body: box(body.filter(Boolean) as Node[], { spacing: "md", paddingAll: "16px" }),
  footer: box([foot], { paddingAll: "12px", paddingTop: "0px" }),
});
const note = (s: string, fg: string, bg: string): Node =>
  box([T(s, { size: "sm", weight: "bold", color: fg })], { backgroundColor: bg, cornerRadius: "8px", paddingAll: "10px" });
const bar = (frac: number): Node => box([
  box([{ type: "filler" }], { width: Math.max(2, Math.round(frac * 100)) + "%", height: "8px", backgroundColor: C.teal, cornerRadius: "4px" }),
], { height: "8px", backgroundColor: C.track, cornerRadius: "4px" });
const testTag = (test: boolean): Node | null => (test ? T("ข้อความทดสอบรูปแบบ · ไม่ใช่ข้อมูลจริง", { size: "xxs", color: C.mute, align: "center" }) : null);

// this month's push-message quota (null when LINE does not say); used to show usage on the 17:30 card
async function quota(): Promise<{ limit: number | null; used: number } | null> {
  try {
    const q = await lineApi("message/quota") as { type?: string; value?: number };
    const c = await lineApi("message/quota/consumption") as { totalUsage?: number };
    return { limit: q.type === "limited" ? q.value ?? null : null, used: c.totalUsage ?? 0 };
  } catch (e) { console.warn("quota", e); return null; }
}

async function push(messages: unknown[]) {
  const to = env("LINE_TO") || (await setting("line_to"));
  return to ? lineApi("message/push", { to, messages }) : lineApi("message/broadcast", { messages });
}
const asText = (text: string) => ({ type: "text", text: cut(text + "\n\n" + SITE()) });
const asFlex = (c: Card) => ({ type: "flex", altText: cut(c.alt, 390), contents: c.flex });
// cards to the alert group; one push, falls back to plain text if LINE refuses the cards
async function send(cards: Card[]) {
  try { return await push(cards.map(asFlex)); }
  catch (e) { console.warn("flex refused, sending text", e); return push(cards.map((c) => asText(c.text))); }
}
// personal messages to the heads subscribed to a department; failures never block the group message
async function toHeads(dept: string, card: Card) {
  const { data } = await admin.from("dwp_line_sub").select("line_user_id").eq("dept", dept);
  const ids = [...new Set((data ?? []).map((r) => r.line_user_id as string))];
  if (!ids.length) return 0;
  try { await lineApi("message/multicast", { to: ids, messages: [asFlex(card)] }); return ids.length; }
  catch (_) {
    try { await lineApi("message/multicast", { to: ids, messages: [asText(card.text)] }); return ids.length; }
    catch (e) { console.warn("multicast", dept, e); return 0; }
  }
}

function escalationCard(b: Record<string, unknown>, test = false): Card {
  const s = (k: string) => String(b[k] ?? "").trim();
  const no = Array.isArray(b.no) ? (b.no as string[]).filter(Boolean) : [];
  const text = [`🚨 เรื่องด่วนรอตัดสิน — ${s("dept")}`, `${s("unit")} · ${s("round")} ${s("label")} · ส่งถึง ${s("to")}`,
    s("report") && "เรื่องที่ต้องรายงาน: " + s("report"), s("issue") && "ปัญหาที่พบ: " + s("issue"),
    s("pending") && "งานค้าง / แผนแก้: " + s("pending"), no.length && "งานที่ทำไม่ได้:\n" + no.map((x) => "• " + x).join("\n"),
    "ผู้รายงาน: " + (s("by") || "-")].filter(Boolean).join("\n");
  const flex = bubble(header("เรื่องด่วนรอตัดสิน", s("unit").replace(/\s*\(.*\)$/, ""), C.red), [
    box([T(s("dept"), { size: "lg", weight: "bold", color: C.ink }),
      T(`${s("round")} ${s("label")} · ส่งถึง ${s("to")}`, { size: "xs", color: C.mute })], { spacing: "xs" }),
    sep(),
    field("เรื่องที่ต้องรายงาน", s("report")), field("ปัญหาที่พบ", s("issue")), field("งานค้าง / แผนแก้", s("pending")),
    field("งานที่ทำไม่ได้", no.map((x) => "• " + x).join("\n")),
    T("ผู้รายงาน: " + (s("by") || "-"), { size: "xs", color: C.mute }), testTag(test),
  ], button("เปิดแอปเพื่อตัดสิน", SITE(), C.red));
  return { alt: `🚨 เรื่องด่วน: ${s("dept")} — ${s("report") || s("issue")}`, text, flex };
}

function decisionCard(b: Record<string, unknown>, test = false): Card {
  const s = (k: string) => String(b[k] ?? "").trim();
  const text = [`✅ MD ตัดสินแล้ว — ${s("deptName")}`, s("when") && "รายงาน: " + s("when"), s("issue") && "เรื่อง: " + s("issue"),
    "คำตัดสิน: " + (s("decision") || "รับทราบ")].filter(Boolean).join("\n");
  const flex = bubble(header("MD ตัดสินแล้ว", s("deptName"), C.green), [
    field("เรื่อง", s("issue")),
    box([T("คำตัดสิน", { size: "xs", color: C.green }), T(s("decision") || "รับทราบ", { size: "md", weight: "bold", color: C.green })],
      { backgroundColor: C.greenSoft, cornerRadius: "8px", paddingAll: "12px", spacing: "xs" }),
    s("when") ? T("รายงานวันที่ " + s("when"), { size: "xs", color: C.mute }) : null, testTag(test),
  ], button("เปิดแอป", SITE(), C.green));
  return { alt: `✅ MD ตัดสินแล้ว: ${s("decision") || "รับทราบ"}`, text, flex };
}

function summaryCard(text: string): Card {
  const [first, ...rest] = text.split("\n");
  const flex = bubble(header("สรุปผลงานแผนก", first.replace(/^\S*\s*สรุปผลงานแผนก\s*/, "") || "รายเดือน", C.teal),
    [T(cut(rest.join("\n").trim(), 1800), { size: "sm", color: C.ink })], button("เปิดแอป", SITE(), C.teal), "giga");
  return { alt: first, text, flex };
}

// ---------------------------------------------------------------- data
async function verifyLine(raw: string, sig: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("LINE_CHANNEL_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  return btoa(String.fromCharCode(...mac)) === sig;
}

// signed-in user: anonymous Work Plan visitor, or in allowed_users (editor); exec = finance access
async function caller(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  if (data?.user?.is_anonymous) return { exec: false }; // Work Plan visitor without password
  const email = data?.user?.email?.toLowerCase();
  if (!email) return null;
  const { data: u } = await admin.from("allowed_users").select("role,finance").eq("email", email).maybeSingle();
  return u && u.role === "editor" ? { exec: !!u.finance } : null;
}

type Plan = { unit: string; name: string; start?: string; depts: { id: string; name: string; tasks: { r: string }[] }[] }[];
async function loadPlan(): Promise<Plan | null> {
  const { data } = await admin.from("shared_state").select("v").eq("key", "dwp:plan").maybeSingle();
  return (data?.v?.plan as Plan) ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WD = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const thDay = (d: Date) => `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear() + 543).slice(2)}`;
// short names for cards: "CMNH · Chiangmai Nursing Homecare" -> "CMNH", "โมบาย · บัญชี การเงิน" -> "โมบาย"
const unitLabel = (n: string) => (n.match(/^(Unit \d+)/)?.[1] ?? n.split(" · ")[0].replace(/\s*\(.*\)$/, ""));
const deptLabel = (n: string) => n.split(" · ")[0].replace(/^Group /, "").replace(/\s*\(.*\)$/, "");
type Miss = { u: string; d: string; id: string };
const byUnit = (list: Miss[]) => {
  const m = new Map<string, string[]>();
  list.forEach((x) => m.set(x.u, [...(m.get(x.u) ?? []), x.d]));
  return [...m];
};
const groupedText = (list: Miss[]) =>
  byUnit(list).map(([u, ds]) => `• ${u}: ${ds.slice(0, 4).join(", ")}${ds.length > 4 ? ` +${ds.length - 4}` : ""}`).join("\n");
const groupedFlex = (list: Miss[]): Node[] =>
  byUnit(list).map(([u, ds]) => box([T(u, { size: "xs", weight: "bold", color: C.teal }), T(ds.join(" · "), { size: "sm", color: C.ink })], { spacing: "xs" }));

async function reminder(test = false) {
  const now = new Date(Date.now() + 7 * 3600e3); // Bangkok, read with getUTC*
  const day = ymd(now), mk = day.slice(0, 7);
  const plan = await loadPlan();
  if (!plan) return null;
  // weeks live in the month of their Monday; last month's Monthly Report is due by the 5th
  const mon = new Date(now); mon.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const wDoc = ymd(mon).slice(0, 7), wKey = "W" + ymd(mon);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), pmk = ymd(prev).slice(0, 7);
  const friday = now.getUTCDay() === 5, monthlyDue = now.getUTCDate() >= 5 && now.getUTCDate() <= 9;
  const docs: Record<string, Record<string, Record<string, { sub?: number; rep?: { esc?: boolean; ack?: unknown } }>>> = {};
  for (const m of [...new Set([mk, wDoc, pmk])]) {
    const { data: rows } = await admin.from("shared_state").select("key,v").like("key", "dwp:%:" + m);
    (rows ?? []).forEach((r) => { const [, d] = r.key.split(":"); (docs[d] ??= {})[m] = r.v ?? {}; });
  }
  const missD: Miss[] = [], missW: Miss[] = [], missM: Miss[] = [];
  let total = 0, open = 0;
  for (const u of plan) {
    if (u.start && mk < u.start) continue;
    for (const d of u.depts) {
      const my = docs[d.id] ?? {}, x = { u: unitLabel(u.name), d: deptLabel(d.name), id: d.id };
      Object.values(my[mk] ?? {}).forEach((e) => { if (e?.rep?.esc && !e.rep.ack) open++; });
      if (d.tasks.some((t) => t.r === "D")) { total++; if (!my[mk]?.[day]?.sub) missD.push(x); }
      if (friday && d.tasks.some((t) => t.r === "W") && !my[wDoc]?.[wKey]?.sub) missW.push(x);
      if (monthlyDue && d.tasks.some((t) => t.r === "M") && !(u.start && pmk < u.start) && !my[pmk]?.["M" + pmk]?.sub) missM.push(x);
    }
  }
  const sent = total - missD.length;
  // plain text (fallback)
  const lines = [`⏰ สรุป 17:30 · ${thDay(now)}`];
  lines.push(missD.length ? `รายงานประจำวัน ส่งแล้ว ${sent}/${total} แผนก · ยังไม่ส่ง:\n${groupedText(missD)}` : `✅ ส่งรายงานประจำวันครบ ${total} แผนก`);
  if (friday) lines.push(missW.length ? `\nรายงานประจำสัปดาห์ ยังไม่ส่ง ${missW.length} แผนก:\n${groupedText(missW)}` : "\n✅ รายงานประจำสัปดาห์ส่งครบ");
  if (monthlyDue && missM.length) lines.push(`\nรายงานประจำเดือน (${MON[prev.getUTCMonth()]}) ยังไม่ส่ง ${missM.length} แผนก:\n${groupedText(missM)}`);
  if (open) lines.push(`\n⚠ เรื่องด่วนรอ MD ตัดสิน: ${open} เรื่อง`);
  const q = await quota(), near = !!(q && q.limit && q.used >= q.limit * 0.8);
  const qLine = q ? `LINE เดือนนี้ใช้ไป ${q.used.toLocaleString()}${q.limit ? " / " + q.limit.toLocaleString() : ""} ข้อความ` : "";
  if (near) lines.push(`\n⚠ โควตา LINE ใกล้หมด: ${qLine}`); else if (qLine) lines.push("\n" + qLine);
  // card
  const body: (Node | null)[] = [
    box([
      { type: "box", layout: "baseline", spacing: "sm", contents: [
        T(`${sent}`, { size: "3xl", weight: "bold", color: missD.length ? C.ink : C.green, flex: 0 }),
        T(`/ ${total} แผนก`, { size: "md", color: C.mute, flex: 0 }),
      ] },
      T("ส่งรายงานประจำวันแล้ว", { size: "xs", color: C.mute }),
    ], { spacing: "xs" }),
    bar(total ? sent / total : 0),
  ];
  if (missD.length) body.push(sep(), T(`ยังไม่ส่ง ${missD.length} แผนก`, { size: "sm", weight: "bold", color: C.red }), ...groupedFlex(missD));
  else body.push(note("✅ ส่งครบทุกแผนกแล้ว", C.green, C.greenSoft));
  if (friday) {
    body.push(sep());
    if (missW.length) body.push(T(`รายงานประจำสัปดาห์ ยังไม่ส่ง ${missW.length} แผนก`, { size: "sm", weight: "bold", color: C.amber }), ...groupedFlex(missW));
    else body.push(note("✅ รายงานประจำสัปดาห์ส่งครบ", C.green, C.greenSoft));
  }
  if (monthlyDue && missM.length) body.push(sep(), T(`รายงานประจำเดือน ${MON[prev.getUTCMonth()]} ยังไม่ส่ง ${missM.length} แผนก`, { size: "sm", weight: "bold", color: C.amber }), ...groupedFlex(missM));
  if (open) body.push(note(`⚠ เรื่องด่วนรอ MD ตัดสิน ${open} เรื่อง`, C.red, C.redSoft));
  if (near) body.push(note(`⚠ โควตา LINE ใกล้หมด · ${qLine} · ถ้าหมด แจ้งเตือนจะหยุดจนถึงต้นเดือน`, C.amber, C.amberSoft));
  else if (qLine) body.push(T(qLine, { size: "xxs", color: C.mute, align: "center" }));
  body.push(testTag(test));
  const group: Card = {
    alt: missD.length ? `⏰ รายงานประจำวัน ส่งแล้ว ${sent}/${total} แผนก · ยังไม่ส่ง ${missD.length}` : `✅ ส่งรายงานประจำวันครบ ${total} แผนก`,
    text: lines.join("\n"),
    flex: bubble(header("สรุปรายงาน 17:30", thDay(now), C.teal), body, button("เปิดแอป", SITE(), C.teal), "giga"),
  };
  const nudge = (d: string): Card => ({
    alt: `⏰ แผนก ${d} ยังไม่ได้ส่งรายงานประจำวัน`,
    text: `⏰ แผนก ${d} ยังไม่ได้ส่งรายงานประจำวัน (${thDay(now)})\nกดลิงก์เพื่อเปิดแอปแล้วส่งรายงานครับ`,
    flex: bubble(header("ยังไม่ได้ส่งรายงาน", thDay(now), C.amber), [
      T(`แผนก ${d}`, { size: "lg", weight: "bold", color: C.ink }),
      T("ยังไม่ได้ส่งรายงานประจำวัน กดปุ่มด้านล่างเพื่อเปิดแอปแล้วส่งรายงานครับ", { size: "sm", color: C.mute }), testTag(test),
    ], button("ส่งรายงานตอนนี้", SITE(), C.amber)),
  });
  return { group, nudge, missD };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();

  const sig = req.headers.get("x-line-signature");
  if (sig) {
    if (!env("LINE_CHANNEL_SECRET")) return json({ error: "LINE_CHANNEL_SECRET not set" }, 503);
    if (!(await verifyLine(raw, sig))) return json({ error: "bad signature" }, 401);
    for (const ev of JSON.parse(raw).events ?? []) {
      const s = ev.source ?? {}, id = s.groupId ?? s.roomId ?? s.userId;
      if (!ev.replyToken || !id) continue;
      const reply = (text: string) => lineApi("message/reply", { replyToken: ev.replyToken, messages: [{ type: "text", text }] });
      const text = ev.type === "message" ? String(ev.message?.text ?? "").trim() : "";
      if (ev.type === "join") {
        // the first group the bot is invited to becomes the alert group
        if (!env("LINE_TO") && !(await setting("line_to"))) {
          await admin.from("app_secret").upsert({ name: "line_to", value: id });
          await reply("✅ ตั้งกลุ่มนี้เป็นกลุ่มรับแจ้งเตือนแผนงานแผนกแล้ว\nเรื่องด่วนจากหัวหน้าแผนก และสรุปแผนกที่ยังไม่ส่งรายงาน (จ.–ศ. 17:30 น.) จะส่งมาที่นี่");
        } else await reply("บอทนี้ส่งแจ้งเตือนไปที่กลุ่มอื่นอยู่แล้ว (ID ของแชทนี้: " + id + ")");
      } else if (/^(id|ไอดี)$/i.test(text)) {
        await reply("ID ของแชทนี้:\n" + id);
      } else if (s.type === "user" && /^(ผูก|bind)\s+\S+/i.test(text)) {
        const code = text.split(/\s+/)[1].toLowerCase(), plan = await loadPlan();
        const dept = plan?.flatMap((u) => u.depts).find((d) => d.id.toLowerCase() === code);
        if (!dept) { await reply("ไม่พบแผนกรหัส \"" + code + "\"\nดูรหัสแผนกได้ในแอป: แตะชื่อแผนกด้านบน"); continue; }
        await admin.from("dwp_line_sub").upsert({ line_user_id: s.userId, dept: dept.id });
        await reply(`✅ ผูกกับแผนก ${dept.name} แล้ว\nคุณจะได้รับ:\n• คำตัดสินของ MD ในเรื่องของแผนกนี้\n• การเตือนเมื่อแผนกยังไม่ส่งรายงานประจำวัน (จ.–ศ. 17:30 น.)\n\nพิมพ์ "เลิก" เพื่อหยุดรับ`);
      } else if (s.type === "user" && /^(เลิก|ยกเลิก|stop)$/i.test(text)) {
        await admin.from("dwp_line_sub").delete().eq("line_user_id", s.userId);
        await reply("หยุดรับแจ้งเตือนส่วนตัวแล้ว");
      } else if (s.type === "user" && text) {
        await reply("พิมพ์ \"ผูก <รหัสแผนก>\" เพื่อรับแจ้งเตือนของแผนก เช่น ผูก tql-cm\nดูรหัสแผนกได้ในแอป: แตะชื่อแผนกด้านบน\nพิมพ์ \"เลิก\" เพื่อหยุดรับ");
      }
    }
    return json({ ok: true });
  }

  let b: Record<string, unknown>;
  try { b = JSON.parse(raw || "{}"); } catch { return json({ error: "bad json" }, 400); }
  try {
    if (b.type === "quota") {
      const want = env("CRON_SECRET") || (await setting("dwp_cron"));
      if (!want || req.headers.get("x-cron-secret") !== want) return json({ error: "forbidden" }, 403);
      const to = env("LINE_TO") || (await setting("line_to"));
      let members: number | null = null;
      if (to.startsWith("C")) { try { members = ((await lineApi(`group/${to}/members/count`)) as { count?: number }).count ?? null; } catch (_) { /* not allowed for this account */ } }
      const { count } = await admin.from("dwp_line_sub").select("*", { count: "exact", head: true });
      return json({ ok: true, quota: await quota(), groupMembers: members, personalSubscribers: count ?? 0 });
    }
    if (b.type === "reminder" || b.type === "test") {
      const want = env("CRON_SECRET") || (await setting("dwp_cron"));
      if (!want || req.headers.get("x-cron-secret") !== want) return json({ error: "forbidden" }, 403);
      const test = b.type === "test";
      const r = await reminder(test);
      if (!r) return json({ ok: false, error: "ยังไม่มีรายการแผนกในฐานข้อมูล" });
      if (b.dry) return json({ ok: true, alt: r.group.alt, text: r.group.text, flex: r.group.flex, nudges: r.missD.map((x) => x.id) });
      if (test) {
        // one card of each kind, all to the alert group, clearly marked as a test
        const sample = { unit: "Unit 2 · Chiangmai Nursing Homecare", dept: "พยาบาลประจำอาคาร (หัวหน้าสาขา)", to: "Facility Director",
          round: "รายงานประจำวัน", label: thDay(new Date(Date.now() + 7 * 3600e3)), by: "สมศรี ใจดี (ตัวอย่าง)",
          report: "ขาดผู้ช่วยพยาบาลเวรดึก 1 คน", issue: "ผู้ช่วยพยาบาลลาป่วยกะทันหัน",
          no: ["ตรวจการรับประทานอาหาร — ผู้ป่วยไม่ยอมรับประทาน รายงานแพทย์แล้ว"] };
        const cards = [r.group, escalationCard(sample, true),
          decisionCard({ deptName: sample.dept, when: sample.label, issue: sample.report, decision: "อนุมัติจ้างผู้ช่วยพยาบาล part-time 1 เดือน" }, true),
          r.nudge(deptLabel(sample.dept)), summaryCard("📊 สรุปผลงานแผนก พฤศจิกายน 2569 (ตัวอย่าง)\nงานที่ทำแล้ว 82% · ทำไม่ได้ 3 ครั้ง · เรื่องด่วนค้าง 0\n\n95%  Group Finance & Accounting\n88%  Group Human Resources")];
        // validate:true asks LINE to check the cards without sending anything
        if (b.validate) {
          const out: unknown[] = [];
          for (const c of cards) { try { await lineApi("message/validate/push", { messages: [asFlex(c)] }); out.push("ok"); } catch (e) { out.push(String(e)); } }
          return json({ ok: true, validate: out });
        }
        await send(cards);
        return json({ ok: true, sent: cards.length });
      }
      await send([r.group]);
      let nudged = 0;
      for (const x of r.missD) nudged += await toHeads(x.id, r.nudge(x.d));
      return json({ ok: true, text: r.group.text, nudges: nudged });
    }
    if (b.type === "botinfo") {
      const info = await lineApi("info") as { basicId?: string; displayName?: string };
      return json({ basicId: info.basicId ?? "", name: info.displayName ?? "" });
    }
    const who = await caller(req);
    if (!who) return json({ error: "not allowed" }, 403);
    if (b.type === "escalation") { await send([escalationCard(b)]); return json({ ok: true }); }
    if (b.type === "decision") return json({ ok: true, sent: await toHeads(String(b.dept ?? ""), decisionCard(b)) });
    if (b.type === "summary") {
      if (!who.exec) return json({ error: "executive account only" }, 403);
      await send([summaryCard(String(b.text ?? "").trim())]);
      return json({ ok: true });
    }
    return json({ error: "unknown type" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
