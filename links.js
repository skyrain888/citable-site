// 商店链接集中在这里维护：审核通过后只改这一个文件（scripts/launch-links.sh 会自动改），所有页面的安装按钮会一起更新。
// 留空表示还没上架：安装按钮隐藏，显示「上线提醒」。
window.CITABLE_LINKS = {
  chrome: "",
  edge: "",
};

// 页面访问统计：与插件相同的统计服务（PostHog，已开启丢弃 IP），由 build-site.sh 生成 site-dist 时填入。
// 只记录「哪个页面、从哪个渠道来（utm_*、来源域名）、点了什么」；不用 cookie、不写本地存储、不建用户档案、不记录检测的网址。
const CITABLE_TELEMETRY = { host: "https://citable.mrrpeek.com/ingest", key: "phc_xS4c9noxNTXvZsGECU4eMDQifAWvTw5CFMoAGeHmnicm" };

(() => {
  const q = new URLSearchParams(location.search);
  // 外部渠道带来的 utm 原样传给商店，Chrome 后台才能按来源拆分；直接访问时记为本站
  const utm = {
    utm_source: q.get("utm_source") || "site",
    utm_medium: q.get("utm_medium") || "page",
    utm_campaign: q.get("utm_campaign") || "",
  };
  const page = location.pathname.split("/").pop() || "index.html";
  let referrer = "";
  try {
    referrer = document.referrer ? new URL(document.referrer).hostname : "";
  } catch {}
  const pageId = "site-" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const isEdge = /\bEdg\//.test(navigator.userAgent);

  function send(event, props) {
    if (!/^phc_/.test(CITABLE_TELEMETRY.key)) return; // 未填入写入 Key（本地预览）时不上报
    const body = JSON.stringify({
      api_key: CITABLE_TELEMETRY.key,
      batch: [{ event, distinct_id: pageId, timestamp: new Date().toISOString(), properties: { page, referrer_host: referrer, ...utm, ...props, $process_person_profile: false } }],
    });
    const url = CITABLE_TELEMETRY.host.replace(/\/+$/, "") + "/batch/";
    try {
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch {}
  }
  window.CITABLE_TRACK = send;

  const live = () => !!(window.CITABLE_LINKS.chrome || window.CITABLE_LINKS.edge);

  /** 给 root 下的安装按钮填链接、按商店是否上线切换显示；页面里动态插入的按钮组也调用它。 */
  function apply(root, campaign) {
    const links = window.CITABLE_LINKS;
    root.querySelectorAll("[data-when]").forEach((n) => (n.hidden = (n.dataset.when === "live") !== live()));
    // 访客用的是哪个浏览器，就把哪个商店放在前面并作为主按钮
    root.querySelectorAll("[data-store-group]").forEach((g) => {
      const first = g.querySelector(`[data-store="${isEdge ? "edge" : "chrome"}"]`);
      if (first && links[first.dataset.store]) g.prepend(first);
      g.querySelectorAll("[data-store]").forEach((a, i) => a.classList.toggle("secondary", i > 0));
    });
    root.querySelectorAll("[data-store]").forEach((a) => {
      const store = a.dataset.store;
      const href = links[store];
      if (!href) {
        if (live()) a.hidden = true; // 只上了一个商店：隐藏另一个
        else {
          a.removeAttribute("href");
          a.classList.add("pending");
          a.textContent = a.dataset.pendingText || "审核中，即将上线";
        }
        return;
      }
      const u = new URL(href);
      u.searchParams.set("utm_source", utm.utm_source);
      u.searchParams.set("utm_medium", utm.utm_medium);
      u.searchParams.set("utm_campaign", utm.utm_campaign || campaign || a.dataset.campaign || "site");
      a.href = u.href;
      a.target = "_blank";
      a.rel = "noopener";
      if (!a.dataset.bound) {
        a.dataset.bound = "1";
        a.addEventListener("click", () => send("site_install_clicked", { store, campaign: campaign || a.dataset.campaign || "" }));
      }
    });
    // 上线提醒：两个商店都还没上架时显示「写信订阅」（邮件只到我们的邮箱，不经过统计系统）
    root.querySelectorAll("[data-notify]").forEach((n) => {
      if (live()) return;
      n.hidden = false;
      if (n.dataset.bound) return;
      n.dataset.bound = "1";
      (n.tagName === "A" ? n : n.querySelector("a"))?.addEventListener("click", () => send("launch_notify_clicked", { campaign: campaign || n.dataset.campaign || "" }));
    });
  }
  window.CITABLE_APPLY_LINKS = apply;

  document.addEventListener("DOMContentLoaded", () => {
    send("site_pageview", {});
    apply(document, "");
  });
})();
