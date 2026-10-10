(() => {
  let frame = 0;
  function tick() { frame += 1; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  let previous = "";
  const pending = [];
  const nodeIds = new WeakMap();
  let nextId = 1;
  function capture() {
    const root = document.querySelector("#root");
    if (!root) return;
    const drawers = Array.from(document.querySelectorAll("[data-persistent-drawer-content]")).map((drawer) => {
      if (!nodeIds.has(drawer)) nodeIds.set(drawer, nextId++);
      const label = document.getElementById(drawer.getAttribute("aria-labelledby"));
      const name = drawer.querySelector('input[name="name"]');
      return {
        id: nodeIds.get(drawer), title: label?.textContent,
        state: drawer.getAttribute("data-state"),
        placeholder: Boolean(drawer.querySelector("[data-responsive-drawer-placeholder]")),
        realized: Boolean(name), name: name?.value ?? null,
        matrix: getComputedStyle(drawer).transform,
        height: drawer.clientHeight, scrollHeight: drawer.scrollHeight,
        verticalScrollers: Array.from(drawer.querySelectorAll("*"))
          .filter((element) => ["auto", "scroll"].includes(getComputedStyle(element).overflowY))
          .map((element) => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop })),
      };
    });
    const state = {
      path: location.pathname, rootInert: root.inert,
      secureContext: isSecureContext, randomUUIDAvailable: typeof crypto.randomUUID === "function",
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((element) => element.textContent),
      rootHidden: root.getAttribute("aria-hidden"), drawers,
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      viewportHeight: visualViewport?.height ?? innerHeight,
    };
    const signature = JSON.stringify(state);
    if (signature === previous) return;
    previous = signature;
    pending.push({ ...state, frame, time: performance.now() });
  }
  const observer = new MutationObserver(capture);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["inert", "aria-hidden", "data-state"] });
  document.addEventListener("input", capture);
  addEventListener("resize", capture);
  visualViewport?.addEventListener("resize", capture);
  setInterval(capture, 100);
  setInterval(() => {
    if (!pending.length) return;
    const values = pending.splice(0);
    fetch("/__ios/audit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }).catch(() => pending.unshift(...values));
  }, 200);
})();
