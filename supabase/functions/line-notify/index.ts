// LINE alerts for the Department Work Plan (LINE Messaging API).
//   POST {type:"escalation", ...}      from the app: urgent report -> alert group
//   POST {type:"decision", dept, ...}  from the app: MD's decision -> that department's subscribed heads
//   POST {type:"summary", text}        from the app (executive account): monthly summary -> alert group
//   POST {type:"botinfo"}              from the app: the bot's LINE ID for the "add friend" link
//   POST {type:"reminder", dry?}       from pg_cron (header x-cron-secret), Mon–Fri 17:30: short status to the alert
//                                      group + a personal nudge to subscribed heads whose department has not sent.
//                                      dry:true returns the messages without sending.
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
const cut = (s: string) => (s.length > 4900 ? s.slice(0, 4890) + "\n…" : s);
const SITE = () => env("SITE_URL") || "https://md-cmnh.github.io/mater-department-work-flow/work.html";
const msg = (text: string, link = true) => [{ type: "text", text: cut(text + (link ? "\n\n" + SITE() : "")) }];
const send = async (text: string) => {
  const to = env("LINE_TO") || (await setting("line_to"));
  return to ? lineApi("message/push", { to, messages: msg(text) }) : lineApi("message/broadcast", { messages: msg(text) });
};
// personal messages to the heads subscribed to a department; failures never block the group message
async function toHeads(dept: string, text: string) {
  const { data } = await admin.from("dwp_line_sub").select("line_user_id").eq("dept", dept);
  const ids = [...new Set((data ?? []).map((r) => r.line_user_id as string))];
  if (!ids.length) return 0;
  try { await lineApi("message/multicast", { to: ids, messages: msg(text) }); return ids.length; }
  catch (e) { console.warn("multicast", dept, e); return 0; }
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

async function verifyLine(raw: string, sig: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env("LINE_CHANNEL_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  return btoa(String.fromCharCode(...mac)) === sig;
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
const unitLabel = (n: string) => (n.match(/^(Unit \d+)/)?.[1] ?? n.replace(/\s*\(.*\)$/, ""));
const deptLabel = (n: string) => n.replace(/^Group /, "").replace(/\s*\(.*\)$/, "");
// "ส่วนกลาง: Finance & Accounting, Human Resources, Operations +2"
function grouped(list: { u: string; d: string }[]) {
  const by = new Map<string, string[]>();
  list.forEach((x) => by.set(x.u, [...(by.get(x.u) ?? []), x.d]));
  return [...by].map(([u, ds]) => `• ${u}: ${ds.slice(0, 4).join(", ")}${ds.length > 4 ? ` +${ds.length - 4}` : ""}`).join("\n");
}

async function reminder(dry: boolean) {
  const now = new Date(Date.now() + 7 * 3600e3); // Bangkok, read with getUTC*
  const day = ymd(now), mk = day.slice(0, 7);
  const plan = await loadPlan();
  if (!plan) return { group: "ยังไม่มีรายการแผนกในฐานข้อมูล", nudges: 0 };
  // weeks live in the month of their Monday; last month's Monthly Report is due by the 5th
  const mon = new Date(now); mon.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const wDoc = ymd(mon).slice(0, 7), wKey = "W" + ymd(mon);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), pmk = ymd(prev).slice(0, 7);
  const friday = now.getUTCDay() === 5, monthlyDue = now.getUTCDate() >= 5 && now.getUTCDate() <= 9;
  const months = [...new Set([mk, wDoc, pmk])];
  const docs: Record<string, Record<string, Record<string, { sub?: number; rep?: { esc?: boolean; ack?: unknown } }>>> = {};
  for (const m of months) {
    const { data: rows } = await admin.from("shared_state").select("key,v").like("key", "dwp:%:" + m);
    (rows ?? []).forEach((r) => { const [, d] = r.key.split(":"); (docs[d] ??= {})[m] = r.v ?? {}; });
  }
  const missD: { u: string; d: string; id: string }[] = [], missW: { u: string; d: string }[] = [], missM: { u: string; d: string }[] = [];
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
  const lines = [`⏰ สรุป 17:30 · ${thDay(now)}`];
  lines.push(missD.length ? `Daily ส่งแล้ว ${total - missD.length}/${total} แผนก · ยังไม่ส่ง:\n${grouped(missD)}` : `✅ Daily ส่งครบ ${total} แผนก`);
  if (friday) lines.push(missW.length ? `\nWeekly ยังไม่ส่ง ${missW.length} แผนก:\n${grouped(missW)}` : "\n✅ Weekly ส่งครบ");
  if (monthlyDue && missM.length) lines.push(`\nMonthly (${MON[prev.getUTCMonth()]}) ยังไม่ส่ง ${missM.length} แผนก:\n${grouped(missM)}`);
  if (open) lines.push(`\n⚠ เรื่องด่วนรอ MD ตัดสิน: ${open} เรื่อง`);
  const group = lines.join("\n");
  const nudge = (d: string) => `⏰ แผนก ${d} ยังไม่ได้ส่ง Daily Report วันนี้ (${thDay(now)})\nกดลิงก์เพื่อเปิดแอปแล้วส่งรายงานครับ`;
  if (dry) return { group, nudges: missD.map((x) => x.id) };
  await send(group);
  let nudged = 0;
  for (const x of missD) nudged += await toHeads(x.id, nudge(x.d));
  return { group, nudges: nudged };
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
        await reply(`✅ ผูกกับแผนก ${dept.name} แล้ว\nคุณจะได้รับ:\n• คำตัดสินของ MD ในเรื่องของแผนกนี้\n• การเตือนเมื่อแผนกยังไม่ส่ง Daily Report (จ.–ศ. 17:30 น.)\n\nพิมพ์ "เลิก" เพื่อหยุดรับ`);
      } else if (s.type === "user" && /^(เลิก|ยกเลิก|stop)$/i.test(text)) {
        await admin.from("dwp_line_sub").delete().eq("line_user_id", s.userId);
        await reply("หยุดรับแจ้งเตือนส่วนตัวแล้ว");
      } else if (s.type === "user" && text) {
        await reply("พิมพ์ \"ผูก <รหัสแผนก>\" เพื่อรับแจ้งเตือนของแผนก เช่น ผูก hr\nดูรหัสแผนกได้ในแอป: แตะชื่อแผนกด้านบน\nพิมพ์ \"เลิก\" เพื่อหยุดรับ");
      }
    }
    return json({ ok: true });
  }

  let b: Record<string, unknown>;
  try { b = JSON.parse(raw || "{}"); } catch { return json({ error: "bad json" }, 400); }
  try {
    if (b.type === "reminder") {
      const want = env("CRON_SECRET") || (await setting("dwp_cron"));
      if (!want || req.headers.get("x-cron-secret") !== want) return json({ error: "forbidden" }, 403);
      return json({ ok: true, ...(await reminder(!!b.dry)) });
    }
    if (b.type === "botinfo") {
      const info = await lineApi("info") as { basicId?: string; displayName?: string };
      return json({ basicId: info.basicId ?? "", name: info.displayName ?? "" });
    }
    const who = await caller(req);
    if (!who) return json({ error: "not allowed" }, 403);
    const s = (k: string) => String(b[k] ?? "").trim();
    if (b.type === "escalation") {
      const no = Array.isArray(b.no) ? (b.no as string[]).map((x) => "• " + x).join("\n") : "";
      const text = [`🚨 เรื่องด่วนรอตัดสิน — ${s("dept")}`, `${s("unit")} · ${s("round")} ${s("label")} · ส่งถึง ${s("to")}`,
        s("report") && "เรื่องที่ต้องรายงาน: " + s("report"), s("issue") && "ปัญหาที่พบ: " + s("issue"),
        s("pending") && "งานค้าง / แผนแก้: " + s("pending"), no && "งานที่ทำไม่ได้:\n" + no, "ผู้รายงาน: " + (s("by") || "-")]
        .filter(Boolean).join("\n");
      await send(text);
      return json({ ok: true });
    }
    if (b.type === "decision") {
      const text = [`✅ MD ตัดสินแล้ว — ${s("deptName")}`, s("when") && "รายงาน: " + s("when"), s("issue") && "เรื่อง: " + s("issue"),
        "คำตัดสิน: " + (s("decision") || "รับทราบ")].filter(Boolean).join("\n");
      return json({ ok: true, sent: await toHeads(s("dept"), text) });
    }
    if (b.type === "summary") {
      if (!who.exec) return json({ error: "executive account only" }, 403);
      await send(s("text"));
      return json({ ok: true });
    }
    return json({ error: "unknown type" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
