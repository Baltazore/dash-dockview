// Drives the harness in a real browser.
// Usage: node drive.mjs <scenario> [--out <dir>] [--url <url>] [--measure] [--headed]
// Playwright comes from `npx -y playwright@1.56.1`; run `npx -y playwright@1.56.1 install chromium` once.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PLAYWRIGHT_VERSION = "1.56.1";
const PANEL_IDS = ["p1", "p2", "p3", "p4"];
const SCENARIOS = [
  "boot",
  "switch-tab",
  "close-tab",
  "set-layout",
  "remove-panel",
  "theme",
  "icons",
  "dotted",
  "group",
  "badge-menu",
  "badge-drag",
  "active-close",
  "badge-update",
  "narrow",
  "dump",
];

function parseArgs(argv) {
  const args = { scenario: undefined, out: "shots", url: "http://127.0.0.1:8060", measure: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out") args.out = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--measure") args.measure = true;
    else if (arg === "--headed") args.headed = true;
    else if (!args.scenario) args.scenario = arg;
  }
  return args;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Not installed next to this script, so look in the npx cache that `npx -y playwright@x` fills.
    const npxRoot = join(process.env.npm_config_cache ?? join(homedir(), ".npm"), "_npx");
    const hits = existsSync(npxRoot)
      ? readdirSync(npxRoot).map((dir) => join(npxRoot, dir, "node_modules", "playwright"))
          .filter((dir) => existsSync(join(dir, "package.json")))
      : [];
    for (const dir of hits) {
      const { version } = JSON.parse((await import("node:fs")).readFileSync(join(dir, "package.json"), "utf8"));
      if (version === PLAYWRIGHT_VERSION) return import(pathToFileURL(join(dir, "index.mjs")).href);
    }
    throw new Error(`playwright@${PLAYWRIGHT_VERSION} not found. Run: npx -y playwright@${PLAYWRIGHT_VERSION} install chromium`);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const readEvents = (page) => page.evaluate(() => window.__harnessEvents ?? []);

const short = (value) => {
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

function printEvents(title, events) {
  console.log(`${title} (${events.length})`);
  events.forEach((event) => console.log(`  ${event.prop} ${short(event.value)} at=${event.at}`));
}

async function open(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => performance.getEntriesByName("panels-adopted").length > 0, null, { timeout: 15000 });
  await page.waitForSelector(".dv-tab");
}

const tabTitles = (page) =>
  page.$$eval(".dv-tab", (tabs) => tabs.map((tab) => (tab.querySelector(".ddv-tab-title") ?? tab).textContent.trim()));


async function shot(page, out, name) {
  mkdirSync(out, { recursive: true });
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`screenshot ${file}`);
}

const lastOf = (events, prop) => [...events].reverse().find((event) => event.prop === prop);

const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
};

const tabOf = (page, panelId) => page.locator(`.dv-tab[data-tab-panel-id="${panelId}"]`);

const badgeOf = (page, panelId) => tabOf(page, panelId).locator(".ddv-badge");

const menuCount = (page) => page.locator(".ddv-menu").count();

const eventsSince = async (page, count) => (await readEvents(page)).slice(count);

async function applyTwoGroupLayout(page) {
  await page.click("#set-layout");
  await page.waitForFunction(() => document.querySelectorAll(".dv-groupview").length === 2, null, { timeout: 5000 });
  await sleep(500);
}

// Reads the pixels of a screenshot region. A canvas in the page decodes the PNG, so the driver needs no image library.
async function readPixels(page, clip) {
  const base64 = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data: bytes } = context.getImageData(0, 0, image.width, image.height);
    const pixels = [];
    for (let i = 0; i < bytes.length; i += 4) pixels.push([bytes[i], bytes[i + 1], bytes[i + 2]]);
    return { width: image.width, pixels };
  }, base64);
}

const near = (pixel, target, tolerance) => pixel.every((channel, index) => Math.abs(channel - target[index]) <= tolerance);

const inspectMenu = (page) =>
  page.evaluate(() => {
    const menu = document.querySelector(".ddv-menu");
    if (!menu) return null;
    const box = menu.getBoundingClientRect();
    const style = getComputedStyle(menu);
    const items = [...menu.querySelectorAll(".ddv-menu-item")].map((item) => {
      const itemStyle = getComputedStyle(item);
      const glyph = item.querySelector(".ddv-menu-glyph");
      return {
        text: item.textContent.trim(),
        height: item.getBoundingClientRect().height,
        fontSize: itemStyle.fontSize,
        color: itemStyle.color,
        paddingLeft: itemStyle.paddingLeft,
        glyph: glyph ? { width: glyph.getBoundingClientRect().width, group: glyph.classList.contains("ddv-menu-glyph--group") } : null,
      };
    });
    return {
      left: box.left,
      top: box.top,
      radius: style.borderTopLeftRadius,
      border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
      shadow: style.boxShadow,
      background: style.backgroundColor,
      items,
    };
  });

const tabEvents = (events) => events.filter((event) => ["lastTabMenuAction", "lastPanelAdded", "activePanel"].includes(event.prop));

const scenarios = {
  async boot(page, { out, measure }) {
    const titles = await tabTitles(page);
    console.log("tabs", JSON.stringify(titles));
    const adopted = await page.$$eval("[id^='__dv_content_dv_']", (nodes) =>
      nodes.map((node) => ({ id: node.id, inDockview: !!node.closest(".dv-dockview"), display: node.style.display })),
    );
    console.log("content", JSON.stringify(adopted));
    check("four tabs", titles.length === 4);
    check("all content adopted", adopted.length === 4 && adopted.every((node) => node.inDockview));
    const parts = await page.evaluate(() => ({
      badges: document.querySelectorAll(".ddv-badge").length,
      icons: document.querySelectorAll(".ddv-tab-icon").length,
      closeButtons: document.querySelectorAll(".ddv-tab-close").length,
    }));
    console.log("tab parts", JSON.stringify(parts));
    await sleep(600);
    const events = await readEvents(page);
    printEvents("harness-events", events.map((event) => ({ ...event, value: event.value })));
    // The wrapper reports this layout itself, so it shows what the wrapper sends to Dash.
    check("the layout that the wrapper reports has no tab params", !JSON.stringify(lastOf(events, "layout")?.value).includes('"params"'));
    if (measure) {
      const ms = await page.evaluate(() => performance.getEntriesByName("panels-adopted")[0].startTime);
      console.log(`panels-adopted ${ms.toFixed(1)} ms`);
    }
    await shot(page, out, "boot");
  },

  async "switch-tab"(page, { out }) {
    await sleep(400);
    for (const panelId of PANEL_IDS) {
      await tabOf(page, panelId).locator(".ddv-tab-title").click();
      await sleep(150);
      const active = lastOf(await readEvents(page), "activePanel");
      console.log(`click ${panelId} -> activePanel ${short(active?.value)}`);
      check(`activePanel is ${panelId}`, active?.value?.panelId === panelId);
    }
    await shot(page, out, "switch");
  },

  async "close-tab"(page, { out }) {
    await sleep(600);
    const before = (await readEvents(page)).length;
    const tab = tabOf(page, "p2");
    await tab.hover();
    await tab.locator(".ddv-tab-close").click();
    await sleep(800);
    const events = (await readEvents(page)).slice(before);
    printEvents("events after close", events);
    check("lastPanelRemoved is p2", lastOf(events, "lastPanelRemoved")?.value?.panelId === "p2");
    const open = lastOf(events, "openPanels")?.value;
    check("openPanels dropped p2", Array.isArray(open) && !open.includes("p2") && open.length === 3);
    await shot(page, out, "close");
  },

  async "set-layout"(page, { out }) {
    await sleep(600);
    await page.click("#set-layout");
    await sleep(1500);
    const events = await readEvents(page);
    const marker = events.findIndex((event) => event.prop === "set-layout-clicked");
    const after = events.slice(marker);
    printEvents("events after set-layout", after.map((event) => (event.prop === "layout" ? { ...event, value: "<layout>" } : event)));
    const groups = await page.$$eval(".dv-groupview", (nodes) => nodes.length);
    console.log(`groups ${groups}`);
    check("two groups show", groups === 2);
    // The first layout entry is Dash reporting the value Python set. Any later one is an echo.
    const layoutEntries = after.filter((event) => event.prop === "layout");
    check("no layout echo after the Python-set value", layoutEntries.length === 1);
    await shot(page, out, "layout");
  },

  async "remove-panel"(page, { out }) {
    await sleep(600);
    const before = (await readEvents(page)).length;
    await page.click("#remove-panel");
    await sleep(900);
    const events = (await readEvents(page)).slice(before);
    printEvents("events after remove-panel", events);
    const titles = await tabTitles(page);
    console.log("tabs", JSON.stringify(titles));
    const detached = await page.evaluate(() => {
      const node = document.getElementById("__dv_content_dv_p2");
      return !node || !node.closest(".dv-dockview");
    });
    check("lastPanelRemoved is p2", lastOf(events, "lastPanelRemoved")?.value?.panelId === "p2");
    check("tab is gone", (await tabOf(page, "p2").count()) === 0);
    check("content div is detached from the group", detached);
    await shot(page, out, "remove-panel");
  },

  async theme(page, { out }) {
    await sleep(400);
    await page.click("#apply-theme");
    await sleep(600);
    const result = await page.evaluate(() => {
      const root = document.querySelector("#dv .dv-dockview");
      const style = getComputedStyle(root);
      return {
        themeClass: [...root.classList].join(" "),
        vars: Object.fromEntries(
          ["--dv-separator-border", "--dv-sash-color", "--dv-active-sash-color"].map((name) => [name, style.getPropertyValue(name).trim()]),
        ),
        styleTag: [...document.querySelectorAll("#react-entry-point style")].map((node) => node.textContent).find((text) => text.includes("#dv .dv-dockview")),
      };
    });
    console.log(JSON.stringify(result, null, 2));
    check("bare key became --dv-separator-border", result.vars["--dv-separator-border"] === "#ff0000");
    check("dv- key became --dv-sash-color", result.vars["--dv-sash-color"] === "#00aa00");
    check("--dv- key kept", result.vars["--dv-active-sash-color"] === "#0000ff");
    await shot(page, out, "theme");
  },

  async icons(page, { out }) {
    await sleep(600);
    const rows = await page.$$eval(".dv-tab", (tabs) =>
      tabs.map((tab) => {
        const rect = (selector) => tab.querySelector(selector)?.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        const badge = rect(".ddv-badge");
        const icon = rect(".ddv-tab-icon");
        const title = rect(".ddv-tab-title");
        const close = rect(".ddv-tab-close");
        const image = tab.querySelector(".ddv-tab-icon");
        return {
          panel: tab.dataset.tabPanelId,
          src: image?.getAttribute("src"),
          loaded: !!image && image.complete && image.naturalWidth > 0,
          iconSize: icon ? [icon.width, icon.height] : null,
          iconBeforeTitle: !!icon && icon.right <= title.left,
          padLeft: (badge ?? icon ?? title).left - tabRect.left,
          padRight: tabRect.right - (close ?? title).right,
          gapBadgeIcon: badge && icon ? icon.left - badge.right : null,
          gapIconTitle: icon ? title.left - icon.right : null,
        };
      }),
    );
    rows.forEach((row) => console.log(JSON.stringify(row)));
    const is = (value, expected) => Math.abs(value - expected) < 0.5;
    check("every tab shows an icon image", rows.length === 4 && rows.every((row) => row.src));
    check("every icon image is loaded", rows.every((row) => row.loaded));
    check("every icon is 16 x 16", rows.every((row) => row.iconSize && is(row.iconSize[0], 16) && is(row.iconSize[1], 16)));
    check("every icon comes before its title", rows.every((row) => row.iconBeforeTitle));
    check("side padding is 16 px", rows.every((row) => is(row.padLeft, 16) && is(row.padRight, 16)));
    check("gaps are 8 px", rows.every((row) => is(row.gapBadgeIcon ?? 8, 8) && is(row.gapIconTitle, 8)));
    await shot(page, out, "icons");
  },

  async dotted(page, { out }) {
    await sleep(600);
    for (const panelId of ["p1", "p2"]) {
      const badge = badgeOf(page, panelId);
      const style = await badge.evaluate((node) => {
        const computed = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        const rule = [...document.styleSheets]
          .flatMap((sheet) => [...sheet.cssRules])
          .find((candidate) => candidate.selectorText === ".ddv-badge--ungrouped");
        return {
          size: [box.width, box.height],
          authored: rule?.style.border,
          borderStyle: computed.borderTopStyle,
          borderColor: computed.borderTopColor,
          radius: computed.borderTopLeftRadius,
          background: computed.backgroundColor,
        };
      });
      console.log(panelId, JSON.stringify(style));
      check(`${panelId} badge is an 18 px square with a 3 px radius`, style.size[0] === 18 && style.size[1] === 18 && style.radius === "3px");
      check(`${panelId} border is dashed 1.5 px #8A8A8A, fill transparent`, style.borderStyle === "dashed" && style.borderColor === "rgb(138, 138, 138)" && style.authored.startsWith("1.5px dashed") && style.background === "rgba(0, 0, 0, 0)");
      const { pixels } = await readPixels(page, await badge.boundingBox());
      const hits = pixels.filter((pixel) => near(pixel, [138, 138, 138], 8)).length;
      console.log(`${panelId} border pixels within 8 of #8A8A8A: ${hits}`);
      check(`${panelId} badge border pixels match #8A8A8A`, hits > 0);
    }
    await shot(page, out, "dotted");
  },

  async group(page, { out }) {
    await sleep(600);
    for (const panelId of ["p3", "p4"]) {
      const badge = badgeOf(page, panelId);
      const style = await badge.evaluate((node) => {
        const computed = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        return {
          text: node.textContent,
          size: [box.width, box.height],
          background: computed.backgroundColor,
          color: computed.color,
          fontSize: computed.fontSize,
          fontWeight: computed.fontWeight,
          radius: computed.borderTopLeftRadius,
          centerOffset: [text.left + text.width / 2 - (box.left + box.width / 2), text.top + text.height / 2 - (box.top + box.height / 2)],
        };
      });
      console.log(panelId, JSON.stringify(style));
      check(`${panelId} badge is a filled 18 px square labelled 1`, style.text === "1" && style.size[0] === 18 && style.size[1] === 18 && style.background === "rgb(27, 94, 219)" && style.radius === "3px");
      check(`${panelId} label is white, 12 px, weight 600, centred`, style.color === "rgb(255, 255, 255)" && style.fontSize === "12px" && style.fontWeight === "600" && style.centerOffset.every((offset) => Math.abs(offset) <= 1.5));
      const { width, pixels } = await readPixels(page, await badge.boundingBox());
      const fill = pixels[4 * width + 4];
      // The corners show the tab behind the badge, so only the inner 10 x 10 pixels count as label.
      const white = pixels.filter((pixel, index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        return x >= 4 && x < 14 && y >= 4 && y < 14 && near(pixel, [255, 255, 255], 8);
      }).length;
      console.log(`${panelId} fill pixel ${JSON.stringify(fill)}, white pixels ${white}`);
      check(`${panelId} badge pixels are #1B5EDB with white label pixels`, near(fill, [27, 94, 219], 8) && white > 0);
    }
    await shot(page, out, "group");
  },

  async "badge-menu"(page, { out }) {
    await sleep(600);
    const start = (await readEvents(page)).length;
    const badge = badgeOf(page, "p2");
    await badge.click();
    await page.waitForSelector(".ddv-menu");
    const box = await badge.boundingBox();
    const menu = await inspectMenu(page);
    console.log("menu", JSON.stringify(menu));
    check("menu lists the three items", JSON.stringify(menu.items.map((item) => item.text)) === JSON.stringify(["Create group", "Join group 1", "Leave group"]));
    check("menu sits under the badge", Math.abs(menu.top - (box.y + box.height + 4)) <= 1 && Math.abs(menu.left - box.x) <= 1);
    check("menu is a white 8 px panel with a 1 px #D6D6D6 border and the shadow", menu.background === "rgb(255, 255, 255)" && menu.radius === "8px" && menu.border === "1px solid rgb(214, 214, 214)" && menu.shadow.includes("rgba(0, 0, 0, 0.12) 0px 4px 12px"));
    check("items are 36 px high, 14 px #1F1F1F text, 12 px side padding", menu.items.every((item) => item.height === 36 && item.fontSize === "14px" && item.color === "rgb(31, 31, 31)" && item.paddingLeft === "12px"));
    check("plus and group glyphs are 18 px and the third item has none", menu.items[0].glyph?.width === 18 && !menu.items[0].glyph.group && menu.items[1].glyph?.width === 18 && menu.items[1].glyph.group && menu.items[2].glyph === null);
    await shot(page, out, "menu-open");

    await page.mouse.click(700, 760);
    await sleep(250);
    check("a click outside closes the menu", (await menuCount(page)) === 0);
    await shot(page, out, "menu-closed");

    await badge.click();
    await page.waitForSelector(".ddv-menu");
    await page.keyboard.press("Escape");
    await sleep(250);
    check("Escape closes the menu", (await menuCount(page)) === 0);

    await badge.click();
    await page.waitForSelector(".ddv-menu");
    await badge.click();
    await sleep(250);
    check("a second click on the badge closes the menu", (await menuCount(page)) === 0);

    const beforeAction = (await readEvents(page)).length;
    await badge.click();
    await page.waitForSelector(".ddv-menu");
    await page.locator(".ddv-menu-item").nth(1).click();
    await sleep(500);
    const events = await eventsSince(page, start);
    printEvents("events since the first click", tabEvents(events));
    const actions = events.filter((event) => event.prop === "lastTabMenuAction");
    check("only the item click sent lastTabMenuAction, once", actions.length === 1);
    const action = actions[0]?.value;
    check("lastTabMenuAction names panel p2 and item join:1:group", action?.panelId === "p2" && action?.itemId === "join:1:group" && typeof action?.at === "number");
    check("the menu is closed after the choice", (await menuCount(page)) === 0);
    check("opening the menu did not switch the active panel", !events.some((event) => event.prop === "activePanel"));
    check("events were recorded after the reopen", (await readEvents(page)).length > beforeAction);
    await shot(page, out, "menu-action");
  },

  async "badge-drag"(page, { out }) {
    await sleep(800);
    const groupCount = () => page.$$eval(".dv-groupview", (nodes) => nodes.length);
    const dragTo = async (from, target) => {
      const source = await from.boundingBox();
      const destination = await target.boundingBox();
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(destination.x + destination.width * 0.75, destination.y + destination.height / 2, { steps: 15 });
      await page.mouse.up();
      await sleep(700);
    };
    check("four groups at the start", (await groupCount()) === 4);
    await dragTo(badgeOf(page, "p2"), tabOf(page, "p1"));
    check("a drag that starts on the badge does not move the tab", (await groupCount()) === 4);
    await dragTo(tabOf(page, "p2").locator(".ddv-tab-title"), tabOf(page, "p1"));
    const after = await groupCount();
    console.log(`groups after a drag that starts on the title: ${after}`);
    check("control: a drag that starts on the title does move the tab", after === 3);
    await shot(page, out, "badge-drag");
  },

  async "active-close"(page, { out }) {
    await sleep(600);
    await applyTwoGroupLayout(page);
    const readTabs = () =>
      page.$$eval(".dv-tab", (tabs) =>
        tabs.map((tab) => ({
          panel: tab.dataset.tabPanelId,
          groupActive: tab.classList.contains("dv-active-tab"),
          closeButtons: tab.querySelectorAll(".ddv-tab-close").length,
        })),
      );
    const kinds = await page.$$eval(".dv-tab", (nodes) =>
      Object.fromEntries(nodes.map((tab) => [tab.dataset.tabPanelId, `${tab.querySelector(".ddv-badge")?.className.replace("ddv-badge ddv-badge--", "") ?? "none"}${tab.querySelector(".ddv-tab-icon") ? "+icon" : ""}`])),
    );
    console.log("tabs after the restore", JSON.stringify(kinds));
    check("a layout restore keeps the icons and badges", JSON.stringify(kinds) === JSON.stringify({ p1: "ungrouped+icon", p2: "ungrouped+icon", p3: "group+icon", p4: "group+icon" }));
    let tabs = await readTabs();
    console.log("tabs after set-layout", JSON.stringify(tabs));
    check("the close button shows on the active tab of each group and on no other tab", tabs.length === 4 && tabs.every((tab) => tab.closeButtons === (tab.groupActive ? 1 : 0)) && tabs.filter((tab) => tab.closeButtons).length === 2);

    const active = tabOf(page, "p1");
    await active.hover();
    const closeBox = await active.locator(".ddv-tab-close").boundingBox();
    check("the close button has a 20 px hit area", closeBox.width === 20 && closeBox.height === 20);
    const hover = await page.evaluate(() => {
      const button = document.querySelector('.dv-tab[data-tab-panel-id="p1"] .ddv-tab-close');
      const root = document.querySelector("#dv .dv-dockview");
      const probe = document.createElement("div");
      probe.style.backgroundColor = getComputedStyle(root).getPropertyValue("--dv-icon-hover-background-color");
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { expected, radius: getComputedStyle(button).borderTopLeftRadius, svg: button.querySelector("svg").getBoundingClientRect().width };
    });
    console.log("close button style", JSON.stringify(hover));
    await page.locator('.dv-tab[data-tab-panel-id="p1"] .ddv-tab-close').hover();
    const hoverBackground = await page.$eval('.dv-tab[data-tab-panel-id="p1"] .ddv-tab-close', (node) => getComputedStyle(node).backgroundColor);
    check("the close button keeps dockview's hover background, radius 4 px, cross 12 px", hoverBackground === hover.expected && hover.radius === "4px" && hover.svg === 12);
    await shot(page, out, "close-active");

    await tabOf(page, "p2").hover();
    tabs = await readTabs();
    check("hovering an inactive tab shows no close button", tabs.find((tab) => tab.panel === "p2").closeButtons === 0);
    await shot(page, out, "close-inactive");

    const beforeBadge = (await readEvents(page)).length;
    await badgeOf(page, "p2").click();
    await page.waitForSelector(".ddv-menu");
    await sleep(300);
    tabs = await readTabs();
    check(
      "a badge click on an inactive tab opens its menu and does not switch the tab",
      tabs.find((tab) => tab.panel === "p1").closeButtons === 1 &&
        tabs.find((tab) => tab.panel === "p2").closeButtons === 0 &&
        !(await eventsSince(page, beforeBadge)).some((event) => event.prop === "activePanel"),
    );
    await shot(page, out, "badge-inactive-tab");
    await page.keyboard.press("Escape");

    const start = (await readEvents(page)).length;
    await tabOf(page, "p2").click();
    await sleep(300);
    tabs = await readTabs();
    console.log("tabs after clicking p2", JSON.stringify(tabs));
    printEvents("events after clicking p2", tabEvents(await eventsSince(page, start)));
    check("the close button moves with the active tab", tabs.find((tab) => tab.panel === "p2").closeButtons === 1 && tabs.find((tab) => tab.panel === "p1").closeButtons === 0);
    await shot(page, out, "close-switched");
  },

  async "badge-update"(page, { out, measure }) {
    await sleep(800);
    const start = (await readEvents(page)).length;
    await page.evaluate(() => {
      const tab = document.querySelector('.dv-tab[data-tab-panel-id="p1"]');
      ["", ".ddv-tab-icon", ".ddv-tab-title", ".ddv-badge"].forEach((selector) => {
        (selector ? tab.querySelector(selector) : tab).dataset.probe = "kept";
      });
    });
    const label = () => badgeOf(page, "p1").textContent();
    check("the first badge starts as the dotted square", (await badgeOf(page, "p1").getAttribute("class")).includes("ddv-badge--ungrouped"));
    await page.click("#flip-badge");
    await page.waitForFunction(() => performance.getEntriesByName("badge-updated").length > 0, null, { timeout: 5000 });
    const marks = await page.evaluate(() => ({
      clicked: performance.getEntriesByName("flip-badge-clicked")[0].startTime,
      updated: performance.getEntriesByName("badge-updated")[0].startTime,
    }));
    await sleep(600);
    const events = await eventsSince(page, start);
    printEvents("events after flip-badge", tabEvents(events));
    check("the first badge now shows a filled 2", (await label()) === "2" && (await badgeOf(page, "p1").getAttribute("class")).includes("ddv-badge--group"));
    check("lastPanelAdded did not fire", !events.some((event) => event.prop === "lastPanelAdded"));
    const kept = await page.evaluate(() => {
      const tab = document.querySelector('.dv-tab[data-tab-panel-id="p1"]');
      return ["", ".ddv-tab-icon", ".ddv-tab-title", ".ddv-badge"].map((selector) => (selector ? tab.querySelector(selector) : tab).dataset.probe);
    });
    console.log("probe on tab, icon, title, badge after the update", JSON.stringify(kept));
    check("the tab repainted in place, its nodes were not re-created", kept.every((value) => value === "kept"));
    const delta = marks.updated - marks.clicked;
    if (measure) console.log(`badge-updated ${delta.toFixed(1)} ms after flip-badge-clicked (click at ${marks.clicked.toFixed(1)}, badge at ${marks.updated.toFixed(1)})`);
    await shot(page, out, "badge-update");

    // A real click would count as an outside click and close the menu, so a synthetic one sends the update.
    await badgeOf(page, "p3").click();
    await page.waitForSelector(".ddv-menu");
    await page.evaluate(() => {
      document.querySelector(".ddv-menu").dataset.probe = "kept";
      document.getElementById("flip-badge").click();
    });
    await sleep(600);
    check("a panels update keeps an open menu and its node", (await page.locator('.ddv-menu[data-probe="kept"]').count()) === 1);
    await shot(page, out, "badge-update-menu");
  },

  async narrow(page, { out }) {
    await page.setViewportSize({ width: 560, height: 900 });
    await sleep(500);
    await applyTwoGroupLayout(page);
    const bars = await page.$$eval(".dv-tabs-and-actions-container", (nodes) =>
      nodes.map((bar) => {
        const barBox = bar.getBoundingClientRect();
        const overflow = bar.querySelector(".dv-tabs-overflow-dropdown-root");
        const tabs = [...bar.querySelectorAll(".dv-tab")].map((tab) => tab.dataset.tabPanelId);
        return {
          tabs,
          overflowControl: !!overflow && overflow.getBoundingClientRect().width > 0,
          barWidth: barBox.width,
        };
      }),
    );
    bars.forEach((bar) => console.log(JSON.stringify(bar)));
    check("two bars", bars.length === 2);
    check("a bar that cannot fit its tabs shows the overflow control", bars.some((bar) => bar.overflowControl));
    await shot(page, out, "narrow");
    const control = page.locator(".dv-tabs-overflow-dropdown-root").first();
    if (await control.count()) {
      await control.click();
      await sleep(400);
      await shot(page, out, "narrow-overflow");
    }
  },

  async dump(page) {
    await sleep(600);
    const bars = await page.$$eval(".dv-tabs-and-actions-container", (nodes) => nodes.map((node) => node.outerHTML));
    bars.forEach((html, index) => console.log(`tab bar ${index}: ${html}`));
    const events = await readEvents(page);
    printEvents("last setProps payloads", events.slice(-8).map((event) => ({ ...event, value: event.value })));
  },
};

const args = parseArgs(process.argv.slice(2));
if (!SCENARIOS.includes(args.scenario)) {
  console.error(`usage: node drive.mjs <${SCENARIOS.join("|")}> [--out <dir>] [--url <url>] [--measure] [--headed]`);
  process.exit(2);
}

const { chromium } = await loadPlaywright();
// PW_CHROMIUM_PATH points at an already installed Chromium when the pinned build is not downloaded.
const browser = await chromium.launch({ headless: !args.headed, executablePath: process.env.PW_CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (error) => console.log(`pageerror ${error.message}`));
  await open(page, args.url);
  await scenarios[args.scenario](page, { out: resolve(args.out), measure: args.measure });
} finally {
  await browser.close();
}
