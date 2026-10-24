// Public-site data layer. Talks to Supabase's REST API using the PUBLIC anon key.
// RLS rules in the database guarantee visitors only ever receive published content.
const C = window.SITE_CONFIG;
const configured = () => C && !C.SUPABASE_URL.includes("YOUR-PROJECT");

async function api(path) {
  if (!configured()) throw new Error("not-configured");
  const r = await fetch(`${C.SUPABASE_URL}/rest/v1/${path}`,
    { headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: `Bearer ${C.SUPABASE_ANON_KEY}` } });
  if (!r.ok) throw new Error("request-failed");
  return r.json();
}
// Escape text so database content can never inject HTML/scripts.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fileUrl = (bucket, p) => p ? `${C.SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodeURI(p)}` : "";
const msg = (el, e) => el.innerHTML = `<p class="state">${e.message === "not-configured"
  ? "Content will appear here once the backend is connected."
  : "Sorry, this content could not be loaded. Please try again shortly."}</p>`;
const paras = t => esc(t).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,"<br>")}</p>`).join("");

function serviceCard(s) {
  return `<article class="card"><h3>${esc(s.title)}</h3><p>${esc(s.summary)}</p>
    <ul>${(s.deliverables||[]).map(d=>`<li>${esc(d)}</li>`).join("")}</ul>
    <a class="btn btn-ghost" href="contact.html?service=${encodeURIComponent(s.title)}">${esc(s.cta_label)}</a></article>`;
}
async function loadServices(el, limit) {
  try {
    const rows = await api(`services?select=*&order=sort_order${limit?`&limit=${limit}`:""}`);
    el.innerHTML = rows.length ? rows.map(serviceCard).join("") : `<p class="state">No services published yet.</p>`;
  } catch (e) { msg(el, e); }
}
async function loadSkills(el) {
  try {
    const rows = await api("skills?select=name,kind&order=sort_order");
    const list = k => rows.filter(r=>r.kind===k).map(r=>`<li>${esc(r.name)}</li>`).join("") || "<li>Coming soon</li>";
    el.innerHTML = `<div class="card"><h3>Skills</h3><ul>${list("skill")}</ul></div>
      <div class="card"><h3>Tools</h3><ul>${list("tool")}</ul></div>`;
  } catch (e) { msg(el, e); }
}
async function loadPortfolio(el, filterEl) {
  try {
    const [cats, rows] = await Promise.all([
      api("portfolio_categories?select=id,name&order=sort_order"),
      api("portfolio_projects?select=*,portfolio_categories(name)&order=project_date.desc.nullslast")]);
    const draw = id => {
      const shown = rows.filter(r => !id || r.category_id === id);
      el.innerHTML = shown.length ? shown.map(p => `<article class="card">
        ${p.image_path?`<img loading="lazy" src="${esc(fileUrl("portfolio",p.image_path))}" alt="${esc(p.title)} preview">`:""}
        ${p.is_sample?`<span class="tag">Sample project</span>`:""}
        <h3>${esc(p.title)}</h3><p><small>${esc(p.portfolio_categories?.name||"")}</small></p>
        <p>${esc(p.description)}</p>
        ${p.skills_demonstrated?.length?`<p><strong>Skills:</strong> ${p.skills_demonstrated.map(esc).join(", ")}</p>`:""}
        ${p.tools_used?.length?`<p><strong>Tools:</strong> ${p.tools_used.map(esc).join(", ")}</p>`:""}
        ${p.document_path?`<a href="${esc(fileUrl("portfolio",p.document_path))}" rel="noopener">Download document</a>`:""}
        </article>`).join("") : `<p class="state">No projects in this category yet.</p>`;
    };
    filterEl.innerHTML = [`<button class="btn btn-primary" data-id="">All</button>`,
      ...cats.map(c=>`<button class="btn btn-ghost" data-id="${esc(c.id)}">${esc(c.name)}</button>`)].join(" ");
    filterEl.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      filterEl.querySelectorAll("button").forEach(x => x.className = "btn " + (x===b?"btn-primary":"btn-ghost"));
      draw(b.dataset.id);
    });
    draw("");
  } catch (e) { msg(el, e); }
}
async function loadPosts(el, limit = 12) {
  try {
    const rows = await api(`blog_posts?select=slug,title,excerpt,published_at,tags,featured_image_path&order=published_at.desc&limit=${limit}`);
    el.innerHTML = rows.length ? rows.map(p=>`<article class="card">
      ${p.featured_image_path?`<img loading="lazy" src="${esc(fileUrl("blog",p.featured_image_path))}" alt="">`:""}
      <h3><a href="article.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a></h3>
      <p><small>${p.published_at?new Date(p.published_at).toLocaleDateString("en-GB",{dateStyle:"long"}):""}</small></p>
      <p>${esc(p.excerpt)}</p></article>`).join("") : `<p class="state">Articles are coming soon.</p>`;
  } catch (e) { msg(el, e); }
}
async function loadArticle(el) {
  const slug = new URLSearchParams(location.search).get("slug");
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) { el.innerHTML = `<p class="state">Article not found. <a href="blog.html">Back to the blog</a></p>`; return; }
  try {
    const [p] = await api(`blog_posts?slug=eq.${slug}&select=*`);
    if (!p) { el.innerHTML = `<p class="state">Article not found. <a href="blog.html">Back to the blog</a></p>`; return; }
    document.title = `${p.seo_title || p.title} | Gprince`;
    const m = document.querySelector('meta[name="description"]'); if (m) m.content = p.meta_description || p.excerpt;
    el.innerHTML = `<h1>${esc(p.title)}</h1><p><small>By ${esc(p.author)} · ${p.published_at?new Date(p.published_at).toLocaleDateString("en-GB",{dateStyle:"long"}):""}</small></p>
      ${p.featured_image_path?`<img src="${esc(fileUrl("blog",p.featured_image_path))}" alt="">`:""}${paras(p.content)}`;
  } catch (e) { msg(el, e); }
}

async function loadFeatured(el) {
  try {
    const rows = await api("portfolio_projects?select=title,description,is_sample,image_path&order=project_date.desc.nullslast&limit=3");
    el.innerHTML = rows.length ? rows.map(p => `<article class="card">
      ${p.image_path?`<img loading="lazy" src="${esc(fileUrl("portfolio",p.image_path))}" alt="${esc(p.title)} preview">`:""}
      ${p.is_sample?`<span class="tag">Sample project</span>`:""}<h3>${esc(p.title)}</h3><p>${esc(p.description)}</p></article>`).join("")
      : `<p class="state">Sample projects are coming soon.</p>`;
  } catch (e) { msg(el, e); }
}
