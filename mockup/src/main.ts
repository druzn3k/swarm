// Phone-first pixel UI mock-up, running the real @swarmsim/engine.
import Decimal from "decimal.js";
import { createGame, numberSuffixesShort } from "../../engine/src";
import type { Unit, Upgrade, Tab } from "../../engine/src";
import { HiveScene, Population } from "./scene";
import { spriteDataUrl, spriteFor } from "./sprites";

// --- storage that never throws (private windows, previews) ----------------
const storage = {
  getItem(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* not saved; the game still runs */
    }
  },
  removeItem(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

const engine = createGame({ storage, saveId: "pixel-mockup-v1" });
const { game, commands, events } = engine;

// --- number formatting ----------------------------------------------------
function fmt(d: Decimal, decimals = 0): string {
  if (d.isNaN()) return "?";
  if (d.lessThan(1e6)) {
    const n = d.toNumber();
    return decimals && n < 100 && n % 1 !== 0
      ? n.toFixed(decimals)
      : Math.floor(n).toLocaleString("en-US");
  }
  const exp = d.toExponential(2); // "1.23e+45"
  const e = parseInt(exp.split("e")[1], 10);
  const group = Math.floor(e / 3);
  const suffix = numberSuffixesShort[group];
  if (!suffix) return d.toExponential(2).replace("e+", "e");
  const mant = d.dividedBy(Decimal.pow(10, group * 3));
  return mant.toPrecision(3).replace(/\.?0+$/, (m) => (m.includes(".") ? "" : m)) + suffix;
}
const log10 = (d: Decimal): number => (d.greaterThan(0) ? (d as any).log(10).toNumber() : -1);

// --- dom helpers ------------------------------------------------------------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
function icon(name: string, tab?: string, cls = "px-icon"): HTMLImageElement {
  const img = el("img", cls);
  img.src = spriteDataUrl(spriteFor(name, tab));
  img.alt = "";
  return img;
}

$<HTMLImageElement>("#res-meat-icon").src = spriteDataUrl(spriteFor("meat"));
$<HTMLImageElement>("#res-larva-icon").src = spriteDataUrl(spriteFor("larva"));

// --- scene --------------------------------------------------------------------
const scene = new HiveScene($<HTMLCanvasElement>("#hive"));
const BEYOND = ["overmind6", "overmind5", "overmind4", "overmind3", "overmind2", "overmind", "pantheon5", "pantheon4", "pantheon3", "pantheon2", "pantheon", "goddess", "prophet", "empress", "hivequeen"];
function population(): Population {
  const c = (n: string) => log10(game.unit(n).count());
  return {
    meat: c("meat"),
    larva: c("larva"),
    drone: c("drone"),
    queen: c("queen"),
    nest: c("nest"),
    greaterqueen: c("greaterqueen"),
    hive: c("hive"),
    beyond: BEYOND.find((n) => game.unit(n).count().greaterThan(0)) ?? null,
  };
}

// --- tabs ---------------------------------------------------------------------
const TAB_ORDER = ["meat", "larva", "territory", "energy", "mutagen"];
let currentTab = "meat";
try {
  const saved = localStorage.getItem("pixel-mockup-tab");
  if (saved && TAB_ORDER.includes(saved)) currentTab = saved;
} catch {
  /* default tab */
}
const tabOf = (name: string): Tab => (game.tabs.byName as any)[name];

const nav = $("#nav");
const navItems = new Map<string, { btn: HTMLButtonElement; count: HTMLElement }>();
for (const name of TAB_ORDER) {
  const btn = el("button", "nav-btn");
  btn.type = "button";
  btn.id = `nav-${name}`;
  btn.append(icon(name, name, "nav-icon"));
  const label = el("span", "nav-label", tabOf(name).leadunit.unittype.plural);
  const count = el("span", "nav-count num");
  btn.append(label, count);
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    currentTab = name;
    try {
      localStorage.setItem("pixel-mockup-tab", name);
    } catch {
      /* not remembered */
    }
    renderList(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  nav.append(btn);
  navItems.set(name, { btn, count });
}

// --- unit list ------------------------------------------------------------------
interface CardRefs {
  unit: Unit;
  count: HTMLElement;
  rate: HTMLElement;
  buy1: HTMLButtonElement;
  buyQ: HTMLButtonElement;
  buyMax: HTMLButtonElement;
  upgrades: { up: Upgrade; btn: HTMLButtonElement; cost: HTMLElement; level: HTMLElement; bar: HTMLElement }[];
  details: HTMLElement;
}
let cards: CardRefs[] = [];
let listSignature = "";
const openCards = new Set<string>(["drone"]);

function costText(costs: { unit: Unit; val: Decimal }[]): string {
  return costs.map((c) => `${fmt(c.val)} ${c.val.equals(1) ? c.unit.unittype.label : c.unit.unittype.plural}`).join(" + ");
}

function visibleUnits(): Unit[] {
  return (tabOf(currentTab).sortUnits() as Unit[])
    .filter((u) => u.isVisible())
    .slice()
    .reverse();
}

function renderList(force = false): void {
  const units = visibleUnits();
  const sig = currentTab + ":" + units.map((u) => u.name + "/" + visibleUpgrades(u).map((x) => x.name).join(",")).join("|");
  if (!force && sig === listSignature) return;
  listSignature = sig;
  const list = $("#list");
  list.replaceChildren();
  cards = [];
  $("#tab-title").textContent = tabOf(currentTab).leadunit.unittype.plural;
  for (const unit of units) list.append(card(unit));
  for (const [name, item] of navItems) item.btn.setAttribute("aria-current", name === currentTab ? "page" : "false");
}

function visibleUpgrades(u: Unit): Upgrade[] {
  return ((u as any).upgrades?.byClass?.upgrade ?? []).filter((x: Upgrade) => x.isVisible());
}

function card(unit: Unit): HTMLElement {
  const t = unit.unittype as any;
  const li = el("li", "card");
  const head = el("button", "card-head");
  head.type = "button";
  head.setAttribute("aria-expanded", String(openCards.has(unit.name)));
  head.append(icon(unit.name, t.tab));
  const names = el("span", "card-names");
  names.append(el("span", "card-name", t.plural));
  const rate = el("span", "card-rate num");
  names.append(rate);
  const count = el("span", "card-count num");
  const more = el("span", "card-more");
  more.setAttribute("aria-hidden", "true");
  head.append(names, count, more);
  li.append(head);

  const buyable = !t.unbuyable && !t.isBuyHidden && unit.eachCost().length > 0 && unit.isBuyButtonVisible();
  const buyRow = el("div", "buy-row");
  const mkBuy = (label: string, cls: string) => {
    const b = el("button", "buy " + cls, label);
    b.type = "button";
    buyRow.append(b);
    return b;
  };
  const buy1 = mkBuy("+1", "buy-one");
  const buyQ = mkBuy("25%", "buy-quarter");
  const buyMax = mkBuy("Max", "buy-max");
  buy1.addEventListener("click", () => act(() => commands.buyUnit({ unit, num: 1, ui: "mockup" }), unit, buy1));
  buyQ.addEventListener("click", () => act(() => commands.buyMaxUnit({ unit, percent: 0.25, ui: "mockup" }), unit, buyQ));
  buyMax.addEventListener("click", () => act(() => commands.buyMaxUnit({ unit, percent: 1, ui: "mockup" }), unit, buyMax));
  if (buyable) li.append(buyRow);

  const details = el("div", "details");
  details.hidden = !openCards.has(unit.name);
  if (t.description) details.append(el("p", "desc", t.description));
  if (buyable) details.append(el("p", "cost-line", "Each costs " + costText(unit.eachCost())));
  const upgradeBox = el("div", "upgrades");
  const upgrades: CardRefs["upgrades"] = [];
  for (const up of visibleUpgrades(unit)) {
    const row = el("div", "upgrade");
    const top = el("div", "upgrade-top");
    const name = el("span", "upgrade-name", (up as any).type.label);
    const level = el("span", "upgrade-level num");
    top.append(name, level);
    const cost = el("span", "upgrade-cost num");
    const barWrap = el("span", "bar");
    const bar = el("span", "bar-fill");
    barWrap.append(bar);
    const btn = el("button", "buy buy-upgrade", "Upgrade");
    btn.type = "button";
    btn.addEventListener("click", () => act(() => commands.buyUpgrade({ upgrade: up, num: 1, ui: "mockup" }), unit, btn));
    row.append(top, cost, barWrap, btn);
    upgradeBox.append(row);
    upgrades.push({ up, btn, cost, level, bar });
  }
  li.append(details);
  if (upgrades.length) li.append(upgradeBox);
  head.addEventListener("click", () => {
    const open = details.hidden;
    details.hidden = !open;
    head.setAttribute("aria-expanded", String(open));
    open ? openCards.add(unit.name) : openCards.delete(unit.name);
  });

  cards.push({ unit, count, rate, buy1, buyQ, buyMax, upgrades, details });
  return li;
}

function act(fn: () => void, unit: Unit, from: HTMLElement): void {
  const before = unit.count();
  try {
    fn();
  } catch {
    return; // can't afford: buttons are disabled for this anyway
  }
  const gained = unit.count().minus(before);
  scene.burst(unit.name);
  if (gained.greaterThan(0)) floatText("+" + fmt(gained), from);
  else floatText("Upgraded", from);
  update();
}

function floatText(text: string, from: HTMLElement): void {
  const r = from.getBoundingClientRect();
  const f = el("span", "float num", text);
  f.style.left = `${r.left + r.width / 2}px`;
  f.style.top = `${r.top}px`;
  document.body.append(f);
  f.addEventListener("animationend", () => f.remove());
}

// --- per-tick updates -------------------------------------------------------------
function rateText(u: Unit): string {
  const v = u.velocity();
  if (v.isZero()) return "";
  return "+" + fmt(v, 1) + "/s";
}

function update(): void {
  renderList();
  for (const c of cards) {
    const u = c.unit;
    c.count.textContent = fmt(u.count());
    c.rate.textContent = rateText(u);
    const max = u.maxCostMet(1);
    const q = u.maxCostMet(0.25);
    c.buy1.disabled = max.lessThan(1);
    c.buyQ.disabled = q.lessThan(1);
    c.buyMax.disabled = max.lessThan(1);
    c.buyQ.textContent = q.greaterThanOrEqualTo(1) ? "+" + fmt(q) : "25%";
    c.buyMax.textContent = max.greaterThanOrEqualTo(1) ? "+" + fmt(max) : "Max";
    for (const x of c.upgrades) {
      x.level.textContent = "Lv " + fmt(x.up.count());
      x.cost.textContent = costText(x.up.totalCost());
      // costMetPercent is progress toward the first level you can't afford yet;
      // here a ready upgrade shows a full bar instead
      const ready = x.up.isCostMet();
      const pct = ready ? 1 : Math.min(1, x.up.costMetPercent().toNumber());
      x.bar.style.width = `${Math.floor(pct * 100)}%`;
      x.bar.classList.toggle("ready", ready);
      x.btn.disabled = !ready;
    }
  }
  for (const [name, item] of navItems) {
    const lead = tabOf(name).leadunit;
    const visible = lead.isVisible();
    item.btn.disabled = !visible;
    item.count.textContent = visible ? fmt(lead.count()) : "Locked";
    item.btn.classList.toggle("has-upgrade", visible && (tabOf(name).sortUnits() as Unit[]).some((u) => u.isVisible() && visibleUpgrades(u).some((x) => x.isCostMet())));
  }
  const meat = game.unit("meat");
  const larva = game.unit("larva");
  $("#res-meat").textContent = fmt(meat.count());
  $("#res-meat-rate").textContent = rateText(meat) || "+0/s";
  $("#res-larva").textContent = fmt(larva.count());
  $("#res-larva-rate").textContent = rateText(larva) || "+0/s";
  scene.setPopulation(population());
}

// --- achievements --------------------------------------------------------------------
events.on("achieve", (a: any) => {
  const t = $("#toast");
  $("#toast-title").textContent = a?.type?.label ?? "Achievement";
  $("#toast-points").textContent = a?.type?.points ? `+${a.type.points} points` : "";
  t.hidden = false;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  window.setTimeout(() => (t.hidden = true), 3600);
});

// --- demo speed and reset ------------------------------------------------------------------
const SPEEDS = [1, 10, 100];
let speedIdx = 0;
const speedBtn = $<HTMLButtonElement>("#speed");
speedBtn.addEventListener("click", () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  game.setGameSpeed(SPEEDS[speedIdx]);
  speedBtn.textContent = `Speed ×${SPEEDS[speedIdx]}`;
  speedBtn.setAttribute("aria-pressed", String(speedIdx > 0));
});

const resetBtn = $<HTMLButtonElement>("#reset");
const resetConfirm = $("#reset-confirm");
resetBtn.addEventListener("click", () => (resetConfirm.hidden = false));
$("#reset-no").addEventListener("click", () => (resetConfirm.hidden = true));
$("#reset-yes").addEventListener("click", () => {
  game.reset();
  engine.backfill.run(game);
  speedIdx = 0;
  game.setGameSpeed(1);
  speedBtn.textContent = "Speed ×1";
  resetConfirm.hidden = true;
  renderList(true);
  update();
});

// --- loops ------------------------------------------------------------------------------------
renderList(true);
update();
window.setInterval(() => {
  game.tick();
  update();
}, 100);
window.setInterval(() => {
  try {
    game.save();
  } catch {
    /* keep playing */
  }
}, 5000);
const loop = () => {
  scene.frame();
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
