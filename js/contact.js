// Contact form: validates in the browser, then sends to the secure Edge Function.
(function () {
  const C = window.SITE_CONFIG, form = document.getElementById("cf"), msg = document.getElementById("cmsg"), start = Date.now();
  const sel = document.getElementById("service");
  api("services?select=title&order=sort_order").then(rows => {
    sel.innerHTML = `<option value="">Select a service</option>` + rows.map(r => `<option>${esc(r.title)}</option>`).join("") + `<option>Something else</option>`;
    const pre = new URLSearchParams(location.search).get("service");
    if (pre) sel.value = pre;
  }).catch(() => { sel.innerHTML = `<option value="">General enquiry</option>`; });
  form.addEventListener("submit", async e => {
    e.preventDefault(); msg.className = "err"; msg.textContent = "";
    const d = Object.fromEntries(new FormData(form)); d.elapsed_ms = Date.now() - start;
    if (d.full_name.trim().length < 2) return msg.textContent = "Please enter your full name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) return msg.textContent = "Please enter a valid email address.";
    if (d.message.trim().length < 10) return msg.textContent = "Please describe your needs (at least 10 characters).";
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Sending…";
    try {
      const r = await fetch(`${C.SUPABASE_URL}/functions/v1/submit-inquiry`, { method: "POST",
        headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY }, body: JSON.stringify(d) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not send your message.");
      form.hidden = true; if (window.va) window.va("event", { name: "inquiry_submitted" }); msg.className = "ok";
      msg.textContent = "Thank you. Your message has been received, and I will reply to you by email.";
    } catch (err) {
      msg.textContent = err.message + " You can also email akinolagod10@gmail.com directly.";
      btn.disabled = false; btn.textContent = "Send message";
    }
  });
})();
