// Admin dashboard. Security note: this page only DISPLAYS controls. Real protection
// is the database: Row Level Security allows writes only for accounts in admin_users.
const C = window.SITE_CONFIG;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const show = (id, on) => $(id).hidden = !on;
let recovering = false;

// ---- Table definitions drive the generic editor ----
const T = {
  services: { label: "Services", order: "sort_order", cols: ["title", "is_published"], slugFrom: "title", fields: [
    ["title","Title","text"],["summary","Short description","area"],["value_statement","Why it is valuable","area"],
    ["deliverables","Deliverables (one per line)","list"],["cta_label","Button text","text"],
    ["sort_order","Display order (number)","num"],["is_published","Published","check"]]},
  skills: { label: "Skills & tools", order: "sort_order", cols: ["name", "kind", "is_published"], fields: [
    ["name","Name","text"],["kind","Type","select",["skill","tool"]],["sort_order","Display order","num"],["is_published","Published","check"]]},
  portfolio_projects: { label: "Portfolio", order: "created_at", cols: ["title", "status", "is_sample"], slugFrom: "title", fields: [
    ["title","Title","text"],["category_id","Category","cat","portfolio_categories"],["description","Description","area"],
    ["skills_demonstrated","Skills demonstrated (one per line)","list"],["tools_used","Tools used (one per line)","list"],
    ["image_path","Image (jpg, png, webp, max 5 MB)","file","portfolio"],["document_path","Downloadable document (pdf)","file","portfolio"],
    ["external_url","External link (optional, https://)","text"],["project_date","Date","date"],
    ["is_sample","This is a sample/practice project","check"],["status","Status","select",["draft","published"]]]},
  blog_posts: { label: "Blog", order: "created_at", cols: ["title", "status", "published_at"], slugFrom: "title", preview: true, fields: [
    ["title","Title","text"],["slug","URL slug (auto if empty)","text"],["excerpt","Excerpt","area"],["content","Article (blank line = new paragraph)","area"],
    ["featured_image_path","Featured image","file","blog"],["category_id","Category","cat","blog_categories"],
    ["tags","Tags (one per line)","list"],["author","Author","text"],["seo_title","SEO title","text"],
    ["meta_description","Meta description (max 200)","area"],["status","Status","select",["draft","published"]]]},
};
const SETTINGS = [["hero_headline","Homepage headline"],["hero_intro","Homepage introduction"],["about_text","About page text"],
  ["contact_email","Contact email"],["footer_text","Footer text"],["social_links","Social links (only real ones)"]];

// ---- Auth ----
async function boot() {
  const { data } = await sb.auth.getSession();
  data.session ? enter() : (show("#login", true), show("#app", false));
}
sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY") { recovering = true; show("#login", true); show("#login-form", false); show("#reset-form", true); show("#app", false); } });
$("#login-form").addEventListener("submit", async e => {
  e.preventDefault(); $("#login-msg").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("#email").value, password: $("#password").value });
  if (error) { $("#login-msg").textContent = "Sign-in failed. Check your email and password."; return; }
  enter();
});
$("#forgot").addEventListener("click", async e => {
  e.preventDefault(); const em = $("#email").value;
  if (!em) { $("#login-msg").textContent = "Type your email above first."; return; }
  await sb.auth.resetPasswordForEmail(em, { redirectTo: location.href.split("#")[0] });
  $("#login-msg").textContent = "If that email is registered, a reset link has been sent.";
});
$("#reset-form").addEventListener("submit", async e => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $("#newpass").value });
  if (error) { $("#reset-msg").textContent = "Could not update password: " + error.message; return; }
  recovering = false; show("#reset-form", false); show("#login-form", true); enter();
});
$("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

async function enter() {
  // Ask the database whether this account is in the admin allow-list.
  const { data, error } = await sb.from("admin_users").select("user_id").limit(1);
  if (error || !data || !data.length) {
    await sb.auth.signOut(); show("#app", false); show("#login", true);
    $("#login-msg").textContent = "This account is not authorised as an administrator."; return;
  }
  show("#login", false); show("#app", true);
  const items = [["overview","Overview"], ...Object.entries(T).map(([k,v]) => [k,v.label]), ["inquiries","Inquiries"], ["settings","Settings"], ["analytics","Analytics"]];
  $("#side").innerHTML = items.map(([k,l]) => `<button data-v="${k}">${l}</button>`).join("");
  $("#side").onclick = e => { const b = e.target.closest("button"); if (b) go(b.dataset.v); };
  go("overview");
}
function go(v) {
  document.querySelectorAll("#side button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  const view = $("#view"); view.innerHTML = `<p class="state">Loading…</p>`;
  ({ overview, inquiries, settings, analytics }[v] || (() => list(v)))(view).catch(err => view.innerHTML = `<p class="err">Something went wrong: ${esc(err.message)}</p>`);
  view.focus();
}
const count = async (t, f) => { let q = sb.from(t).select("*", { count: "exact", head: true }); if (f) q = f(q); const { count: n, error } = await q; if (error) throw error; return n; };

// ---- Overview (real counts only) ----
async function overview(v) {
  const [pp, pd, bp, bd, ni, ip] = await Promise.all([
    count("portfolio_projects", q => q.eq("status","published")), count("portfolio_projects", q => q.eq("status","draft")),
    count("blog_posts", q => q.eq("status","published")), count("blog_posts", q => q.eq("status","draft")),
    count("contact_inquiries", q => q.eq("status","new")), count("contact_inquiries", q => q.eq("status","in_progress"))]);
  const s = [["Published projects",pp],["Draft projects",pd],["Published articles",bp],["Draft articles",bd],["New inquiries",ni],["Awaiting follow-up",ip]];
  v.innerHTML = `<h1>Overview</h1><div class="stats">${s.map(([l,n]) => `<div class="card"><b>${n}</b>${l}</div>`).join("")}</div>`;
}

// ---- Generic list + editor ----
async function list(key) {
  const d = T[key], v = $("#view");
  const { data, error } = await sb.from(key).select("*").order(d.order, { ascending: d.order === "sort_order" });
  if (error) throw error;
  v.innerHTML = `<div class="row"><h1>${d.label}</h1><button class="btn btn-primary sm" id="new">Add new</button></div>
   ${data.length ? `<table><thead><tr>${d.cols.map(c => `<th>${esc(c.replace(/_/g," "))}</th>`).join("")}<th></th></tr></thead><tbody>
   ${data.map(r => `<tr>${d.cols.map(c => `<td>${esc(typeof r[c]==="boolean" ? (r[c]?"Yes":"No") : r[c])}</td>`).join("")}
   <td class="row"><button class="btn btn-ghost sm" data-e="${r.id}">Edit</button><button class="btn btn-ghost sm danger" data-d="${r.id}">Delete</button></td></tr>`).join("")}</tbody></table>` : `<p class="state">Nothing here yet.</p>`}`;
  $("#new").onclick = () => form(key, null);
  v.onclick = async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.e) form(key, data.find(r => r.id === b.dataset.e));
    if (b.dataset.d && confirm("Delete this item permanently? This cannot be undone.")) {
      const { error } = await sb.from(key).delete().eq("id", b.dataset.d); if (error) alert("Delete failed: " + error.message); else go(key);
    }
  };
}
async function form(key, row) {
  const d = T[key], v = $("#view"), cats = {};
  for (const f of d.fields) if (f[2] === "cat") cats[f[3]] = (await sb.from(f[3]).select("id,name").order("name")).data || [];
  const val = (f) => row ? row[f[0]] : (f[2]==="check" ? (f[0]==="is_published"||f[0]==="is_sample") : f[0]==="author" ? "Gprince" : f[0]==="cta_label" ? "Discuss Your Needs" : f[0]==="status" ? "draft" : "");
  const input = f => {
    const [k, l, t, x] = f, cur = val(f), id = `f_${k}`;
    if (t === "area") return `<label>${l}<textarea id="${id}">${esc(cur)}</textarea></label>`;
    if (t === "list") return `<label>${l}<textarea id="${id}">${esc((cur||[]).join("\n"))}</textarea></label>`;
    if (t === "check") return `<label><input type="checkbox" id="${id}" ${cur?"checked":""}> ${l}</label>`;
    if (t === "select") return `<label>${l}<select id="${id}">${x.map(o => `<option ${o===cur?"selected":""}>${o}</option>`).join("")}</select></label>`;
    if (t === "cat") return `<label>${l}<select id="${id}"><option value="">None</option>${cats[x].map(c => `<option value="${c.id}" ${c.id===cur?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label>`;
    if (t === "file") return `<label>${l}<input type="file" id="${id}" accept="image/jpeg,image/png,image/webp${x==="portfolio"&&k==="document_path"?",application/pdf":""}">${cur?`<small>Current: ${esc(cur)}</small>`:""}</label>`;
    return `<label>${l}<input id="${id}" type="${t==="num"?"number":t==="date"?"date":"text"}" value="${esc(cur)}"></label>`;
  };
  v.onclick = null;
  v.innerHTML = `<h1>${row?"Edit":"New"} ${esc(d.label)}</h1><form id="ef">${d.fields.map(input).join("")}
    <p id="fmsg" role="alert" class="err"></p><div class="row"><button class="btn btn-primary">Save</button>
    ${d.preview?`<button type="button" class="btn btn-ghost" id="pv">Preview</button>`:""}<button type="button" class="btn btn-ghost" id="cancel">Cancel</button></div></form>`;
  $("#cancel").onclick = () => go(key);
  if (d.preview) $("#pv").onclick = () => { $("#dlg-body").innerHTML = `<h1>${esc($("#f_title").value)}</h1>` + esc($("#f_content").value).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,"<br>")}</p>`).join(""); $("#dlg").showModal(); };
  $("#ef").onsubmit = async e => {
    e.preventDefault(); const msg = $("#fmsg"); msg.textContent = ""; const out = {};
    try {
      for (const [k, , t, x] of d.fields) {
        const el = $(`#f_${k}`);
        if (t === "check") out[k] = el.checked;
        else if (t === "list") out[k] = el.value.split("\n").map(s => s.trim()).filter(Boolean);
        else if (t === "num") out[k] = Number(el.value) || 0;
        else if (t === "file") {
          const file = el.files[0]; out[k] = row ? row[k] : null;
          if (file) {
            const ext = { "image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf" }[file.type];
            if (!ext) throw new Error("Only JPG, PNG, WebP or PDF files are allowed.");
            if (file.size > 5*1024*1024) throw new Error("File is larger than 5 MB.");
            const path = `${crypto.randomUUID()}.${ext}`;   // safe, random file name
            const up = await sb.storage.from(x).upload(path, file, { contentType: file.type });
            if (up.error) throw up.error;
            if (row && row[k]) await sb.storage.from(x).remove([row[k]]);
            out[k] = path;
          }
        } else out[k] = el.value.trim() === "" && ["category_id","project_date","external_url","seo_title","meta_description"].includes(k) ? null : el.value.trim();
      }
      if (d.slugFrom && !out.slug) out.slug = row?.slug || slugify(out[d.slugFrom]) || crypto.randomUUID().slice(0,8);
      if (out.slug) out.slug = slugify(out.slug);
      if (key === "blog_posts") out.published_at = out.status === "published" ? (row?.published_at || new Date().toISOString()) : null;
      const q = row ? sb.from(key).update(out).eq("id", row.id) : sb.from(key).insert(out);
      const { error } = await q; if (error) throw error;
      go(key);
    } catch (err) { msg.textContent = "Could not save: " + err.message; }
  };
}

// ---- Inquiries ----
async function inquiries(v) {
  const { data, error } = await sb.from("contact_inquiries").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  v.innerHTML = `<h1>Inquiries</h1><div class="row"><input id="q" placeholder="Search name, email, message" style="max-width:300px">
    <select id="st" style="max-width:180px"><option value="">All statuses</option><option>new</option><option>in_progress</option><option>resolved</option></select></div><div id="il"></div>`;
  const draw = () => {
    const q = $("#q").value.toLowerCase(), s = $("#st").value;
    const rows = data.filter(r => (!s || r.status === s) && (!q || [r.full_name, r.email, r.message, r.company].join(" ").toLowerCase().includes(q)));
    $("#il").innerHTML = rows.length ? `<table><tbody>${rows.map(r => `<tr><td>${new Date(r.created_at).toLocaleDateString()}</td><td>${esc(r.full_name)}<br><small>${esc(r.email)}</small></td><td>${esc(r.status)}</td><td><button class="btn btn-ghost sm" data-o="${r.id}">Open</button></td></tr>`).join("")}</tbody></table>` : `<p class="state">No inquiries yet.</p>`;
  };
  $("#q").oninput = draw; $("#st").onchange = draw; draw();
  $("#il").onclick = e => { const b = e.target.closest("button"); if (b) openInquiry(data.find(r => r.id === b.dataset.o)); };
}
async function openInquiry(r) {
  const { data: notes } = await sb.from("inquiry_notes").select("*").eq("inquiry_id", r.id).order("created_at");
  const f = [["Name",r.full_name],["Email",r.email],["Company",r.company],["Service",r.service],["Preferred contact",r.preferred_contact],["Budget",r.budget_range],["Message",r.message]];
  $("#dlg-body").innerHTML = `<h2>Inquiry</h2>${f.map(([l,x]) => x ? `<p><strong>${l}:</strong> ${esc(x)}</p>` : "").join("")}
   <label>Status<select id="ns">${["new","in_progress","resolved"].map(o => `<option ${o===r.status?"selected":""}>${o}</option>`).join("")}</select></label>
   <h3>Private notes</h3>${(notes||[]).map(n => `<p>${esc(n.note)}<br><small>${new Date(n.created_at).toLocaleString()}</small></p>`).join("") || "<p>No notes.</p>"}
   <label>Add note<textarea id="nn"></textarea></label><div class="row"><button class="btn btn-primary sm" id="sv">Save</button><button class="btn btn-ghost sm danger" id="rm">Delete inquiry</button></div>`;
  $("#sv").onclick = async () => {
    await sb.from("contact_inquiries").update({ status: $("#ns").value }).eq("id", r.id);
    if ($("#nn").value.trim()) await sb.from("inquiry_notes").insert({ inquiry_id: r.id, note: $("#nn").value.trim() });
    $("#dlg").close(); go("inquiries");
  };
  $("#rm").onclick = async () => { if (confirm("Delete this inquiry and its notes permanently?")) { await sb.from("contact_inquiries").delete().eq("id", r.id); $("#dlg").close(); go("inquiries"); } };
  $("#dlg").showModal();
}

// ---- Settings ----
async function settings(v) {
  const { data } = await sb.from("site_settings").select("*"); const m = Object.fromEntries((data||[]).map(r => [r.key, r.value]));
  v.innerHTML = `<h1>Website settings</h1><form id="sf">${SETTINGS.map(([k,l]) => `<label>${l}<textarea id="s_${k}">${esc(m[k]||"")}</textarea></label>`).join("")}
   <p id="smsg" role="status"></p><button class="btn btn-primary">Save settings</button></form>`;
  $("#sf").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from("site_settings").upsert(SETTINGS.map(([k]) => ({ key: k, value: $(`#s_${k}`).value.trim(), updated_at: new Date().toISOString() })));
    $("#smsg").textContent = error ? "Could not save: " + error.message : "Saved."; $("#smsg").className = error ? "err" : "ok";
  };
}
async function analytics(v) {
  v.innerHTML = `<h1>Analytics</h1><p class="state">Analytics is not configured yet. It is added in Stage 7 (Vercel Web Analytics), and its data is viewed in your Vercel dashboard. Nothing is shown here until real data exists.</p>`;
}
$("#dlg-close").onclick = () => $("#dlg").close();
boot();
