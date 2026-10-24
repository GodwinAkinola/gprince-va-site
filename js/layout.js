// Injects the shared header and footer so every page stays consistent.
(function () {
  const C = window.SITE_CONFIG || {};
  const links = [["index.html","Home"],["about.html","About"],["services.html","Services"],
    ["portfolio.html","Portfolio"],["blog.html","Blog"],["contact.html","Contact"]];
  const here = location.pathname.split("/").pop() || "index.html";
  const nav = links.map(([h,t]) =>
    `<li><a href="${h}"${h===here?' aria-current="page"':''}>${t}</a></li>`).join("");
  document.getElementById("site-header").innerHTML = `
    <div class="wrap bar">
      <a class="brand" href="index.html">Gprince<small>Administrative Virtual Assistant</small></a>
      <button class="menu-btn" aria-expanded="false" aria-controls="main-nav">Menu</button>
      <nav id="main-nav" aria-label="Main"><ul>${nav}</ul></nav>
    </div>`;
  const btn = document.querySelector(".menu-btn"), n = document.getElementById("main-nav");
  btn.addEventListener("click", () => {
    const open = n.classList.toggle("open"); btn.setAttribute("aria-expanded", open);
  });
  document.getElementById("site-footer").innerHTML = `
    <div class="wrap"><div class="cols">
      <div><strong>Gprince | Administrative Virtual Assistant</strong>
        <p>Remote administrative support for local and international clients.</p></div>
      <div><strong>Navigate</strong><ul style="list-style:none;padding:0">${links.map(([h,t])=>`<li><a href="${h}">${t}</a></li>`).join("")}</ul></div>
      <div><strong>Contact</strong><p><a href="mailto:${C.EMAIL||""}">${C.EMAIL||""}</a></p></div>
    </div><p class="fine">&copy; ${new Date().getFullYear()} Gprince. All rights reserved.</p></div>`;
})();

// Vercel Web Analytics (cookieless). Only reports once enabled in the Vercel dashboard.
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
(function () {
  const s = document.createElement("script"); s.defer = true; s.src = "/_vercel/insights/script.js"; document.head.appendChild(s);
  // Count clicks on "contact" calls to action (custom events need a paid Vercel plan; harmless otherwise).
  document.addEventListener("click", e => {
    const a = e.target.closest("a.btn"); if (a && /contact\.html/.test(a.getAttribute("href") || "")) window.va("event", { name: "cta_click" });
  });
})();
