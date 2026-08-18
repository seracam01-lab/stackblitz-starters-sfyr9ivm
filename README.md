# KHONGDECH PHOTO FINISH — Cloudflare Ready

ไฟล์ชุดนี้ทำมาสำหรับ Cloudflare Workers โดยตรง

โครงสร้าง:
- public/index.html  หน้าโปรแกรม
- src/index.js       Worker API + Durable Object + QR
- wrangler.jsonc     การตั้งค่า Cloudflare
- package.json       dependencies / คำสั่ง deploy
- .gitignore

วิธีใช้:
1. ใน StackBlitz/GitHub ลบไฟล์โปรเจกต์เดิมทั้งหมด (ยกเว้น .git ถ้ามี)
2. แตก ZIP นี้ในคอม
3. ลากทุกไฟล์และทั้ง 2 โฟลเดอร์ (public, src) ไปวางที่ root ของโปรเจกต์
4. Commit / Push ไป branch main
5. Cloudflare จะ Build ใหม่อัตโนมัติ หรือกด Retry build
6. Deploy command ใช้: npx wrangler deploy

หมายเหตุ:
- ไม่ต้องใช้ launcher.js
- ไม่ต้องใช้ server.js
- ไม่ต้องใช้ tunnel-url.txt / cloudflared
- QR สร้างภายใน Worker
- Camera 1 / Camera 2 ใช้ Durable Object เพื่อแชร์ห้อง เวลา heartbeat และ WebRTC signaling
