// LINE alerts for the Department Work Plan (LINE Messaging API).
//   POST {type:"escalation", ...}  from the app (signed-in editor): urgent report -> LINE
//   POST {type:"summary", text}    from the app (executive account): monthly summary -> LINE
//   POST {type:"reminder"}         from pg_cron with header x-cron-secret: departments that have not sent today's Daily Report
//   LINE webhook (x-line-signature): replies with the chat's ID so it can be set as LINE_TO
// Secrets: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LINE_TO (user/group ID; empty = broadcast to all friends),
//          CRON_SECRET, SITE_URL (optional link in messages). Deploy with --no-verify-jwt (auth is checked here).
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

async function lineApi(path: string, body: unknown) {
  const r = await fetch("https://api.line.me/v2/bot/message/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env("LINE_CHANNEL_ACCESS_TOKEN") },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("LINE " + r.status + ": " + (await r.text()));
}
const cut = (s: string) => (s.length > 4900 ? s.slice(0, 4890) + "\n…" : s);
const send = (text: string) => {
  const messages = [{ type: "text", text: cut(text + (env("SITE_URL") ? "\n\n" + env("SITE_URL") : "")) }];
  return env("LINE_TO") ? lineApi("push", { to: env("LINE_TO"), messages }) : lineApi("broadcast", { messages });
};

// signed-in user: anonymous Work Plan visitor, or in allowed_users (editor); exec = finance access
async function caller(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await admin.auth.getUser(jwt);
  if (data?.user?.is_anonymous) return { exec: false }; // Work Plan visitor without password: may send urgent reports
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

const pad = (n: number) => String(n).padStart(2, "0");
const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

async function reminder() {
  const now = new Date(Date.now() + 7 * 3600e3); // Bangkok
  const day = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`, mk = day.slice(0, 7);
  const { data: p } = await admin.from("shared_state").select("v").eq("key", "dwp:plan").maybeSingle();
  const plan = p?.v?.plan as { name: string; start?: string; depts: { id: string; name: string; tasks: { r: string }[] }[] }[];
  if (!plan) return "ยังไม่มีรายการแผนกในฐานข้อมูล (เปิดแอปด้วยบัญชีผู้บริหารหนึ่งครั้ง)";
  const { data: rows } = await admin.from("shared_state").select("key,v").like("key", "dwp:%:" + mk);
  const docs: Record<string, Record<string, { sub?: number; rep?: { esc?: boolean; ack?: unknown } }>> = {};
  (rows ?? []).forEach((r) => (docs[r.key.split(":")[1]] = r.v ?? {}));
  const missing: string[] = [];
  let total = 0, open = 0;
  for (const u of plan) {
    if (u.start && mk < u.start) continue;
    for (const d of u.depts) {
      Object.values(docs[d.id] ?? {}).forEach((e) => { if (e?.rep?.esc && !e.rep.ack) open++; });
      if (!d.tasks.some((t) => t.r === "D")) continue;
      total++;
      if (!docs[d.id]?.[day]?.sub) missing.push("• " + d.name + " (" + u.name.replace(/\s*\(.*\)$/, "") + ")");
    }
  }
  const head = `Daily Report ${+day.slice(8)} ${MON[+day.slice(5, 7) - 1]} ${+day.slice(0, 4) + 543}`;
  return (missing.length
    ? `⏰ ${head}\nยังไม่ส่ง ${missing.length} จาก ${total} แผนก:\n${missing.join("\n")}`
    : `✅ ${head}\nส่งครบทั้ง ${total} แผนก`) + (open ? `\n\n⚠ เรื่องด่วนรอ MD ตัดสินเดือนนี้: ${open} เรื่อง` : "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await req.text();

  const sig = req.headers.get("x-line-signature");
  if (sig) {
    if (!(await verifyLine(raw, sig))) return json({ error: "bad signature" }, 401);
    for (const ev of JSON.parse(raw).events ?? []) {
      const s = ev.source ?? {}, id = s.groupId ?? s.roomId ?? s.userId;
      const ask = ev.type === "join" || (ev.type === "message" && /^(id|ไอดี)$/i.test((ev.message?.text ?? "").trim()));
      if (ask && ev.replyToken && id)
        await lineApi("reply", { replyToken: ev.replyToken, messages: [{ type: "text", text: "ID ของแชทนี้ (ใส่เป็น LINE_TO):\n" + id }] });
    }
    return json({ ok: true });
  }

  let b: Record<string, unknown>;
  try { b = JSON.parse(raw || "{}"); } catch { return json({ error: "bad json" }, 400); }
  try {
    if (b.type === "reminder") {
      if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return json({ error: "forbidden" }, 403);
      const text = await reminder();
      await send(text);
      return json({ ok: true, text });
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
