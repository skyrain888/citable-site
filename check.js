// 首页「在线检测」：调用同域的 POST /api/audit（快速模式：不以爬虫身份探测），展示分数、各平台结论和最该先改的 3 件事。
// 统计只记录是否完成、分数段和耗时，不记录检测的网址（与插件的统计口径一致）。
(() => {
  const STATUS = {
    ok: { label: "可引用", cls: "ok", icon: "✓" },
    limited: { label: "受限", cls: "warn", icon: "!" },
    blocked: { label: "被挡住", cls: "bad", icon: "✕" },
    unknown: { label: "无法确认", cls: "muted", icon: "?" },
  };
  const STEPS = ["读取 robots.txt，逐个判断 AI 爬虫能不能进", "以不执行 JavaScript 的方式解析页面", "检查结构化数据、标题和日期", "生成各平台结论"];
  const bucket = (s) => (s >= 90 ? "90+" : s >= 75 ? "75-89" : s >= 60 ? "60-74" : s >= 40 ? "40-59" : "0-39");
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
    if (r.unscored) return "无法评分";
    const core = r.platforms.filter((p) => p.id !== "grok" && p.id !== "deepseek");
    const blocked = core.filter((p) => p.status === "blocked").length;
    const limited = core.filter((p) => p.status === "limited").length;
    if (!blocked && !limited) return "主流 AI 平台都可以抓取这个页面";
    return [blocked && `${blocked} 个 AI 平台无法引用`, limited && `${limited} 个只能读到部分内容`].filter(Boolean).join("，");
  }

  function render(box, data, ms) {
    const r = data.report;
    box.replaceChildren();
    const head = el("div", "res-head");
    const ring = el("div", "ring" + (r.unscored ? " ring-na" : ""));
    ring.style.setProperty("--p", r.unscored ? 0 : r.score);
    ring.dataset.tone = r.unscored ? "na" : r.score >= 75 ? "ok" : r.score >= 60 ? "warn" : "bad";
    ring.append(el("b", null, r.unscored ? "—" : String(r.score)), el("span", null, r.unscored ? "无法评分" : r.grade));
    const meta = el("div", "res-meta");
    meta.append(el("strong", null, headline(r)), el("span", "res-url", r.url));
    if (r.requestedUrl) meta.append(el("span", "note", "已跟随跳转，按最终页面检测"));
    if (r.unscored) meta.append(el("span", "note", `${r.unscored}。网站可能拒绝了我们的检测服务器；在你自己的浏览器里用插件检测不受影响。`));
    else for (const c of r.caps || []) meta.append(el("span", "cap", `分数上限 ${c.max}：${c.reason}`));
    head.append(ring, meta);
    box.append(head);

    for (const [market, title] of [["cn", "国内 AI"], ["global", "海外 AI"]]) {
      const ps = r.platforms.filter((p) => p.market === market);
      if (!ps.length) continue;
      const g = el("div", "res-group");
      g.append(el("h4", null, title));
      const grid = el("ul", "chips");
      for (const p of ps) {
        const s = STATUS[p.status] || STATUS.unknown;
        const li = el("li", "chip " + s.cls);
        li.title = p.reason;
        li.append(el("span", "chip-name", p.name), el("span", "chip-st", `${s.icon} ${s.label}`));
        grid.append(li);
      }
      g.append(grid);
      box.append(g);
    }
    const why = r.platforms.filter((p) => p.status === "blocked" || p.status === "limited");
    if (why.length) {
      const d = el("details", "why");
      d.append(el("summary", null, `为什么有 ${why.length} 个平台被挡住或受限`));
      const ul = el("ul");
      for (const p of why) {
        const li = el("li");
        li.append(el("b", null, p.name + "："), document.createTextNode(p.reason));
        ul.append(li);
      }
      d.append(ul);
      box.append(d);
    }

    const checks = new Map(r.checks.map((c) => [c.id, c]));
    const top = (r.topIssues || []).map((id) => checks.get(id)).filter(Boolean).slice(0, 3);
    if (top.length && !r.unscored) {
      const t = el("div", "res-group");
      t.append(el("h4", null, "先改这 3 件事"));
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
    const actions = document.querySelector("[data-cta-template]")?.cloneNode(true);
    if (actions) {
      actions.removeAttribute("data-cta-template");
      actions.hidden = false;
      actions.querySelectorAll("[data-bound]").forEach((n) => delete n.dataset.bound); // 复制来的节点没有事件监听，重新绑定
      cta.append(actions);
      window.CITABLE_APPLY_LINKS?.(actions, "online_check");
    }
    box.append(cta);
    box.append(el("p", "note", `检测耗时 ${(ms / 1000).toFixed(1)} 秒${data.cached ? "（1 小时内的缓存结果）" : ""}。觉得结论不对？`));
    const fb = box.lastChild;
    const a = el("a", null, "告诉我们");
    a.href = "feedback.html?from=online_check";
    fb.append(a);
  }

  function fail(box, status, body) {
    const msg =
      status === 429
        ? body?.error === "BusyError"
          ? "这个网站正在被检测，请几秒后再试。"
          : "检测太频繁了，请 1 分钟后再试。"
        : status === 400
          ? body?.error === "UnsafeUrlError"
            ? "这个地址无法检测（内网地址或不支持的网址）。"
            : "网址格式不对，请检查后再试。"
          : "没能完成检测：网站没有响应，或拒绝了我们的检测服务器。用插件在你自己的浏览器里检测不受影响。";
    box.replaceChildren(el("p", "res-error", msg));
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("check-form");
    if (!form) return;
    const input = form.querySelector("input");
    const btn = form.querySelector("button");
    const box = document.getElementById("check-result");
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
      if (!url) {
        box.hidden = false;
        box.replaceChildren(el("p", "res-error", "请输入一个完整的网址，例如 https://www.example.com/blog/post"));
        return;
      }
      btn.disabled = true;
      box.hidden = false;
      const loading = el("div", "res-loading");
      const step = el("span", null, STEPS[0]);
      loading.append(el("span", "spinner"), step);
      box.replaceChildren(loading);
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
          fail(box, res.status, body);
          window.CITABLE_TRACK?.("site_check_failed", { status: res.status, reason: body?.error || "" });
        } else {
          render(box, body, ms);
          window.CITABLE_TRACK?.("site_check_completed", {
            score_bucket: body.report.unscored ? "unscored" : bucket(body.report.score),
            blocked_count: body.report.platforms.filter((p) => p.status === "blocked").length,
            duration_ms: Math.round(ms),
            cached: !!body.cached,
          });
        }
      } catch {
        fail(box, 0, null);
        window.CITABLE_TRACK?.("site_check_failed", { status: 0, reason: "network" });
      } finally {
        clearInterval(timer);
        btn.disabled = false;
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  });
})();
