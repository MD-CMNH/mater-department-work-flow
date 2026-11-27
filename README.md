# YEARS-PLAN — Dashboard แผนงานปี 2570 (CMNH)

CEO Dashboard แผนงานปี 2570 (หน้าเดียวกับ artifact "CMNH แผนงานปี 2570 — CEO Dashboard"): สรุป CEO · แผนไตรมาส · งาน · โปรเจ็ค · โครงสร้าง · ธรรมาภิบาล · การเงิน · การขาย · KPI · เอกสาร

- `public/index.html` คือหน้า dashboard เดิม เปลี่ยนแค่การเก็บข้อมูลร่วมกับทีม (สถานะงาน เช็กลิสต์ Go/No-go KPI) จาก claude.ai มาเป็น Supabase ผ่าน `public/supabase-bridge.js` (ตาราง `shared_state`)
- ค่าที่ปรับในแท็บการเงินยังเก็บในเครื่องของแต่ละคนเหมือนเดิม

- **หน้าเว็บ**: GitHub Pages (static) — `public/`
- **ข้อมูล**: Supabase (Postgres + Auth) — `supabase/`
- **เข้าสู่ระบบ**: กรอกรหัสอย่างเดียว ใช้บัญชีกลาง `team@years-plan.local` (ตั้งใน `public/config.js` → `loginEmail`) เปลี่ยนรหัสได้ที่ Supabase → Authentication → Users

## สิทธิ์การเข้าถึง

ทุกตารางเปิด Row Level Security เฉพาะผู้ที่ล็อกอินและมีอีเมลอยู่ในตาราง `allowed_users` เท่านั้นที่อ่านข้อมูลได้
- `role = 'viewer'` อ่านอย่างเดียว
- `role = 'editor'` แก้สถานะงาน / หมายเหตุ / KPI / ผลจริงได้

ใครไม่อยู่ในรายชื่อ ล็อกอินได้แต่จะไม่เห็นข้อมูลใด ๆ

## ตั้งค่าครั้งแรก

โปรเจกต์ Supabase ที่ใช้งาน: `years-plan` (ref `yfswjxzsrgngxbuajnov`, org MD-CMNH, region ap-southeast-1) — สร้างตารางแล้ว

### 1. Supabase

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push            # สร้างตาราง + RLS
```

เพิ่มผู้มีสิทธิ์ (SQL Editor):

```sql
insert into public.allowed_users (email, role) values ('someone@example.com', 'editor');
```

ใน Supabase Dashboard → Authentication → URL Configuration ใส่ URL ของหน้าเว็บ `https://md-cmnh.github.io/YEARS-PLAN/` เป็น Site URL และ Redirect URL

### 2. GitHub Pages

1. Settings → Pages → Source เลือก **GitHub Actions**
2. (ไม่บังคับ) ค่า Supabase ของโปรเจกต์ `years-plan` ใส่ไว้แล้วใน `public/config.js` ถ้าต้องการเปลี่ยนโปรเจกต์ ให้ตั้ง Repository variables `SUPABASE_URL` และ `SUPABASE_ANON_KEY`
3. Merge เข้า `main` (หรือกด Run workflow ที่ Actions → "Deploy dashboard to GitHub Pages")

หมายเหตุ: หน้าเว็บบน GitHub Pages เปิดให้ทุกคนเข้าถึงได้ แต่ข้อมูลอ่านได้เฉพาะคนที่ล็อกอินและอยู่ใน `allowed_users` เท่านั้น ถ้า repo เป็น private ต้องใช้ GitHub แพ็กเกจที่รองรับ Pages สำหรับ private repo

## พัฒนาบนเครื่อง

เปิดด้วย static server ใดก็ได้

```bash
npx serve public
```

## แอปแผนงานแผนก (`work.html`)

หัวหน้าแผนกติ๊กงาน Daily / Weekly / Monthly แล้วส่งรายงาน ส่วน MD ติดตามภาพรวมได้จากหน้าเดียว

- **งานของแผนก**: ติ๊ก "ทำแล้ว / ทำไม่ได้" และส่งรายงาน ถ้าติ๊ก "ด่วน" ระบบจะแจ้ง LINE (เมื่อเปิดใช้)
- **ภาพรวม MD**: ดูสถานะของวันนี้ สัปดาห์นี้ และเดือนนี้ของทุกแผนก พร้อมบันทึกคำตัดสินเรื่องด่วน
- **สรุปรายเดือน**: % งานที่ทำแล้วรายแผนก, กราฟจำนวนแผนกที่ส่ง Daily ในแต่ละวัน, ตารางส่ง Weekly/Monthly ทั้งหมดนี้พิมพ์เป็น PDF, คัดลอก หรือส่งเข้า LINE ได้
- **จัดการงาน** (เห็นเฉพาะบัญชีผู้บริหาร): เพิ่ม แก้ ลบ หรือเรียงลำดับงาน และเพิ่มหรือลบแผนกได้ รายการงานเก็บใน `shared_state` คีย์ `dwp:plan` ถ้ายังไม่มีคีย์นี้ ระบบจะใช้ `public/dwp-plan.js` แทน งานแต่ละรายการมีรหัสถาวร การแก้ไขหรือเรียงใหม่จึงไม่ทำให้ข้อมูลที่ติ๊กไว้ไปตกอยู่กับงานอื่น
- **ติดตั้งเป็นแอป (PWA)**: บน Android หรือ Chrome ให้กดปุ่ม "⬇ ติดตั้งแอป" ที่หัวหน้า บน iPhone ให้เปิดด้วย Safari แล้วเลือก แชร์ → "เพิ่มไปยังหน้าจอโฮม"

**เข้าโดยไม่ต้องใส่รหัส**: เปิด `work.html` แล้วระบบจะเข้าเป็นพนักงานให้ทันที (ใช้ Supabase anonymous sign-in) ผู้ใช้แบบนี้ติ๊กงานและส่งรายงานได้ แต่เข้าถึงได้เฉพาะข้อมูลแผนงานแผนก (`dwp:*`) แก้รายการงานไม่ได้ และไม่เห็นแดชบอร์ดปี 2570 หรือตัวเลขการเงิน ผู้บริหารให้กดปุ่ม "เข้าสู่ระบบผู้บริหาร" แล้วใส่รหัส ถ้ายังไม่ได้เปิด anonymous sign-in หน้าเว็บจะแสดงช่องใส่รหัสเหมือนเดิม
ตั้งค่าอัตโนมัติ: workflow `.github/workflows/supabase.yml` จะรัน migration ตั้งแต่ `20261127000006` เปิด anonymous sign-in และ deploy `line-notify` ให้เองทุกครั้งที่ `supabase/` บน `main` เปลี่ยน (หรือสั่งรันเองที่ Actions → "Apply Supabase setup") ต้องมี Repository secrets 2 ตัว:
- `SUPABASE_DB_URL`: Supabase → ปุ่ม **Connect** → **Session pooler** → คัดลอก URI แล้วแทน `[YOUR-PASSWORD]` ด้วยรหัสฐานข้อมูล
- `SUPABASE_ACCESS_TOKEN`: https://supabase.com/dashboard/account/tokens → Generate new token
(migration ใหม่ต่อจากนี้ต้องเขียนให้รันซ้ำได้)

Migration `20261127000006_dwp_plan_write_exec.sql` จำกัดให้เฉพาะบัญชีผู้บริหาร (`finance = true`) บันทึก `dwp:plan` ได้ ใช้งานด้วยคำสั่ง `npx supabase db push`

### แจ้งเตือน LINE (LINE Messaging API)

LINE Notify ปิดให้บริการไปแล้ว ระบบนี้จึงใช้ LINE Official Account ผ่าน Edge Function `supabase/functions/line-notify`

1. สร้าง LINE Official Account แล้วเปิดใช้ Messaging API ที่ [LINE Developers](https://developers.line.biz/) จากนั้นเก็บ **Channel access token** และ **Channel secret** ไว้
2. ตั้ง secrets แล้ว deploy:
   ```bash
   npx supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=... LINE_CHANNEL_SECRET=... CRON_SECRET=<สุ่มยาว ๆ> SITE_URL=https://md-cmnh.github.io/YEARS-PLAN/work.html
   npx supabase functions deploy line-notify --no-verify-jwt
   ```
3. ตั้งค่าผู้รับข้อความ (ถ้าไม่ตั้ง ระบบจะ broadcast ไปยังทุกคนที่เพิ่มเพื่อนบัญชี OA):
   ใส่ Webhook URL `https://<ref>.supabase.co/functions/v1/line-notify` ใน LINE Developers แล้วเชิญบอทเข้ากลุ่ม LINE ของผู้บริหาร บอทจะตอบ ID ของกลุ่มกลับมา (หรือพิมพ์ `id` ในกลุ่มก็ได้) จากนั้นตั้ง `npx supabase secrets set LINE_TO=<ID>`
4. เปิดใช้ในหน้าเว็บ: ตั้ง `lineNotify: true` ใน `public/config.js` (หรือตั้ง Repository variable `LINE_NOTIFY=true`)
5. เตือนแผนกที่ยังไม่ส่ง Daily ทุกวันเวลา 17:30 น. ให้เปิด extension `pg_cron` และ `pg_net` แล้วรันคำสั่งนี้ใน SQL Editor:
   ```sql
   select cron.schedule('dwp-line-reminder', '30 10 * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/line-notify',
       headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
       body := '{"type":"reminder"}'::jsonb)
   $$);
   ```
   (10:30 UTC = 17:30 น. เวลาไทย) การเตือนนี้อ่านรายชื่อแผนกจาก `dwp:plan` ซึ่งระบบจะบันทึกให้เองเมื่อเปิดแอปด้วยบัญชีผู้บริหารหลังเปิดใช้ LINE
