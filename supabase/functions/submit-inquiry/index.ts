// Edge Function: receives contact-form submissions securely.
// Validates input, blocks bots, rate-limits, saves to the database with a
// server-side key (never visible to browsers), then emails you if configured.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  // Bot traps: a hidden field humans never fill, and a form that was filled in under 3 seconds.
  if (clean(b.website, 100) !== "") return json({ ok: true });            // pretend success
  if (Number(b.elapsed_ms) < 3000) return json({ error: "Please take a moment to complete the form." }, 400);

  const rec = {
    full_name: clean(b.full_name, 120),
    email: clean(b.email, 254),
    company: clean(b.company, 150) || null,
    service: clean(b.service, 150) || null,
    message: clean(b.message, 4000),
    preferred_contact: clean(b.preferred_contact, 50) || null,
    budget_range: clean(b.budget_range, 80) || null,
  };
  if (rec.full_name.length < 2) return json({ error: "Please enter your full name." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) return json({ error: "Please enter a valid email address." }, 400);
  if (rec.message.length < 10) return json({ error: "Please describe your needs in at least 10 characters." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Rate limit: max 3 submissions per hour per visitor (stored only as a hash).
  const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();
  const data = new TextEncoder().encode(ip + (Deno.env.get("SUPABASE_URL") ?? ""));
  const ip_hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data))).map((x) => x.toString(16).padStart(2, "0")).join("");
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("contact_inquiries").select("*", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("created_at", since);
  if ((count ?? 0) >= 3) return json({ error: "Too many messages from your connection. Please try again later or email me directly." }, 429);

  const { error } = await db.from("contact_inquiries").insert({ ...rec, ip_hash });
  if (error) { console.error(error.message); return json({ error: "Something went wrong saving your message. Please email me directly." }, 500); }

  // Optional email notification (only if you add a RESEND_API_KEY secret).
  const key = Deno.env.get("RESEND_API_KEY");
  if (key) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: Deno.env.get("FROM_EMAIL") || "Website <onboarding@resend.dev>",
          to: [Deno.env.get("NOTIFY_EMAIL") || "akinolagod10@gmail.com"],
          reply_to: rec.email,
          subject: `New website inquiry from ${rec.full_name}`.replace(/[\r\n]/g, " "),
          html: `<p><b>Name:</b> ${esc(rec.full_name)}</p><p><b>Email:</b> ${esc(rec.email)}</p>
            <p><b>Company:</b> ${esc(rec.company ?? "")}</p><p><b>Service:</b> ${esc(rec.service ?? "")}</p>
            <p><b>Message:</b><br>${esc(rec.message).replace(/\n/g, "<br>")}</p>`,
        }),
      });
    } catch (e) { console.error("email failed", e); }   // the inquiry is already saved
  }
  return json({ ok: true });
});
