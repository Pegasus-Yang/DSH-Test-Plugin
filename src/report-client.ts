/** 静态报告的本地交互；只读取页面已包含的事实，不联网、不写运行数据。 */
export function reportInteractions(): void {
  const data = JSON.parse(
    document.getElementById("report-data")!.textContent!,
  ) as {
    downloads: Record<string, { mime: string; base64: string }>;
    calls: Record<string, string>;
  };
  const bytes = (id: string) =>
    Uint8Array.from(atob(data.downloads[id]!.base64), (char) =>
      char.charCodeAt(0),
    );
  const urls = new Map<string, string>();
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "[data-report-download]",
  ))
    link.onclick = () => {
      const id = link.dataset.reportDownload!;
      if (!urls.has(id))
        urls.set(
          id,
          URL.createObjectURL(
            new Blob([bytes(id)], { type: data.downloads[id]!.mime }),
          ),
        );
      link.href = urls.get(id)!;
    };
  window.addEventListener("pagehide", () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  });
  const assets = new Map(
    [...document.querySelectorAll<HTMLImageElement>("[data-report-asset]")].map(
      (img) => [img.dataset.reportAsset!, img.src],
    ),
  );
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "[data-report-image-download]",
  ))
    link.href = assets.get(link.dataset.reportImageDownload!) ?? "#";
  for (const detail of document.querySelectorAll<HTMLDetailsElement>(
    "[data-report-call], [data-report-text]",
  ))
    detail.ontoggle = () => {
      const pre = detail.querySelector("pre")!;
      if (!detail.open) {
        pre.textContent = "";
        return;
      }
      pre.textContent = detail.dataset.reportCall
        ? (data.calls[detail.dataset.reportCall] ?? "调用依据缺失")
        : new TextDecoder().decode(bytes(detail.dataset.reportText!));
    };
  const cases = [...document.querySelectorAll<HTMLElement>("article.case")];
  const rows = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-select-case]"),
  ];
  const filters = ["case", "data", "status"].map(
    (id) => document.getElementById(id) as HTMLSelectElement,
  );
  const search = document.getElementById("search") as HTMLInputElement;
  let selected = cases[0]?.id;
  let tab = cases[0]?.querySelector('[data-tab="actual"]') ? "actual" : "steps";
  const navigate = (view: string) => {
    for (const page of document.querySelectorAll<HTMLElement>("[data-view]"))
      page.hidden = page.dataset.view !== view;
    for (const button of document.querySelectorAll<HTMLElement>("[data-nav]")) {
      button.classList.toggle("active", button.dataset.nav === view);
      button.setAttribute(
        "aria-current",
        button.dataset.nav === view ? "page" : "false",
      );
    }
  };
  const showTab = (value: string) => {
    const active = cases.find((item) => item.id === selected);
    if (
      active &&
      ![...active.querySelectorAll<HTMLElement>("[data-tab]")].some(
        (button) => button.dataset.tab === value,
      )
    )
      value = active.querySelector('[data-tab="actual"]') ? "actual" : "steps";
    tab = value;
    for (const video of document.querySelectorAll<HTMLVideoElement>("video"))
      video.pause();
    for (const button of document.querySelectorAll<HTMLElement>("[data-tab]"))
      button.setAttribute(
        "aria-selected",
        String(button.dataset.tab === value),
      );
    for (const panel of document.querySelectorAll<HTMLElement>("[data-panel]"))
      panel.hidden = panel.dataset.panel !== value;
  };
  const select = (id: string) => {
    selected = id;
    for (const item of cases) item.hidden = item.id !== id;
    for (const row of rows)
      row.setAttribute("aria-current", String(row.dataset.selectCase === id));
    showTab(tab);
  };
  const update = () => {
    const text = search.value.trim().toLocaleLowerCase();
    const visible = cases.filter((item) => {
      const show =
        filters.every((f) => !f.value || item.dataset[f.id] === f.value) &&
        (!text || (item.dataset.search ?? "").includes(text));
      rows.find((row) => row.dataset.selectCase === item.id)!.hidden = !show;
      return show;
    });
    document.getElementById("count")!.textContent =
      `${visible.length} / ${cases.length} 个用例实例`;
    document.getElementById("empty")!.hidden = visible.length > 0;
    document.getElementById("no-detail")!.hidden = visible.length > 0;
    select(
      visible.find((item) => item.id === selected)?.id ?? visible[0]?.id ?? "",
    );
  };
  for (const button of document.querySelectorAll<HTMLElement>("[data-nav]"))
    button.onclick = () => navigate(button.dataset.nav!);
  for (const row of rows) row.onclick = () => select(row.dataset.selectCase!);
  for (const button of document.querySelectorAll<HTMLElement>(
    "[data-open-case]",
  ))
    button.onclick = () => {
      filters.forEach((f) => {
        f.value = "";
      });
      search.value = "";
      update();
      navigate("cases");
      select(button.dataset.openCase!);
    };
  for (const button of document.querySelectorAll<HTMLElement>("[data-tab]"))
    button.onclick = () => showTab(button.dataset.tab!);
  for (const button of document.querySelectorAll<HTMLElement>(
    "[data-filter-status]",
  ))
    button.onclick = () => {
      filters.forEach((f) => {
        f.value = "";
      });
      search.value = "";
      filters[2]!.value = button.dataset.filterStatus!;
      navigate("cases");
      update();
    };
  for (const button of document.querySelectorAll<HTMLElement>(
    "[data-evidence]",
  ))
    button.onclick = () => {
      showTab("attachments");
      document
        .getElementById(button.dataset.evidence!)
        ?.scrollIntoView({ block: "nearest" });
    };
  filters.forEach((f) => f.addEventListener("change", update));
  search.addEventListener("input", update);
  document.getElementById("clear")!.onclick = () => {
    filters.forEach((f) => {
      f.value = "";
    });
    search.value = "";
    update();
  };
  // 选项卡遵循键盘左右键导航；每个用例的焦点只在当前面板中移动。
  for (const list of document.querySelectorAll<HTMLElement>("[role=tablist]"))
    list.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      const buttons = [
        ...list.querySelectorAll<HTMLButtonElement>("[data-tab]"),
      ];
      const current = buttons.findIndex((b) => b.dataset.tab === tab);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (current +
                (event.key === "ArrowRight" ? 1 : -1) +
                buttons.length) %
              buttons.length;
      event.preventDefault();
      buttons[next]!.click();
      buttons[next]!.focus();
    };
  const dialog = document.getElementById("image-dialog") as HTMLDialogElement;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-preview]",
  ))
    button.onclick = () => {
      (document.getElementById("full-image") as HTMLImageElement).src =
        button.querySelector("img")!.src;
      dialog.showModal();
    };
  const closeImage = document.getElementById("close-image");
  if (closeImage) closeImage.onclick = () => dialog.close();
  update();
  navigate("cases");
}
