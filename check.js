// 首页「在线检测」：调用同域的 POST /api/audit（快速模式：不以爬虫身份探测），展示分数、各平台结论和最该先改的 3 件事。
// 统计只记录是否完成、分数段、耗时等，不记录检测的网址（与插件的统计口径一致）。
// 支持 ?url= 打开即检测，方便把结果链接发给别人。
(() => {
  const STATUS = {
    ok: { label: "可引用", cls: "ok", icon: "✓" },
    limited: { label: "受限", cls: "warn", icon: "!" },
    blocked: { label: "被挡住", cls: "bad", icon: "✕" },
    unknown: { label: "无法确认", cls: "muted", icon: "?" },
  };
  const STEPS = ["读取 robots.txt，逐个判断 AI 爬虫能不能进", "以不执行 JavaScript 的方式解析页面", "检查结构化数据、标题和日期", "生成各平台结论"];
  const bucket = (s) => (s >= 90 ? "90+" : s >= 75 ? "75-89" : s >= 60 ? "60-74" : s >= 40 ? "40-59" : "0-39");
  const live = () => !!(window.CITABLE_LINKS && (window.CITABLE_LINKS.chrome || window.CITABLE_LINKS.edge));
  // 平台原因里针对插件写的提示，在网页版里没有意义
  const cleanReason = (r) => r.replace(/（CDN \/ WAF 拦截需云端检测确认）/g, "");
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function normalize(input) {
    let v = input.trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    try {
      const u = new URL(v);
      return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.href : null;
    } catch {
      return null;
    }
  }

  function headline(r) {
    const core = r.platforms.filter((p) => p.id !== "grok" && p.id !== "deepseek");
    const blocked = core.filter((p) => p.status === "blocked").length;
    const limited = core.filter((p) => p.status === "limited").length;
    if (!blocked && !limited) return "robots.txt 和页面内容都允许主流 AI 平台抓取";
    return [blocked && `${blocked} 个 AI 平台无法引用`, limited && `${limited} 个只能读到部分内容`].filter(Boolean).join("，");
  }

  /** 插入一组安装按钮（商店上线前是「订阅上线提醒」）。 */
  function installActions(campaign) {
    const actions = document.querySelector("[data-cta-template]")?.cloneNode(true);
    if (!actions) return null;
    actions.removeAttribute("data-cta-template");
    actions.hidden = false;
    actions.querySelectorAll("[data-bound]").forEach((n) => delete n.dataset.bound); // 复制来的节点没有事件监听，重新绑定
    window.CITABLE_APPLY_LINKS?.(actions, campaign);
    return actions;
  }

  function feedbackLine(box, url, ms, cached) {
    const p = el("p", "note", `检测耗时 ${(ms / 1000).toFixed(1)} 秒${cached ? "（1 小时内的缓存结果）" : ""}。觉得结论不对？`);
    const a = el("a", null, "告诉我们");
    a.href = `feedback.html?from=online_check&url=${encodeURIComponent(url)}`;
    p.append(a);
    box.append(p);
  }

  function shareButton(url) {
    const share = new URL(location.href);
    share.search = "";
    share.hash = "";
    share.searchParams.set("url", url);
    const b = el("button", "btn small secondary", "复制结果链接");
    b.type = "button";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(share.href);
        b.textContent = "已复制";
      } catch {
        b.textContent = share.href;
      }
      window.CITABLE_TRACK?.("site_check_shared", {});
      setTimeout(() => (b.textContent = "复制结果链接"), 2000);
    });
    return b;
  }

  function renderUnscored(box, r, ms, cached) {
    const head = el("div", "res-head");
    const ring = el("div", "ring");
    ring.dataset.tone = "na";
    ring.append(el("b", null, "—"), el("span", null, "无法评分"));
    const meta = el("div", "res-meta");
    meta.append(el("strong", null, "这个网站拒绝了我们的检测服务器"), el("span", "res-url", r.url));
    meta.append(el("span", "note", "很多网站会拦截来自服务器的请求（例如返回 403），这不代表真实的 AI 爬虫也会被拦截，所以这里不下结论。"));
    head.append(ring, meta);
    box.append(head);
    const cta = el("div", "res-cta");
    const p = el("p");
    if (live()) p.append(el("b", null, "用插件在你自己的浏览器里检测，不受这个限制。"));
    else p.append(el("b", null, "插件上线后，可以在你自己的浏览器里检测，不受这个限制。"));
    cta.append(p);
    const actions = installActions("online_check_unscored");
    if (actions) cta.append(actions);
    box.append(cta);
    feedbackLine(box, r.url, ms, cached);
  }

  function render(box, data, ms) {
    const r = data.report;
    box.replaceChildren();
    if (r.unscored) return renderUnscored(box, r, ms, data.cached);

    const head = el("div", "res-head");
    const ring = el("div", "ring");
    ring.style.setProperty("--p", r.score);
    ring.dataset.tone = r.score >= 75 ? "ok" : r.score >= 60 ? "warn" : "bad";
    ring.append(el("b", null, String(r.score)), el("span", null, r.grade));
    const meta = el("div", "res-meta");
    meta.append(el("strong", null, headline(r)), el("span", "res-url", r.url));
    if (r.requestedUrl) meta.append(el("span", "note", "已跟随跳转，按最终页面检测"));
    for (const c of r.caps || []) meta.append(el("span", "cap", `分数上限 ${c.max}：${c.reason}`));
    meta.append(el("span", "note", "快速检测：未以 AI 爬虫身份实测请求，CDN / 防火墙的拦截查不出来"));
    head.append(ring, meta);
    box.append(head);

    for (const [market, title] of [["cn", "国内 AI"], ["global", "海外 AI"]]) {
      const ps = r.platforms.filter((p) => p.market === market);
      if (!ps.length) continue;
      const g = el("div", "res-group");
      g.append(el("h2", "res-h", title));
      const grid = el("ul", "chips");
      for (const p of ps) {
        const s = STATUS[p.status] || STATUS.unknown;
        const li = el("li", "chip " + s.cls);
        li.title = cleanReason(p.reason);
        li.append(el("span", "chip-name", p.name), el("span", "chip-st", `${s.icon} ${s.label}`));
        grid.append(li);
      }
      g.append(grid);
      box.append(g);
    }
    // 有问题的平台默认展开原因；其余平台的判断依据收在另一个折叠里，手机上也能看到
    const problems = r.platforms.filter((p) => p.status === "blocked" || p.status === "limited");
    const reasons = (title, list, open) => {
      if (!list.length) return;
      const d = el("details", "why");
      d.open = open;
      d.append(el("summary", null, title));
      const ul = el("ul");
      for (const p of list) {
        const li = el("li");
        li.append(el("b", null, p.name + "："), document.createTextNode(cleanReason(p.reason)));
        ul.append(li);
      }
      d.append(ul);
      box.append(d);
    };
    reasons(`为什么有 ${problems.length} 个平台被挡住或受限`, problems, true);
    reasons(problems.length ? "其余平台的判断依据" : "查看每个平台的判断依据", r.platforms.filter((x) => !problems.includes(x)), false);

    const checks = new Map(r.checks.map((c) => [c.id, c]));
    const top = (r.topIssues || []).map((id) => checks.get(id)).filter(Boolean).slice(0, 3);
    if (top.length) {
      const t = el("div", "res-group");
      t.append(el("h2", "res-h", "先改这 3 件事"));
      const ol = el("ol", "fixes");
      for (const c of top) {
        const li = el("li");
        li.append(el("b", null, c.title), el("span", null, c.message.length > 140 ? c.message.slice(0, 140) + "…" : c.message));
        ol.append(li);
      }
      t.append(ol);
      box.append(t);
    }

    const cta = el("div", "res-cta");
    const p = el("p");
    p.append(el("b", null, "修复代码、完整报告和 JavaScript 渲染对比在插件里。"), document.createTextNode("这次是快速检测：只读取了服务器返回的 HTML，没有以 AI 爬虫身份实测请求，也没有对比浏览器渲染后的页面。"));
    cta.append(p);
    const row = el("div", "btn-row");
    const actions = installActions("online_check");
    if (actions) row.append(actions);
    row.append(shareButton(r.requestedUrl || r.url));
    cta.append(row);
    box.append(cta);
    feedbackLine(box, r.url, ms, data.cached);
  }

  function failMessage(status, body) {
    if (status === 429) return body?.error === "BusyError" ? "这个网站正在被检测，请几秒后再试。" : "检测太频繁了，请 1 分钟后再试。";
    if (status === 400 && body?.error === "UnsafeUrlError") {
      return /无法解析域名/.test(body.message || "") ? "找不到这个域名，请检查网址拼写。" : body.message || "这个地址无法检测。";
    }
    if (status === 400) return "网址格式不对，请检查后再试。";
    return "没能完成检测：网站没有响应，或拒绝了我们的检测服务器。";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("check-form");
    if (!form) return;
    const input = form.querySelector("input");
    const btn = form.querySelector("button");
    const box = document.getElementById("check-result");
    const status = document.getElementById("check-status");
    const hero = document.querySelector(".hero");
    const say = (t) => status && (status.textContent = t);

    document.querySelectorAll("[data-example]").forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        input.value = a.dataset.example;
        form.requestSubmit();
      }),
    );

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = normalize(input.value);
      box.hidden = false;
      if (!url) {
        box.replaceChildren(el("p", "res-error", "请输入一个完整的网址，例如 https://www.example.com/blog/post"));
        say("网址格式不对");
        return;
      }
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.textContent = "检测中…";
      const loading = el("div", "res-loading");
      const step = el("span", null, STEPS[0]);
      loading.append(el("span", "spinner"), step);
      box.replaceChildren(loading);
      say("正在检测，通常需要几秒");
      let i = 0;
      const timer = setInterval(() => (step.textContent = STEPS[Math.min(++i, STEPS.length - 1)]), 1400);
      const started = performance.now();
      window.CITABLE_TRACK?.("site_check_started", {});
      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, probe_bots: false }),
          signal: AbortSignal.timeout(45000),
        });
        const body = await res.json().catch(() => null);
        const ms = performance.now() - started;
        if (!res.ok || !body?.report) {
          const msg = failMessage(res.status, body);
          box.replaceChildren(el("p", "res-error", msg));
          say(msg);
          window.CITABLE_TRACK?.("site_check_failed", { status: res.status, reason: body?.error || "" });
        } else {
          render(box, body, ms);
          hero?.classList.add("has-result");
          const r = body.report;
          say(r.unscored ? "检测完成：这个网站拒绝了检测服务器，无法评分" : `检测完成：${r.score} 分，${headline(r)}`);
          const share = new URL(location.href);
          share.searchParams.set("url", r.requestedUrl || r.url);
          history.replaceState(null, "", share.pathname + share.search + "#check");
          window.CITABLE_TRACK?.("site_check_completed", {
            score_bucket: r.unscored ? "unscored" : bucket(r.score),
            blocked_count: r.platforms.filter((p) => p.status === "blocked").length,
            duration_ms: Math.round(ms),
            cached: !!body.cached,
          });
        }
      } catch {
        const msg = failMessage(0, null);
        box.replaceChildren(el("p", "res-error", msg));
        say(msg);
        window.CITABLE_TRACK?.("site_check_failed", { status: 0, reason: "network" });
      } finally {
        clearInterval(timer);
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        btn.textContent = "开始检测";
        // 结果比一屏高时滚到结果顶部（#check-result 设了 scroll-margin-top，避开吸顶导航）
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    // ?url= 打开即检测
    const preset = new URLSearchParams(location.search).get("url");
    if (preset) {
      input.value = preset;
      window.CITABLE_TRACK?.("site_check_from_link", {});
      form.requestSubmit();
    }
  });
})();
