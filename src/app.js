// Anvora: a token launchpad + bonding-curve exchange on GIWA Sepolia.
// Every on-chain action goes through @ammora-protocol/sdk: the Ammora V4 launch factory,
// the ALC bonding curve, graduation (migration) and post-graduation pool swaps.
import * as A from "@ammora-protocol/sdk";
import {
  createPublicClient, createWalletClient, custom, http, defineChain, formatUnits, parseUnits,
  erc20Abi, getAddress, isAddress, decodeEventLog, toEventSelector, encodeFunctionData, zeroAddress, toHex,
} from "viem";
import { SITE } from "./config.js";
import { initI18n } from "./i18n.js";

/* ───────────── deployment (SDK's reviewed GIWA Sepolia catalog) ───────────── */
const D = A.giwaSepoliaAutoRouteDeployment;
const L = D.contracts.launch;
const CORE = { configRegistry: L.configRegistry, launchFactory: L.factory, graduationAdapter: L.graduationAdapter, feePolicy: L.feePolicy };
const CHAIN_ID = D.chain.id;
const RPC = D.chain.rpcUrls[0];
const EXPLORER = D.chain.blockExplorerUrl || "https://sepolia-explorer.giwa.io";
const WETH = getAddress(D.contracts.tokens.wrappedNative);
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const FACTORY_START = 36220000;

const chain = defineChain({
  id: CHAIN_ID, name: D.chain.name, nativeCurrency: D.chain.nativeCurrency,
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: EXPLORER } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});
const pc = createPublicClient({ chain, transport: http(RPC, { retryCount: 4, retryDelay: 700 }), batch: { multicall: { wait: 16 } } });

const LAUNCH_EVENT = A.ammoraLaunchFactoryV4Abi.find((x) => x.type === "event" && x.name === "LaunchCreated");
const SWAP_EVENT = A.ammoraLaunchPoolV4Abi.find((x) => x.type === "event" && x.name === "Swap");
const LAUNCH_TOPIC = toEventSelector(LAUNCH_EVENT);
const SWAP_TOPIC = toEventSelector(SWAP_EVENT);
// Swap event of the Ammora concentrated pool a token graduates into (post-graduation trades).
const POOL_SWAP_EVENT = { type: "event", name: "Swap", inputs: [
  { indexed: true, name: "sender", type: "address" }, { indexed: true, name: "tokenIn", type: "address" },
  { indexed: false, name: "amountIn", type: "uint256" }, { indexed: false, name: "amountOut", type: "uint256" },
  { indexed: false, name: "protocolFee", type: "uint256" }, { indexed: false, name: "protocolFee2", type: "uint256" },
  { indexed: false, name: "referralFee", type: "uint256" }, { indexed: false, name: "creatorFee", type: "uint256" },
  { indexed: false, name: "lpFee", type: "uint256" }, { indexed: false, name: "sqrtPrice", type: "uint128" },
  { indexed: true, name: "recipient", type: "address" }] };
// Some pool variants emit a slightly different Swap (claiming/compounding fees); decode both.
const POOL_SWAP_EVENT_B = { ...POOL_SWAP_EVENT, inputs: [...POOL_SWAP_EVENT.inputs.slice(0, 6),
  { indexed: false, name: "creatorFee", type: "uint256" }, { indexed: false, name: "referralFee", type: "uint256" },
  { indexed: false, name: "claimingFee", type: "uint256" }, { indexed: false, name: "compoundingFee", type: "uint256" },
  ...POOL_SWAP_EVENT.inputs.slice(9)] };
const POOL_SWAP_EVENTS = [POOL_SWAP_EVENT, POOL_SWAP_EVENT_B];
const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "wad" }], outputs: [] },
];

/* ───────────── storage helpers (all optional, never required) ───────────── */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))); } catch {} },
};
// Every Config this site has used (current + previous), for the "On Anvora" filter and counter.
const siteConfigIds = () => new Set([launchConfigId(), ...(SITE.previousConfigIds || [])].filter((x) => x !== null && x !== undefined).map((x) => BigInt(x)));
const isSiteLaunch = (x) => siteConfigIds().has(BigInt(x.configId ?? -1));
const launchConfigId = () => {
  if (SITE.launchConfigId !== null && SITE.launchConfigId !== undefined) return BigInt(SITE.launchConfigId);
  const saved = store.get("anvora.configId");
  return saved ? BigInt(saved) : null;
};

/* ───────────── light / dark theme ───────────── */
const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>`;
const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`;
const savedTheme = () => { try { return localStorage.getItem("anvora.theme"); } catch { return null; } };
const isDark = () => document.documentElement.dataset.theme === "dark";
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = document.getElementById("theme");
  if (b) { b.innerHTML = t === "dark" ? SUN : MOON; b.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode"); b.title = b.getAttribute("aria-label"); }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#141518");
  if (lastChart) drawChart(lastChart);
}
let lastChart = null;
document.getElementById("theme").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  try { localStorage.setItem("anvora.theme", next); } catch {}
  applyTheme(next);
});

/* ───────────── small helpers ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const txUrl = (h) => `${EXPLORER}/tx/${h}`;
const addrUrl = (a) => `${EXPLORER}/address/${a}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

function fmt(n, sig = 4) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(1) + "K";
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  if (a >= 1e-4) return n.toLocaleString("en-US", { maximumSignificantDigits: sig });
  // 0.00000005 -> 0.0₇5 (subscript = number of zeros after the decimal point)
  const zeros = Math.floor(-Math.log10(a));
  const digits = (a * 10 ** (zeros + 1)).toFixed(Math.max(0, Math.min(sig, 4) - 1)).replace(".", "").replace(/0+$/, "") || "0";
  const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[d]).join("");
  return `${n < 0 ? "-" : ""}0.0${sub}${digits}`;
}
const fu = (v, dec, sig) => fmt(Number(formatUnits(v ?? 0n, dec)), sig);
// Ammora V4 curve prices are sqrt X64: WETH per whole token.
const sqrtToPrice = (sqrt, baseDec, quoteDec = 18) => { const s = Number(sqrt) / 2 ** 64; return s * s * 10 ** (baseDec - quoteDec); };
function ago(sec) {
  if (!sec) return "";
  const d = Math.max(0, Date.now() / 1000 - sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
function errText(e) {
  if (!e) return "Unknown error";
  if (e.code === 4001 || /User (rejected|denied)/i.test(e.message || "")) return "Request rejected in your wallet.";
  const cause = e.details && typeof e.details === "object" ? String(e.details.causeMessage || "") : "";
  const reason = (cause || e.shortMessage || e.message || "").match(/Error: (\w+)\(/)?.[1];
  const base = e.shortMessage || (typeof e.details === "string" ? e.details : "") || e.message || String(e);
  return (reason ? `${base} (${reason})` : base).slice(0, 300);
}
function toast(html, kind = "", ms = 6500) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };
const safeImg = (u) => (typeof u === "string" && u.length < 200_000 && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(u) ? u : null);

/* ───────────── on-chain metadata (data: URIs only, never fetched remotely) ───────────── */
const metaCache = new Map();
function readMeta(uri) {
  if (!uri) return {};
  if (metaCache.has(uri)) return metaCache.get(uri);
  let out = {};
  try {
    if (uri.startsWith("data:application/json;base64,")) {
      const bin = atob(uri.slice(29));
      out = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    } else if (uri.startsWith("data:application/json,")) out = JSON.parse(decodeURIComponent(uri.slice(22)));
  } catch { out = {}; }
  if (!out || typeof out !== "object" || Array.isArray(out)) out = {};
  metaCache.set(uri, out);
  return out;
}
const avatar = (x, cls = "") => {
  const img = safeImg(x.meta?.image);
  const letter = (String(x.symbol || x.meta?.symbol || "?").slice(0, 1).toUpperCase().match(/[A-Z0-9]/) || ["?"])[0];
  return img ? `<img class="avatar ${cls}" src="${esc(img)}" alt="">` : `<div class="avatar ${cls}">${letter}</div>`;
};
const OVERRIDES = Object.fromEntries(Object.entries(SITE.metadataOverrides || {}).map(([k, v]) => [k.toLowerCase(), v]));
const withOverrides = (curve, meta) => ({ ...(meta || {}), ...(OVERRIDES[String(curve || "").toLowerCase()] || {}) });
const OFFICIAL = new Set((SITE.officialTokens || []).map((x) => String(x).toLowerCase()));
const isOfficial = (...addrs) => addrs.some((a) => a && OFFICIAL.has(String(a).toLowerCase()));
const LABELS = new Map(Object.entries(SITE.tokenLabels || {}).map(([k, v]) => [k.toLowerCase(), v]));
const verTag = (...addrs) => { const a = addrs.find((x) => x && LABELS.has(String(x).toLowerCase())); return a ? ` <span class="vtag">${esc(LABELS.get(String(a).toLowerCase()))}</span>` : ""; };
// "Anvora" badge: launched through one of this site's Configs (the official token already says so).
const siteBadge = `<span class="badge b-site" title="Launched on ${esc(SITE.name)}">${esc(SITE.name)}</span>`;
const siteBadgeFor = (x, official) => (!official && isSiteLaunch(x) ? siteBadge : "");
const officialBadge = `<span class="badge b-official" title="The official ${esc(SITE.name)} token">✓ Official</span>`;
// "New" for launches from the last 24 hours (only when the launch time is known).
const isNew = (x) => !!x.time && Date.now() / 1000 - x.time < 86_400;
const newBadge = `<span class="badge b-new" title="Launched in the last 24 hours">New</span>`;
const statusBadge = (s) => (s === 1 ? `<span class="badge b-live">Live</span>`
  : s === 2 ? `<span class="badge b-ready">Ready to graduate</span>`
  : s === 3 ? `<span class="badge b-grad">Graduated</span>` : `<span class="badge b-off">Inactive</span>`);

/* ───────────── wallet (EIP-6963 + window.ethereum fallback) ───────────── */
const W = { address: null, chainId: null, wc: null, provider: null };
const WALLETS = [];
window.addEventListener("eip6963:announceProvider", (e) => {
  const d = e.detail;
  if (d?.info?.rdns && d.provider?.request && !WALLETS.some((w) => w.info.rdns === d.info.rdns)) WALLETS.push(d);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function pickWallet() {
  if (WALLETS.length <= 1) return Promise.resolve(WALLETS[0]?.provider || window.ethereum || null);
  return new Promise((resolve) => {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal"><h3>Connect a wallet</h3>
      ${WALLETS.map((w, i) => {
        // EIP-6963 wallets announce their own icon as a data: URI; anything else falls back to a letter.
        const icon = /^data:image\/(svg\+xml|png|jpe?g|webp|gif)[;,]/i.test(w.info.icon || "") && w.info.icon.length < 300_000
          ? `<img src="${esc(w.info.icon)}" alt="" width="28" height="28">` : `<span class="wl">${esc((w.info.name || "?").slice(0, 1))}</span>`;
        return `<button class="btn block wopt" data-i="${i}">${icon}<span>${esc(w.info.name || w.info.rdns)}</span></button>`;
      }).join("")}
      <button class="btn block" data-x>Cancel</button></div>`;
    bg.onclick = (e) => {
      const b = e.target.closest("button");
      if (e.target === bg || b?.dataset.x !== undefined) { bg.remove(); resolve(null); }
      else if (b) { bg.remove(); resolve(WALLETS[Number(b.dataset.i)].provider); }
    };
    document.body.appendChild(bg);
  });
}
function attach(p, addr, cid) {
  if (W.provider !== p) {
    p.on?.("accountsChanged", (a) => { W.address = a?.[0] ? getAddress(a[0]) : null; renderHeader(); render(); });
    p.on?.("chainChanged", (c) => { W.chainId = Number(c); renderHeader(); });
  }
  W.provider = p; W.address = getAddress(addr); W.chainId = Number(cid);
  W.wc = createWalletClient({ chain, transport: custom(p) });
  store.set("anvora.disconnected", false);
  refreshWalletLabels();
}
// Buttons that read "Connect wallet" until a wallet is connected carry their real label in data-wl.
function refreshWalletLabels() {
  if (!W.address) return;
  document.querySelectorAll("[data-wl]").forEach((b) => { b.textContent = b.dataset.wl; });
}
async function connect() {
  await sleep(0);
  const p = await pickWallet();
  if (!p) throw new Error("No browser wallet found. Install MetaMask, Rabby or another EVM wallet.");
  const [addr] = await p.request({ method: "eth_requestAccounts" });
  if (!addr) throw new Error("No account selected.");
  attach(p, addr, await p.request({ method: "eth_chainId" }));
  store.set("anvora.wallet", WALLETS.find((w) => w.provider === p)?.info.rdns || "injected");
  renderHeader();
}
async function ensureChain() {
  if (W.chainId === CHAIN_ID) return;
  try {
    await W.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(CHAIN_ID) }] });
  } catch (e) {
    if (e.code === 4902 || /Unrecognized|not been added|unknown chain/i.test(e.message || "")) {
      await W.provider.request({ method: "wallet_addEthereumChain", params: [{
        chainId: toHex(CHAIN_ID), chainName: "GIWA Sepolia", nativeCurrency: D.chain.nativeCurrency, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER],
      }] });
    } else throw e;
  }
  W.chainId = Number(await W.provider.request({ method: "eth_chainId" }));
  renderHeader();
  if (W.chainId !== CHAIN_ID) throw new Error("Please switch your wallet to GIWA Sepolia.");
}
async function ensureWallet() { if (!W.address) await connect(); await ensureChain(); return W.address; }
function disconnect() { store.set("anvora.disconnected", true); W.address = null; W.wc = null; renderHeader(); render(); }
// Silent reconnect after a refresh: ask the wallet used last time (then any other) for already-approved accounts.
// eth_accounts never opens a popup. Wallet extensions announce themselves a moment after load, so retry briefly.
async function silentReconnect() {
  if (store.get("anvora.disconnected")) return;
  const last = store.get("anvora.wallet");
  for (let i = 0; i < 6 && !W.address; i++) {
    const ordered = [...WALLETS].sort((a, b) => (b.info.rdns === last) - (a.info.rdns === last)).map((w) => w.provider);
    if (window.ethereum && !ordered.includes(window.ethereum)) ordered.push(window.ethereum);
    for (const p of ordered) {
      try {
        const [a] = await p.request({ method: "eth_accounts" });
        if (a && !W.address) { attach(p, a, await p.request({ method: "eth_chainId" })); renderHeader(); render(); return; }
      } catch {}
    }
    if (last && !WALLETS.some((w) => w.info.rdns === last) && i < 5) { await sleep(300); continue; }
    if (ordered.length) return;
    await sleep(300);
  }
}
setTimeout(silentReconnect, 150);
initI18n();

function renderHeader() {
  const w = $("#wallet");
  w.innerHTML = W.address
    ? `<div class="wbtn"><button class="btn sm" id="wacct"><span class="dot"></span><span class="mono">${short(W.address)}</span></button></div>`
    : `<button class="btn pri sm" id="wconn">Connect wallet</button>`;
  $("#wconn")?.addEventListener("click", () => ensureWallet().catch((e) => toast(esc(errText(e)), "err")));
  $("#wacct")?.addEventListener("click", () => { if (confirmBox("Disconnect this wallet from Anvora?")) disconnect(); });
  $("#netwarn").innerHTML = W.address && W.chainId !== CHAIN_ID
    ? `Your wallet is on another network. <a href="#" id="sw">Switch to GIWA Sepolia</a>` : "";
  $("#sw")?.addEventListener("click", (e) => { e.preventDefault(); ensureChain().catch((x) => toast(esc(errText(x)), "err")); });
  const r = location.hash.replace(/^#\/?/, "").split("/")[0];
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
  const mb = document.getElementById("tbmore"); if (mb) mb.classList.toggle("on", mb.dataset.more.split(" ").includes(r));
  const sh = document.getElementById("tbsheet"); if (sh) sh.hidden = true;
}
/* ───────────── sharing ───────────── */
const ICON_SHARE = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
const ICON_OUT = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>`;
const SITE_X = (SITE.links?.x || "").match(/x\.com\/([A-Za-z0-9_]+)/)?.[1] || "";
// The home page is shared as the bare address (no "#/"); other pages need their #/route to open the right view.
const pageUrl = (hash) => `${location.origin}${location.pathname}${hash && hash !== "#/" && hash !== "#" ? hash : ""}`;
// A small sheet: Share on X (prefilled post), the device's own share menu where it exists, Copy link.
function shareSheet({ title, text, url }) {
  const x = new URL("https://x.com/intent/post");
  x.searchParams.set("text", text);
  x.searchParams.set("url", url);
  if (SITE_X) x.searchParams.set("via", SITE_X);
  const canNative = typeof navigator.share === "function";
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3>
    <div class="out" style="font-size:14px;white-space:pre-line">${esc(text)}\n<span class="mono" style="word-break:break-all">${esc(url)}</span></div>
    <a class="btn pri block" href="${esc(x.href)}" target="_blank" rel="noopener">Share on X</a>
    ${canNative ? `<button class="btn block" data-native>Share via…</button>` : ""}
    <button class="btn block" data-copy>Copy link</button>
    <button class="btn block" data-x>Close</button></div>`;
  bg.onclick = async (e) => {
    if (e.target === bg || e.target.closest("[data-x]")) return bg.remove();
    if (e.target.closest("[data-copy]")) {
      const b = e.target.closest("[data-copy]");
      try { await navigator.clipboard.writeText(url); b.textContent = "Link copied ✓"; }
      catch { b.textContent = "Copy failed: long-press the link above"; }
      return;
    }
    if (e.target.closest("[data-native]")) {
      try { await navigator.share({ title: SITE.name, text, url }); } catch {}
    }
  };
  document.body.appendChild(bg);
}

const confirmBox = (msg) => { try { return window.confirm(msg); } catch { return true; } };

/* ───────────── transactions ───────────── */
async function sendTx({ to, data, value = 0n }, label = "Transaction") {
  const account = W.address;
  // Simulate first so a revert shows before signing. RPC replicas can lag a just-confirmed approval.
  for (let i = 0; ; i++) {
    try { await pc.call({ account, to, data, value }); break; }
    catch (e) { if (i >= 3) throw e; await sleep(2500); }
  }
  const hash = await W.wc.sendTransaction({ account, chain, to, data, value });
  toast(`${esc(label)} sent · <a href="${txUrl(hash)}" target="_blank" rel="noopener">view</a>`);
  const receipt = await pc.waitForTransactionReceipt({ hash, pollingInterval: 1500, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted (${hash})`);
  toast(`${esc(label)} confirmed · <a href="${txUrl(hash)}" target="_blank" rel="noopener">view</a>`, "ok");
  return receipt;
}
const balanceOf = (token, who) => pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });
const allowance = (token, owner, spender) => pc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
// "Max" buy: all WETH plus all ETH except a small reserve kept for gas.
const GAS_RESERVE = parseUnits("0.001", 18);
const maxBuy = (b, ethOnly = false) => { const e = b.eth > GAS_RESERVE ? b.eth - GAS_RESERVE : 0n; return ethOnly ? e : e + b.weth; };
const wrapTx = (amt) => ({ to: WETH, data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" }), value: amt });
const unwrapTx = (amt) => ({ to: WETH, data: encodeFunctionData({ abi: wethAbi, functionName: "withdraw", args: [amt] }) });

// Extra steps a trade needs: wrap the missing ETH into WETH, exact-amount approvals.
async function prepSteps({ approvals = [], wethNeeded = 0n }) {
  const steps = [];
  if (wethNeeded > 0n) {
    const wbal = await balanceOf(WETH, W.address);
    if (wbal < wethNeeded) {
      const diff = wethNeeded - wbal;
      if ((await pc.getBalance({ address: W.address })) < diff) throw new Error(`Not enough ETH: you need ${formatUnits(diff, 18)} more ETH (plus gas).`);
      steps.push({ label: `Wrap ${fu(diff, 18, 6)} ETH → WETH`, run: () => sendTx(wrapTx(diff), "Wrap ETH") });
    }
  }
  for (const a of approvals) {
    const amount = a.amount ?? a.exactAmountRaw;
    if ((await allowance(a.token, W.address, a.spender)) < amount) {
      steps.push({ label: "Approve exact amount", run: () => sendTx({ to: a.token, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [a.spender, amount] }) }, "Approval") });
    }
  }
  return steps;
}

// Modal that runs a list of wallet steps in order and shows progress.
function runSteps(title, steps) {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><ul class="steps">${steps.map((s) => `<li><i></i><span>${esc(s.label)}</span></li>`).join("")}</ul>
    <div class="msg muted" style="font-size:13px">Confirm each step in your wallet.</div><button class="btn block" data-x hidden>Close</button></div>`;
  document.body.appendChild(bg);
  const lis = bg.querySelectorAll(".steps li");
  const close = $("[data-x]", bg);
  close.onclick = () => bg.remove();
  return (async () => {
    for (let i = 0; i < steps.length; i++) {
      lis[i].className = "run";
      try { await steps[i].run(); lis[i].className = "done"; lis[i].querySelector("i").textContent = "✓"; }
      catch (e) {
        lis[i].className = "fail"; lis[i].querySelector("i").textContent = "!";
        $(".msg", bg).innerHTML = `<span class="bad">${esc(errText(e))}</span>`;
        close.hidden = false;
        throw Object.assign(e, { shown: true });
      }
    }
    bg.remove();
  })();
}

// The public GIWA RPC is load-balanced and some nodes see a just-confirmed transaction a few
// seconds late. These helpers retry reads that fail only because of that lag.
const LAG_RE = /below the atomic first-buy|returned no data|not visible yet|could not be found|header not found|unknown block/i;
async function retryLag(fn, tries = 6, gap = 2500) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) { if (i >= tries - 1 || !LAG_RE.test(String(e?.shortMessage || e?.message || e))) throw e; await sleep(gap); }
  }
}
async function waitFor(check, msg, tries = 8, gap = 2000) {
  for (let i = 0; i < tries; i++) { if (await check()) return; await sleep(gap); }
  throw new Error(msg);
}

/* ───────────── launch discovery ───────────── */
// GIWA's Blockscout explorer indexes LaunchCreated logs (full history, fast). RPC is the fallback.
async function explorerLogs({ address, topic0, topic1, topic2, fromBlock = FACTORY_START }) {
  const out = [];
  let from = fromBlock;
  for (let page = 0; page < 8; page++) {
    const q = new URLSearchParams({ module: "logs", action: "getLogs", fromBlock: String(from), toBlock: "latest" });
    if (address) q.set("address", address);
    if (topic0) q.set("topic0", topic0);
    if (topic1) { q.set("topic1", topic1); q.set("topic0_1_opr", "and"); }
    if (topic2) { q.set("topic2", topic2); q.set("topic0_2_opr", "and"); }
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25_000);
    const j = await fetch(`${EXPLORER}/api?${q}`, { signal: ctl.signal }).then((r) => r.json()).finally(() => clearTimeout(t));
    const res = Array.isArray(j.result) ? j.result : [];
    out.push(...res);
    if (res.length < 1000) break;
    from = Number(res[res.length - 1].blockNumber) + 1;
  }
  return out;
}
async function rpcLogs({ address, event, events, windows = 10 }) {
  const head = await pc.getBlockNumber();
  const out = [];
  for (let i = 0; i < windows; i++) {
    const to = head - BigInt(i * 10_000);
    if (to < BigInt(FACTORY_START)) break;
    const logs = await pc.getLogs({ address, ...(events ? { events } : { event }), fromBlock: to - 9_999n, toBlock: to });
    out.push(...logs);
  }
  return out;
}
function decodeLaunch(l) {
  const ev = decodeEventLog({ abi: A.ammoraLaunchFactoryV4Abi, data: l.data, topics: l.topics.filter(Boolean) });
  return {
    token: getAddress(ev.args.token), curve: getAddress(ev.args.curve), creator: getAddress(ev.args.creator),
    configId: ev.args.configId, configHash: ev.args.configHash, metadataURI: ev.args.metadataURI,
    block: Number(l.blockNumber), time: l.timeStamp ? Number(l.timeStamp) : null, tx: l.transactionHash,
  };
}

let launchCache = { at: 0, list: [] };
async function loadLaunches(force = false) {
  if (!force && Date.now() - launchCache.at < 30_000 && launchCache.list.length) return launchCache.list;
  let raw;
  try { raw = await explorerLogs({ address: L.factory, topic0: LAUNCH_TOPIC }); }
  catch { raw = await rpcLogs({ address: L.factory, event: LAUNCH_EVENT }); }
  const byCurve = new Map();
  for (const l of raw) { try { const x = decodeLaunch(l); byCurve.set(x.curve, x); } catch {} }
  for (const x of store.get("anvora.created", [])) if (!byCurve.has(x.curve)) byCurve.set(x.curve, { ...x, configId: BigInt(x.configId) });
  const hidden = new Set((SITE.hiddenTokens || []).map((x) => String(x).toLowerCase()));
  const list = [...byCurve.values()].filter((x) => !hidden.has(x.curve.toLowerCase()) && !hidden.has(x.token.toLowerCase()))
    .sort((a, b) => b.block - a.block);
  await enrich(list);
  launchCache = { at: Date.now(), list };
  return list;
}
// One multicall reads every curve and token: status, price, reserves, names.
async function enrich(list) {
  const fc = ["status", "sqrtPrice", "quoteReserve", "migrationQuoteThreshold", "canonicalPool"];
  const ft = ["name", "symbol", "decimals", "totalSupply"];
  const contracts = list.flatMap((x) => [
    ...fc.map((functionName) => ({ address: x.curve, abi: A.ammoraLaunchPoolV4Abi, functionName })),
    ...ft.map((functionName) => ({ address: x.token, abi: erc20Abi, functionName })),
  ]);
  const chunks = [];
  for (let i = 0; i < contracts.length; i += 250) chunks.push(contracts.slice(i, i + 250));
  const res = (await Promise.all(chunks.map((c) => pc.multicall({ contracts: c, allowFailure: true })))).flat();
  const per = fc.length + ft.length;
  list.forEach((x, i) => {
    const r = res.slice(i * per, (i + 1) * per).map((y) => (y.status === "success" ? y.result : undefined));
    [x.status, x.sqrtPrice, x.quoteReserve, x.threshold, x.pool, x.name, x.symbol, x.decimals, x.supply] = r;
    x.decimals = Number(x.decimals ?? 18);
    x.meta = withOverrides(x.curve, readMeta(x.metadataURI));
    x.price = x.sqrtPrice ? sqrtToPrice(x.sqrtPrice, x.decimals) : 0;
    x.mcap = x.supply ? x.price * Number(formatUnits(x.supply, x.decimals)) : 0;
    x.progress = x.status >= 2 ? 1 : x.threshold ? Math.min(1, Number(x.quoteReserve ?? 0n) / Number(x.threshold)) : 0;
    x.raised = Number(formatUnits(x.status >= 2 ? (x.threshold ?? 0n) : (x.quoteReserve ?? 0n), 18));
    // A broken or misconfigured launch shows absurd values (e.g. 750K ETH market cap on an empty curve).
    x.junk = !Number.isFinite(x.mcap) || x.mcap > 1000 || x.mcap < 1e-9 || x.status === undefined;
    x.test = TEST_RE.test(`${x.name || ""} ${x.symbol || ""}`);
  });
}

/* ───────────── view: explore ───────────── */
const TEST_RE = /test|demo|deneme|\bqa\b|throwaway/i;
const PAGE = 48;
const ui = { filter: "all", sort: "hot", q: "", hideTest: true, limit: PAGE };
let renderId = 0;

async function viewExplore(id) {
  const cid = launchConfigId();
  app.innerHTML = `
  <section class="hero">
    <div class="copy">
      <h1>Launch a token. <em>Watch it rise</em> on the curve.</h1>
      <p>${esc(SITE.tagline)}</p>
      <div class="row"><a class="btn pri" href="#/create">Launch a token</a><button class="btn" id="browse">Browse launches</button><button class="btn icon" id="shareSite" aria-label="Share ${esc(SITE.name)}" title="Share ${esc(SITE.name)}">${ICON_SHARE}</button></div>
    </div>
    <a class="spot" id="spot" hidden></a>
    <div class="plate"><div class="ph"><i></i>Live on ${esc(SITE.name)}<button class="ph-link" id="sitestats" title="Show tokens launched on ${esc(SITE.name)}">See them →</button></div>
      <div class="stats" id="stats">${[0, 1, 2, 3].map(() => `<div class="stat"><span>&nbsp;</span><b>—</b></div>`).join("")}</div>
      <div class="ticker" id="ticker"><span class="tk-live"><i></i><span data-ko="실시간">Live</span></span><div class="tk-view"><div class="tk-track" id="tktrack"><span class="tk-i muted">Loading the latest trades…</span></div></div></div>
      <div class="gline" id="gline">&nbsp;</div></div>
  </section>
  <div class="toolbar tb1" id="list">
    <div class="seg" id="filter">${[["all", "All"], ["live", "Live"], ["near", "Near graduation"], ["grad", "Graduated"], ["site", `On ${SITE.name}`]]
      .map(([k, n]) => `<button data-k="${k}" class="${ui.filter === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="tb-right">
      <input class="inp search" id="q" placeholder="Search name, ticker or address" value="${esc(ui.q)}" />
      <span class="tcount" id="tcount"><i></i><b>…</b></span>
      <label class="sortsel"><span>Sort</span><select id="sort">${[["trend", "Trending"], ["hot", "Most raised"], ["new", "Newest"], ["mcap", "Market cap"], ["prog", "Progress"]].map(([k, n]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="chk" title="Hide test and broken tokens"><input type="checkbox" id="hide" ${ui.hideTest ? "checked" : ""}/> Hide tests</label>
    </div>
  </div>
  <div class="grid" id="cards">${Array.from({ length: 6 }, () => `<div class="skel"></div>`).join("")}</div>
  <div id="more" style="text-align:center;margin-top:18px"></div>`;

  $("#shareSite").onclick = () => shareSheet({ title: `Share ${SITE.name}`, text: `${SITE.name}: launch a token on GIWA in one transaction and watch it rise on the bonding curve ⚒️`, url: pageUrl("#/") });
  $("#browse").onclick = () => $("#list").scrollIntoView({ behavior: "smooth" });
  let list;
  try { list = await loadLaunches(); }
  catch (e) { if (id === renderId) $("#cards").outerHTML = `<div class="empty">Could not load launches: ${esc(errText(e))}<br><button class="btn" style="margin-top:12px" onclick="location.reload()">Retry</button></div>`; return; }
  if (id !== renderId) return;

  // Big numbers are this site's own launches; the whole of Ammora on GIWA is a supporting line underneath.
  {
    const mineList = list.filter(isSiteLaunch);
    const creators = new Set(mineList.map((x) => x.creator.toLowerCase())).size;
    const g = mineList.filter((x) => x.status >= 2).length;
    const raised = mineList.reduce((a, x) => a + (x.raised || 0), 0);
    $("#stats").innerHTML = [["Tokens launched", fmt(mineList.length)], ["Creators", fmt(creators)], ["Graduated", fmt(g)], ["WETH raised", fmt(raised)]]
      .map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
    const gradAll = list.filter((x) => x.status === 3).length, liveAll = list.filter((x) => x.status === 1).length;
    $("#gline").innerHTML = `Across all of Ammora on GIWA: <b>${fmt(list.length)}</b> launches · <b>${fmt(liveAll)}</b> live · <b>${fmt(gradAll)}</b> graduated`;
    $("#sitestats").onclick = () => { $('#filter button[data-k="site"]')?.click(); $("#list").scrollIntoView({ behavior: "smooth" }); };
  }

  drawSpot(list);

  const draw = () => {
    const q = ui.q.trim().toLowerCase();
    let rows = list.filter((x) =>
      (ui.filter === "all") || (ui.filter === "live" && x.status === 1) || (ui.filter === "grad" && x.status === 3)
      || (ui.filter === "near" && x.status === 1 && x.progress >= 0.5) || (ui.filter === "site" && isSiteLaunch(x)));
    if (q) rows = rows.filter((x) => [x.name, x.symbol, x.token, x.curve].some((v) => String(v || "").toLowerCase().includes(q)));
    // Your own launchpad's tokens are never hidden.
    else if (ui.hideTest) rows = rows.filter((x) => isSiteLaunch(x) || (!x.junk && !x.test));
    const m = (x) => (x.junk ? -1 : x.mcap);
    if (ui.sort === "hot") rows = [...rows].sort((a, b) => b.raised - a.raised || b.block - a.block);
    if (ui.sort === "trend") rows = [...rows].sort((a, b) => (b.d24?.vol || 0) - (a.d24?.vol || 0) || (b.d24?.trades || 0) - (a.d24?.trades || 0) || b.raised - a.raised);
    if (ui.sort === "mcap") rows = [...rows].sort((a, b) => m(b) - m(a));
    if (ui.sort === "prog") rows = [...rows].sort((a, b) => b.progress - a.progress);
    rows = [...rows.filter((x) => isOfficial(x.curve, x.token)), ...rows.filter((x) => !isOfficial(x.curve, x.token))];
    if ($("#tcount")) $("#tcount").innerHTML = `<i></i><b>${fmt(rows.length)}</b> ${rows.length === 1 ? "token" : "tokens"}`;
    $("#cards").innerHTML = rows.length ? rows.slice(0, ui.limit).map(card).join("")
      : `<div class="empty" style="grid-column:1/-1">No launches match. <a href="#/create">Launch the first one</a>.</div>`;
    $("#more").innerHTML = rows.length > ui.limit ? `<button class="btn" id="morebtn">Load more (${rows.length - ui.limit} left)</button>` : "";
    $("#morebtn")?.addEventListener("click", () => { ui.limit += PAGE; draw(); });
  };
  const reset = () => { ui.limit = PAGE; draw(); };
  $("#filter").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.filter = b.dataset.k; $("#filter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); reset(); };
  $("#sort").onchange = (e) => { ui.sort = e.target.value; reset(); };
  $("#q").oninput = (e) => { ui.q = e.target.value; reset(); };
  $("#hide").onchange = (e) => { ui.hideTest = e.target.checked; reset(); };
  draw();
  // 24h volume/change arrive a moment later; redraw the cards when they do.
  load24h(list).then((m) => { if (id !== renderId) return; list.forEach((x) => (x.d24 = m.get(x.curve.toLowerCase()) || null)); draw(); drawTicker(list); }).catch(() => {});
}
// One normalized trade from a curve or pool Swap log: who, which token, buy/sell, WETH and token amounts, when.
function decodeSwapLog(l, x, fromPool) {
  try {
    if (!fromPool) {
      const a = decodeEventLog({ abi: A.ammoraLaunchPoolV4Abi, data: l.data, topics: l.topics.filter(Boolean) }).args;
      const weth = a.baseForQuote ? a.amountOut : a.amountIn, tokens = a.baseForQuote ? a.amountIn : a.amountOut;
      if (!tokens) return null;
      return { x, sell: a.baseForQuote, weth, tokens, trader: a.recipient && a.recipient !== zeroAddress ? a.recipient : a.trader, time: Number(l.timeStamp), tx: l.transactionHash, pool: false };
    }
    const a = decodeEventLog({ abi: POOL_SWAP_EVENTS, data: l.data, topics: l.topics.filter(Boolean) }).args;
    if (!a.tokenIn) return null;
    const sell = a.tokenIn.toLowerCase() === x.token.toLowerCase();
    const weth = sell ? a.amountOut : a.amountIn, tokens = sell ? a.amountIn : a.amountOut;
    if (!tokens) return null;
    return { x, sell, weth, tokens, trader: a.recipient && a.recipient !== zeroAddress ? a.recipient : a.sender, time: Number(l.timeStamp), tx: l.transactionHash, pool: true };
  } catch { return null; }
}
// Every trade on the given launches since fromBlock: per-address explorer queries (curve + pool), small concurrency.
async function swapsFor(launches, fromBlock = FACTORY_START) {
  const out = [], jobs = [];
  for (const x of launches) {
    jobs.push(() => explorerLogs({ address: x.curve, topic0: SWAP_TOPIC, fromBlock }).then((r) => r.forEach((l) => { const t = decodeSwapLog(l, x, false); if (t) out.push(t); })).catch(() => {}));
    if (x.pool && x.pool !== zeroAddress) jobs.push(() => explorerLogs({ address: x.pool, fromBlock }).then((r) => r.forEach((l) => { const t = decodeSwapLog(l, x, true); if (t) out.push(t); })).catch(() => {}));
  }
  let k = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < jobs.length) await jobs[k++](); }));
  return out.sort((a, b) => b.time - a.time);
}

// 24h activity across all launches: one explorer query per Swap event type, grouped by curve/pool.
let act24 = { at: 0, map: new Map() };
async function load24h(list) {
  if (Date.now() - act24.at < 60_000 && act24.map.size) return act24.map;
  const since = Math.floor(Date.now() / 1000) - 86_400;
  let fromBlock;
  try {
    const j = await fetch(`${EXPLORER}/api?module=block&action=getblocknobytime&timestamp=${since}&closest=before`).then((r) => r.json());
    fromBlock = Number(j.result?.blockNumber);
  } catch {}
  if (!fromBlock) fromBlock = Math.max(FACTORY_START, Number(await pc.getBlockNumber()) - 86_400);
  const byCurve = new Map(list.map((x) => [x.curve.toLowerCase(), x]));
  const byPool = new Map(list.filter((x) => x.pool && x.pool !== zeroAddress).map((x) => [x.pool.toLowerCase(), x]));
  const map = new Map(), events = [];
  const add = (x, weth, price, t) => {
    if (!x) return;
    const k = x.curve.toLowerCase();
    const m = map.get(k) || { vol: 0, trades: 0, first: null, last: null };
    m.vol += weth; m.trades++;
    if (!m.first || t < m.first.t) m.first = { t, price };
    if (!m.last || t >= m.last.t) m.last = { t, price };
    map.set(k, m);
  };
  // Curve swaps: one explorer query for the shared Swap event (every launch curve emits it, and nothing else does).
  // Pool swaps: per pool, because the Ammora pool Swap event is shared with every other Ammora pool on GIWA.
  const recent = Date.now() / 1000 - 14 * 86_400;
  let curveLogs = await explorerLogs({ topic0: SWAP_TOPIC, fromBlock }).catch(() => []);
  const poolLogs = [];
  const jobs = [];
  const pools = list.filter((x) => x.pool && x.pool !== zeroAddress).sort((p, q) => (q.time || 0) - (p.time || 0)).slice(0, 40);
  for (const x of pools) jobs.push(() => explorerLogs({ address: x.pool, fromBlock }).then((r) => poolLogs.push(r)).catch(() => {}));
  if (!curveLogs.length) {
    // Fallback: per-curve queries for the tokens most likely to be active.
    const cands = list.filter((x) => isOfficial(x.curve, x.token) || isSiteLaunch(x) || x.status === 1 || (x.time && x.time > recent))
      .sort((p, q) => (q.time || 0) - (p.time || 0)).slice(0, 48);
    for (const x of cands) jobs.push(() => explorerLogs({ address: x.curve, topic0: SWAP_TOPIC, fromBlock }).then((r) => curveLogs.push(...r)).catch(() => {}));
  }
  let k = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (k < jobs.length) await jobs[k++](); }));
  for (const l of curveLogs) {
    const x = byCurve.get(String(l.address).toLowerCase()); if (!x) continue;
    const ev = decodeSwapLog(l, x, false); if (ev) events.push(ev);
    try {
      const a = decodeEventLog({ abi: A.ammoraLaunchPoolV4Abi, data: l.data, topics: l.topics.filter(Boolean) }).args;
      const weth = a.baseForQuote ? a.amountOut : a.amountIn, tokens = a.baseForQuote ? a.amountIn : a.amountOut;
      if (!tokens) continue;
      add(x, Number(formatUnits(weth, 18)), Number(formatUnits(weth, 18)) / Number(formatUnits(tokens, x.decimals)), Number(l.timeStamp));
    } catch {}
  }
  for (const l of poolLogs.flat()) {
    const x = byPool.get(String(l.address).toLowerCase()); if (!x) continue;
    const ev = decodeSwapLog(l, x, true); if (ev) events.push(ev);
    try {
      const a = decodeEventLog({ abi: POOL_SWAP_EVENTS, data: l.data, topics: l.topics.filter(Boolean) }).args;
      const sell = a.tokenIn.toLowerCase() === x.token.toLowerCase();
      const weth = sell ? a.amountOut : a.amountIn, tokens = sell ? a.amountIn : a.amountOut;
      if (!tokens) continue;
      add(x, Number(formatUnits(weth, 18)), Number(formatUnits(weth, 18)) / Number(formatUnits(tokens, x.decimals)), Number(l.timeStamp));
    } catch {}
  }
  for (const [k, m] of map) {
    const x = byCurve.get(k);
    // Change: from the first fill in the window to now (curve's live price, or the last pool fill once graduated).
    const now = x.status === 1 && x.price ? x.price : m.last.price;
    m.change = m.first.price > 0 ? now / m.first.price - 1 : 0;
  }
  events.sort((a, b) => b.time - a.time);
  act24 = { at: Date.now(), map, events };
  return map;
}
const pctTxt = (c) => `${c >= 0 ? "+" : ""}${Math.abs(c) >= 10 ? fmt(c * 100) : (c * 100).toFixed(1)}%`;
const card = (x) => `
  <a class="card tcard" href="#/token/${x.curve}">
    <div class="thead">${avatar(x)}<div style="flex:1;min-width:0"><b>${esc(x.name || x.meta?.name || "Unnamed")}${verTag(x.curve, x.token)}</b><span class="muted mono">$${esc(x.symbol || "?")}</span></div><div class="tbadges">${isNew(x) ? newBadge : ""}${statusBadge(x.status)}${isOfficial(x.curve, x.token) ? officialBadge : ""}${siteBadgeFor(x, isOfficial(x.curve, x.token))}</div></div>
    ${x.meta?.description ? `<div class="muted tdesc">${esc(x.meta.description)}</div>` : ""}
    <div class="tnums"><div><span>Market cap</span><b>${x.junk ? "—" : `${fmt(x.mcap)} ETH`}</b></div><div><span>Raised</span><b>${fmt(x.raised)} WETH</b></div></div>
    ${x.d24 && x.d24.vol > 0 ? `<div class="t24"><span>24h</span><b>${fmt(x.d24.vol)} WETH vol</b><span class="muted">· ${x.d24.trades} trade${x.d24.trades === 1 ? "" : "s"}</span><em class="${x.d24.change >= 0 ? "up" : "down"}">${pctTxt(x.d24.change)}</em></div>` : ""}
    <div class="tprog"><div class="bar"><i style="width:${(x.progress * 100).toFixed(1)}%"></i></div><b>${(x.progress * 100).toFixed(x.progress >= 1 ? 0 : 1)}%</b></div>
    <div class="kv tfoot"><span>Creator <span class="clink" data-href="#/portfolio/${x.creator}" title="See this creator's launches and holdings">${short(x.creator)}</span></span><span>${x.time ? ago(x.time) : `block ${x.block}`}</span></div>
  </a>`;

// Spotlight: the live token closest to graduation, so anyone can make the buy that graduates it.
function drawSpot(list) {
  const el = $("#spot"); if (!el) return;
  const c = list.filter((x) => x.status === 1 && !x.junk && !x.test && x.progress > 0 && x.progress < 1 && x.threshold)
    .sort((a, b) => b.progress - a.progress)[0];
  if (!c) { el.hidden = true; return; }
  const thr = Number(formatUnits(c.threshold, 18)), left = Math.max(0, thr - c.raised), pct = c.progress * 100;
  el.href = `#/token/${c.curve}`;
  el.innerHTML = `<div class="sp-k">🔥 <span>Closest to graduation</span></div>
    <div class="sp-head">${avatar(c, "lg")}<div style="min-width:0"><b>${esc(c.name || "Unnamed")}${verTag(c.curve, c.token)}</b><span class="mono muted">$${esc(c.symbol || "?")}</span></div></div>
    <div class="sp-pct"><b>${pct.toFixed(1)}%</b><span class="muted">${fmt(left)} WETH to graduate</span></div>
    <div class="sp-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="sp-row"><span><span class="muted">Market cap</span> <b>${c.junk ? "—" : `${fmt(c.mcap)} ETH`}</b></span><span><span class="muted">Raised</span> <b>${fmt(c.raised)} / ${fmt(thr)} WETH</b></span></div>
    <span class="btn pri block sp-btn">Buy $${esc(c.symbol || "?")} →</span>`;
  el.hidden = false;
}

// Live strip on Explore: the latest trades and launches across the site, scrolling.
function drawTicker(list) {
  const el = $("#ticker"), track = $("#tktrack"); if (!el || !track) return;
  const dayAgo = Date.now() / 1000 - 86_400;
  const items = [
    ...(act24.events || []).slice(0, 24).map((e) => ({ t: e.time, html: `<a href="#/token/${e.x.curve}"><span class="mono muted">${short(e.trader)}</span> <b class="${e.sell ? "bad" : "good"}">${e.sell ? "sold" : "bought"}</b> <b>$${esc(e.x.symbol || "?")}</b> <span class="muted">for ${fu(e.weth, 18, 4)} WETH · ${ago(e.time)}</span></a>` })),
    ...list.filter((x) => x.time && x.time > dayAgo).slice(0, 10).map((x) => ({ t: x.time, html: `<a href="#/token/${x.curve}">🚀 <b>$${esc(x.symbol || "?")}</b> <span class="muted">launched · ${ago(x.time)}</span></a>` })),
  ].sort((a, b) => b.t - a.t).slice(0, 24);
  if (!items.length) { track.innerHTML = `<span class="tk-i muted">No trades in the last 24 hours yet. Be the first!</span>`; track.style.animation = "none"; return; }
  const row = items.map((i) => `<span class="tk-i">${i.html}</span>`).join("");
  track.innerHTML = row + row; // doubled for a seamless loop
  track.style.setProperty("--tk-dur", `${Math.max(30, items.length * 5)}s`);
  el.hidden = false;
}

/* ───────────── view: leaderboard ───────────── */
// Rankings for tokens launched on Anvora, read from the chain: top traders by WETH volume and top creators.
let lbCache = { at: 0, trades: [] };
let lbTab = "traders";
async function viewLeaderboard(id) {
  app.innerHTML = `<div class="lbwrap">
    <div><h1 style="font-size:40px">Leaderboard</h1><p class="muted" style="margin:10px 0 0">The most active wallets on tokens launched on ${esc(SITE.name)}, straight from the chain.</p></div>
    <div class="seg bseg" id="lbtabs"><button data-t="traders" class="${lbTab === "traders" ? "on" : ""}">Top traders</button><button data-t="creators" class="${lbTab === "creators" ? "on" : ""}">Top creators</button></div>
    <div id="lbbody"><div class="skel" style="height:220px"></div></div></div>`;
  let list = [];
  try { list = (await loadLaunches()).filter(isSiteLaunch); } catch (e) { $("#lbbody").innerHTML = `<div class="muted">${esc(errText(e))}</div>`; return; }
  if (id !== renderId) return;
  const me = W.address ? W.address.toLowerCase() : "";
  const you = (a) => (me && a.toLowerCase() === me ? ` <span class="htag hy">You</span>` : "");
  const medal = (i) => (i < 3 ? ["🥇", "🥈", "🥉"][i] : `<span class="muted">${i + 1}</span>`);
  const drawCreators = () => {
    const by = new Map();
    for (const x of list) {
      const k = x.creator.toLowerCase(); const c = by.get(k) || { addr: x.creator, launches: 0, grads: 0, raised: 0 };
      c.launches++; if (x.status >= 2) c.grads++; c.raised += x.raised || 0; by.set(k, c);
    }
    const rows = [...by.values()].sort((a, b) => b.grads - a.grads || b.raised - a.raised || b.launches - a.launches).slice(0, 50);
    $("#lbbody").innerHTML = rows.length ? `<div class="card lbtable"><table><thead><tr><th>#</th><th>Creator</th><th>Launches</th><th>Graduated</th><th>Raised</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${medal(i)}</td><td><a class="mono" href="#/portfolio/${r.addr}">${short(r.addr)}</a>${you(r.addr)}</td><td>${r.launches}</td><td>${r.grads}</td><td><b>${fmt(r.raised)}</b> WETH</td></tr>`).join("")}
      </tbody></table></div><div class="help" style="margin-top:8px">Ranked by tokens graduated, then WETH raised.</div>` : `<div class="pempty">No launches yet.</div>`;
  };
  const drawTraders = async () => {
    if (Date.now() - lbCache.at > 120_000) {
      $("#lbbody").innerHTML = `<div class="skel" style="height:220px"></div>`;
      lbCache = { at: Date.now(), trades: await swapsFor(list) };
      if (id !== renderId || lbTab !== "traders") return;
    }
    const by = new Map();
    for (const t of lbCache.trades) {
      const k = String(t.trader).toLowerCase(); const r = by.get(k) || { addr: t.trader, vol: 0n, trades: 0, buys: 0, sells: 0, tokens: new Set() };
      r.vol += t.weth; r.trades++; t.sell ? r.sells++ : r.buys++; r.tokens.add(t.x.curve); by.set(k, r);
    }
    const rows = [...by.values()].sort((a, b) => (b.vol > a.vol ? 1 : b.vol < a.vol ? -1 : b.trades - a.trades)).slice(0, 50);
    $("#lbbody").innerHTML = rows.length ? `<div class="card lbtable"><table><thead><tr><th>#</th><th>Trader</th><th>Volume</th><th>Trades</th><th>Tokens</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td>${medal(i)}</td><td><a class="mono" href="${addrUrl(r.addr)}" target="_blank" rel="noopener">${short(r.addr)}</a>${you(r.addr)}</td><td><b>${fu(r.vol, 18, 4)}</b> WETH</td><td>${r.trades} <span class="muted">(${r.buys}B/${r.sells}S)</span></td><td>${r.tokens.size}</td></tr>`).join("")}
      </tbody></table></div><div class="help" style="margin-top:8px">All-time WETH volume on ${esc(SITE.name)} tokens, bonding curve and Ammora pool trades included.</div>` : `<div class="pempty">No trades yet.</div>`;
  };
  const draw = () => (lbTab === "traders" ? drawTraders() : drawCreators());
  $("#lbtabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; lbTab = b.dataset.t; $("#lbtabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
  draw();
}

/* ───────────── view: token ───────────── */
let swapClientP = null;
const swapClient = () => (swapClientP ??= Promise.resolve(A.AmmoraSwapClient.create(pc, {
  deploymentCatalog: { [CHAIN_ID]: D }, factoryProfiles: A.giwaSepoliaAutoRoutePoolProfiles,
})).catch((e) => { swapClientP = null; throw e; }));

async function loadCtx(curve) {
  const cc = new A.AmmoraV4LaunchCurveClient(pc, curve, CORE);
  const bn = await pc.getBlockNumber();
  const st = await cc.getStateAtBlock(bn);
  const factoryToken = await pc.readContract({ address: L.factory, abi: A.ammoraLaunchFactoryV4Abi, functionName: "tokenForCurve", args: [curve] });
  if (factoryToken === zeroAddress || factoryToken.toLowerCase() !== st.baseToken.toLowerCase()) throw new Error("This address is not an Ammora V4 launch curve.");
  const [name, symbol, decimals, supply] = await Promise.all(["name", "symbol", "decimals", "totalSupply"].map((functionName) => pc.readContract({ address: st.baseToken, abi: erc20Abi, functionName })));
  let cfg = null;
  try { cfg = await A.getAmmoraV4ConfigAtBlock(pc, L.configRegistry, st.configId, bn); } catch {}
  return { cc, st, curve, cfg, tok: { address: st.baseToken, name, symbol, decimals: Number(decimals), supply } };
}

async function viewToken(id, arg) {
  if (!isAddress(arg || "")) { app.innerHTML = `<div class="empty">Invalid curve address.</div>`; return; }
  const curve = getAddress(arg);
  app.innerHTML = `<div class="tok"><div class="left"><div class="skel"></div><div class="skel"></div></div><div class="skel"></div></div>`;
  let ctx;
  try { ctx = await retryLag(() => loadCtx(curve), 8); } catch (e) { if (id === renderId) app.innerHTML = `<div class="empty">Could not load this launch: ${esc(errText(e))}</div>`; return; }
  if (id !== renderId) return;
  const { st, tok } = ctx;
  const info = (launchCache.list.find((x) => x.curve === curve)) || store.get("anvora.created", []).find((x) => x.curve === curve) || null;
  let meta = info ? readMeta(info.metadataURI) : {};
  if (!info) {
    try { const logs = await explorerLogs({ address: L.factory, topic0: LAUNCH_TOPIC, topic2: "0x" + curve.slice(2).toLowerCase().padStart(64, "0") }); if (logs[0]) meta = readMeta(decodeLaunch(logs[0]).metadataURI); } catch {}
  }
  const price = sqrtToPrice(st.sqrtPrice, tok.decimals);
  const mcap = price * Number(formatUnits(tok.supply, tok.decimals));
  const thr = st.migrationQuoteThreshold;
  const progress = st.status >= 2 ? 1 : thr ? Math.min(1, Number(st.quoteReserve) / Number(thr)) : 0;
  meta = withOverrides(curve, meta);
  const links = [["Website", meta.website], ["X", meta.twitter], ["Telegram", meta.telegram]].filter(([, u]) => safeUrl(u || ""));
  const feePct = (Number(st.currentFeeBps) / 100).toFixed(2);

  app.innerHTML = `
  <div class="tok">
    <div class="left">
      <div class="card t-head">
        <div class="thero">${avatar({ meta, symbol: tok.symbol }, "lg")}
          <div style="flex:1;min-width:0"><h2>${esc(tok.name)}${verTag(curve, tok.address)} <span class="muted mono" style="font-size:16px">$${esc(tok.symbol)}</span></h2>
            <div style="margin-top:6px">${statusBadge(st.status)} ${isOfficial(curve, tok.address) ? officialBadge : ""}${siteBadgeFor({ configId: st.configId }, isOfficial(curve, tok.address))} <span class="muted" style="font-size:13px">Config #${st.configId} · fee ${feePct}%</span></div>
            <div class="links">${links.map(([n, u]) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener nofollow">${n} ${ICON_OUT}</a>`).join("")}<button class="lbtn" id="shareTok">${ICON_SHARE} Share</button></div></div></div>
        ${meta.description ? `<p class="muted tdesc2">${esc(meta.description)}</p>` : ""}
      </div>
      <div class="sgrid">
        <div class="stat"><span>Price</span><b>${fmt(price, 5)}</b><span>ETH per token</span></div>
        <div class="stat"><span>Market cap</span><b>${fmt(mcap)}</b><span>ETH</span></div>
        ${st.status === 3 ? `<div class="stat"><span>Supply</span><b>${fu(tok.supply, tok.decimals)}</b><span>${esc(tok.symbol)}</span></div>`
          : `<div class="stat"><span>Curve reserve</span><b>${fu(st.quoteReserve, 18)}</b><span>WETH</span></div>`}
      </div>
      ${st.status === 3 ? `<div class="card t-grad"><span class="badge b-grad">Graduated</span><span class="muted">Liquidity now lives in a permanent Ammora pool, where this token trades.</span></div>` : `<div class="card">
        <div class="kv" style="font-size:14px"><span>Graduation progress</span><b>${(progress * 100).toFixed(2)}%</b></div>
        <div class="bar" style="margin:10px 0"><i style="width:${(progress * 100).toFixed(2)}%"></i></div>
        <div class="muted" style="font-size:13px">${st.status === 3 ? "This token graduated. Its liquidity now lives in a permanent Ammora pool." :
          `When ${fu(thr, 18)} WETH has been raised on the curve, it becomes ready to graduate into a permanent Ammora pool.`}</div>
      </div>`}
      <div class="card"><h3>Price</h3><div class="chart" id="chart"><div class="muted" style="padding:20px">Loading trades…</div></div></div>
      <div class="card"><h3 style="margin-bottom:8px">Recent trades</h3><div class="scroll" id="trades"><div class="muted">Loading…</div></div></div>
      <div class="card"><div class="hhead"><h3>Top holders</h3><span class="muted" id="hcount"></span></div><div id="holders"><div class="muted">Loading…</div></div></div>
      <div class="card" style="display:grid;gap:8px;font-size:13.5px">
        <div class="kv"><span>Token</span><a class="mono" href="${addrUrl(tok.address)}" target="_blank" rel="noopener">${short(tok.address)} ↗</a></div>
        <div class="kv"><span>Bonding curve</span><a class="mono" href="${addrUrl(curve)}" target="_blank" rel="noopener">${short(curve)} ↗</a></div>
        <div class="kv"><span>Creator</span><span><a class="mono" href="#/portfolio/${st.creator}" title="See this creator's launches and holdings">${short(st.creator)}</a> <a class="muted" href="${addrUrl(st.creator)}" target="_blank" rel="noopener" title="View on explorer">↗</a></span></div>
        ${st.canonicalPool && st.canonicalPool !== zeroAddress ? `<div class="kv"><span>Ammora pool</span><a class="mono" href="${addrUrl(st.canonicalPool)}" target="_blank" rel="noopener">${short(st.canonicalPool)} ↗</a></div>` : ""}
        <div class="kv"><span>Total supply</span><b>${fu(tok.supply, tok.decimals)}</b></div>
      </div>
    </div>
    <aside class="card trade" id="trade"></aside>
  </div>`;

  const shareTok = (title) => shareSheet({
    title,
    text: st.status === 3 ? `$${tok.symbol} graduated on ${SITE.name} ⚒️ Now trading in its Ammora pool on GIWA 👇`
      : `$${tok.symbol} is live on ${SITE.name} ⚒️ Trade it on the bonding curve on GIWA 👇`,
    url: pageUrl(`#/token/${curve}`),
  });
  $("#shareTok").onclick = () => shareTok(`Share $${tok.symbol}`);
  let just = null; try { just = sessionStorage.getItem("anvora.justLaunched"); } catch {}
  if (just && just.toLowerCase() === curve.toLowerCase()) {
    try { sessionStorage.removeItem("anvora.justLaunched"); } catch {}
    shareTok(`🎉 $${tok.symbol} is live! Share it`);
  }
  if (st.status === 1) tradeBox(ctx, curveEngine(ctx));
  else if (st.status === 2) migrateBox(ctx);
  else if (st.status === 3) tradeBox(ctx, poolEngine(ctx));
  else $("#trade").innerHTML = `<h3>Trading</h3><div class="muted">This curve is not active.</div>`;
  loadTrades(ctx, id);
  loadHolders(ctx, id);
}

// Top holders from the explorer. Contracts that hold supply by design (curve, pool) are labelled, and
// the creator is marked, so buyers can see how concentrated the supply really is.
async function loadHolders(ctx, id) {
  const box = () => $("#holders");
  const tokenAddr = ctx.tok.address;
  let items = [], count = null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000);
    const j = await fetch(`${EXPLORER}/api/v2/tokens/${tokenAddr}/holders`, { signal: ctl.signal }).then((r) => r.json()).finally(() => clearTimeout(t));
    items = (j.items || []).map((h) => ({ addr: h.address?.hash, contract: !!h.address?.is_contract, value: BigInt(h.value || 0) }));
    fetch(`${EXPLORER}/api/v2/tokens/${tokenAddr}/counters`).then((r) => r.json()).then((c) => {
      count = Number(c.token_holders_count); if (id === renderId && $("#hcount") && count) $("#hcount").textContent = `${fmt(count)} holders`;
    }).catch(() => {});
  } catch {
    try {
      const q = new URLSearchParams({ module: "token", action: "getTokenHolders", contractaddress: tokenAddr, page: "1", offset: "20" });
      const j = await fetch(`${EXPLORER}/api?${q}`).then((r) => r.json());
      items = (Array.isArray(j.result) ? j.result : []).map((h) => ({ addr: h.address, contract: false, value: BigInt(h.value || 0) }));
    } catch {}
  }
  if (id !== renderId || !box()) return;
  items = items.filter((h) => h.addr && h.value > 0n).sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0)).slice(0, 20);
  if (!items.length) { box().innerHTML = `<div class="muted">Holder data isn't available right now.</div>`; return; }
  const supply = ctx.tok.supply || items.reduce((a, h) => a + h.value, 0n);
  const lc = (a) => String(a || "").toLowerCase();
  const curve = lc(ctx.curve), pool = lc(ctx.st.canonicalPool), creator = lc(ctx.st.creator), me = lc(W.address);
  const tag = (h) => {
    const a = lc(h.addr);
    if (a === curve) return `<span class="htag">Bonding curve</span>`;
    if (a === pool) return `<span class="htag">Ammora pool</span>`;
    if (a === zeroAddress || a === "0x000000000000000000000000000000000000dead") return `<span class="htag">Burned</span>`;
    const parts = [];
    if (a === creator) parts.push(`<span class="htag hc">Creator</span>`);
    if (me && a === me) parts.push(`<span class="htag hy">You</span>`);
    if (!parts.length && h.contract) parts.push(`<span class="htag">Contract</span>`);
    return parts.join("");
  };
  box().innerHTML = `<div class="hlist">${items.map((h, i) => {
    const pct = Number((h.value * 1_000_000n) / (supply || 1n)) / 10_000;
    return `<div class="hrow"><span class="hn">${i + 1}</span>
      <span class="haddr"><a class="mono" href="${addrUrl(h.addr)}" target="_blank" rel="noopener">${short(h.addr)}</a>${tag(h)}</span>
      <span class="hbar"><i style="width:${Math.min(100, pct).toFixed(2)}%"></i></span>
      <b>${pct >= 0.01 ? pct.toFixed(2) : "<0.01"}%</b></div>`;
  }).join("")}</div>
  <div class="help" style="margin-top:8px">Share of total supply. The bonding curve and the Ammora pool hold the unsold tokens and liquidity; they are contracts, not people.</div>`;
}

async function loadTrades(ctx, id) {
  const get = async (address, topic0, event, events) => {
    try { return await explorerLogs({ address, topic0 }); }
    catch { try { return await rpcLogs({ address, event, events, windows: 3 }); } catch { return []; } }
  };
  const pool = ctx.st.canonicalPool && ctx.st.canonicalPool !== zeroAddress ? ctx.st.canonicalPool : null;
  const [logs, plogs] = await Promise.all([get(ctx.curve, SWAP_TOPIC, SWAP_EVENT), pool ? get(pool, null, null, POOL_SWAP_EVENTS) : []]);
  if (id !== renderId) return;
  const dec = ctx.tok.decimals;
  const trades = [];
  for (const l of logs) {
    try {
      const ev = decodeEventLog({ abi: A.ammoraLaunchPoolV4Abi, data: l.data, topics: l.topics.filter(Boolean) });
      if (ev.eventName !== "Swap") continue;
      const a = ev.args;
      trades.push({ sell: a.baseForQuote, weth: a.baseForQuote ? a.amountOut : a.amountIn, tokens: a.baseForQuote ? a.amountIn : a.amountOut,
        price: sqrtToPrice(a.nextSqrtPrice, dec), trader: a.recipient && a.recipient !== zeroAddress ? a.recipient : a.trader, tx: l.transactionHash, block: Number(l.blockNumber), time: l.timeStamp ? Number(l.timeStamp) : null });
    } catch {}
  }
  const tokenAddr = ctx.tok.address.toLowerCase();
  for (const l of plogs) {
    try {
      const ev = decodeEventLog({ abi: POOL_SWAP_EVENTS, data: l.data, topics: l.topics.filter(Boolean) });
      if (ev.eventName !== "Swap") continue;
      const a = ev.args, sell = a.tokenIn.toLowerCase() === tokenAddr;
      const weth = sell ? a.amountOut : a.amountIn, tokens = sell ? a.amountIn : a.amountOut;
      if (!tokens) continue;
      // Pool price: use the pool's sqrt price in whichever orientation matches the trade; fall back to the fill price.
      const eff = Number(formatUnits(weth, 18)) / Number(formatUnits(tokens, dec));
      const p = sqrtToPrice(a.sqrtPrice, dec), pInv = p ? 1 / sqrtToPrice(a.sqrtPrice, 18, dec) : 0;
      const near = (x) => x > 0 && x / eff < 3 && eff / x < 3;
      const price = near(p) ? p : near(pInv) ? pInv : eff;
      trades.push({ sell, weth, tokens, price, pool: true, trader: a.recipient && a.recipient !== zeroAddress ? a.recipient : a.sender,
        tx: l.transactionHash, block: Number(l.blockNumber), time: l.timeStamp ? Number(l.timeStamp) : null });
    } catch {}
  }
  trades.sort((a, b) => a.block - b.block);
  drawChart(trades);
  $("#trades").innerHTML = trades.length ? `<table class="trades"><thead><tr><th>Type</th><th class="r">WETH</th><th class="r">${esc(ctx.tok.symbol)}</th><th>Trader</th><th class="r">When</th></tr></thead><tbody>
    ${trades.slice(-40).reverse().map((t) => `<tr><td class="${t.sell ? "bad" : "good"}">${t.sell ? "Sell" : "Buy"}${t.pool ? ` <span class="pill pool" title="Traded in the Ammora pool after graduation">Pool</span>` : ""}</td><td class="r">${fu(t.weth, 18)}</td><td class="r">${fu(t.tokens, dec)}</td>
      <td><a class="mono" href="${addrUrl(t.trader)}" target="_blank" rel="noopener">${short(t.trader)}</a></td><td class="r"><a href="${txUrl(t.tx)}" target="_blank" rel="noopener">${t.time ? ago(t.time) : "#" + t.block}</a></td></tr>`).join("")}
    </tbody></table>` : `<div class="muted">No trades yet.</div>`;
}
function drawChart(trades) {
  const box = $("#chart");
  lastChart = trades;
  if (!box) return;
  // Chart colours follow the active palette and theme.
  const css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
  const C = { grid: v("--grid"), text: v("--mute"), line: v(isDark() ? "--fire" : "--link"), fill: v("--fire") };
  if (trades.length < 2) { box.innerHTML = `<div class="muted" style="padding:20px">The chart appears after a couple of trades.</div>`; return; }
  const W_ = box.clientWidth || 600, H = box.clientHeight || 220;
  const L_ = 8, R = 8, T = 22, B = 26;
  const timed = trades.every((t) => t.time);
  const xs = trades.map((t, i) => (timed ? t.time : i));
  const x0 = xs[0], x1 = xs.at(-1), xspan = x1 - x0 || 1;
  const ps = trades.map((t) => t.price), lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || hi || 1;
  const X = (v) => L_ + ((v - x0) / xspan) * (W_ - L_ - R);
  const Y = (p) => H - B - ((p - lo) / span) * (H - T - B);
  // Step line: the price holds until the next trade.
  let d = `M${X(xs[0]).toFixed(1)},${Y(ps[0]).toFixed(1)}`;
  for (let i = 1; i < ps.length; i++) d += `H${X(xs[i]).toFixed(1)}V${Y(ps[i]).toFixed(1)}`;
  const ticks = [];
  if (timed) {
    const longSpan = xspan > 2 * 86400;
    const label = (t) => new Date(t * 1000).toLocaleString("en-US", longSpan ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit", hour12: false });
    const n = W_ < 420 ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const t = x0 + (xspan * i) / (n - 1);
      const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle";
      ticks.push(`<line x1="${X(t)}" x2="${X(t)}" y1="${T}" y2="${H - B}" stroke="${C.grid}"/><text x="${X(t)}" y="${H - 8}" text-anchor="${anchor}" fill="${C.text}" font-size="11">${label(t)}</text>`);
    }
  }
  box.innerHTML = `<svg viewBox="0 0 ${W_} ${H}" preserveAspectRatio="none"><defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.fill}" stop-opacity=".28"/><stop offset="1" stop-color="${C.fill}" stop-opacity="0"/></linearGradient></defs>
    ${ticks.join("")}
    <path d="${d}V${H - B}H${X(xs[0])}Z" fill="url(#cg)"/><path d="${d}" fill="none" stroke="${C.line}" stroke-width="2"/>
    <text x="${W_ - R}" y="14" text-anchor="end" fill="${C.text}" font-size="11">high ${fmt(hi, 4)} ETH</text>
    <text x="${L_}" y="14" fill="${C.text}" font-size="11">low ${fmt(lo, 4)} ETH · ${trades.length} trades</text></svg>`;
}

// Pre-graduation: the Ammora ALC bonding curve.
function curveEngine(ctx) {
  const { cc } = ctx;
  const quote = async (side, amt) => {
    const sell = side === "sell";
    const q = await cc.quoteExactInputAtBlock(amt, sell, await pc.getBlockNumber());
    const fill = A.classifyAmmoraV4ExactInputFill(q, sell);
    let note = "";
    if (fill.kind === "graduation-boundary") note = `<div class="alert info">This buy completes the bonding curve. Only part of your WETH is used; the rest stays in your wallet. Afterwards anyone can graduate the token.</div>`;
    else if (fill.kind !== "full") throw new Error("This order cannot be filled in full on the curve. Try a smaller amount.");
    return { amountOut: q.amountOut, fee: q.fee, note };
  };
  const steps = async (side, amt, slip) => {
    const sell = side === "sell";
    const q = await cc.quoteExactInputAtBlock(amt, sell, await pc.getBlockNumber());
    const fill = A.classifyAmmoraV4ExactInputFill(q, sell);
    if (fill.kind !== "full" && fill.kind !== "graduation-boundary") throw new Error(`Order not executable (${fill.kind}).`);
    if (sell && fill.kind !== "full") throw new Error("Partial sells are not allowed. Try a smaller amount.");
    const args = () => ({ includedAmountIn: amt, baseForQuote: sell, allowPartialFill: fill.allowPartialFill, slippageBps: slip, recipient: W.address, deadline: nowSec() + 1200n });
    const plan = await cc.planSwapExactInput(args());
    const s = await prepSteps({ approvals: plan.approvalRequirements, wethNeeded: sell ? 0n : amt });
    s.push({ label: `${sell ? "Sell" : "Buy"} $${ctx.tok.symbol} on the curve`, run: async () => sendTx((await cc.planSwapExactInput(args())).transaction, sell ? "Sell" : "Buy") });
    return s;
  };
  return { title: "Trade on the bonding curve", quote, steps, feeToken: "WETH" };
}

// Post-graduation: the token's canonical Ammora pool, through AmmoraSwapClient.
function poolEngine(ctx) {
  const model = ctx.cfg?.config?.migrationMode === 1 ? "compounding" : "concentrated";
  const pool = ctx.st.canonicalPool;
  const prepare = async (side, amt, slip) => (await swapClient()).prepareExactIn({
    model, pool, tokenIn: side === "buy" ? WETH : ctx.st.baseToken, inputAsset: "erc20", amountIn: amt,
    payer: W.address || ctx.st.creator, recipient: W.address || ctx.st.creator, slippageBps: slip, executionMode: "direct-wallet",
  });
  const quote = async (side, amt, slip) => {
    const q = (await prepare(side, amt, slip)).quote;
    const impact = q.priceImpactBps != null ? Number(q.priceImpactBps) / 100 : null;
    return { amountOut: q.expectedAmountOut, fee: q.feeAmount ?? 0n, note: impact != null && impact > 5 ? `<div class="alert warn">High price impact: ${impact.toFixed(2)}%</div>` : "" };
  };
  const steps = async (side, amt, slip) => {
    const p = await prepare(side, amt, slip);
    if (p.quote.remainderAmountIn && p.quote.remainderAmountIn > 0n) throw new Error("The pool cannot fill this amount. Try a smaller trade.");
    const s = await prepSteps({ approvals: p.approvalRequirements, wethNeeded: side === "buy" ? amt : 0n });
    s.push({ label: `${side === "buy" ? "Buy" : "Sell"} $${ctx.tok.symbol} in the Ammora pool`, run: async () => {
      const t = (await prepare(side, amt, slip)).transaction;
      return sendTx({ to: t.to, data: t.data, value: t.value ?? 0n }, "Swap");
    } });
    return s;
  };
  return { title: `Trade in the ${model} Ammora pool`, quote, steps };
}

function tradeBox(ctx, eng) {
  const prefill = sessionStorage.getItem("anvora.prefillBuy") || "";
  sessionStorage.removeItem("anvora.prefillBuy");
  const t = { side: "buy", slip: SITE.defaultSlippageBps };
  $("#trade").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3 style="min-width:0">${esc(eng.title)}</h3><a href="#/swap/${ctx.curve}" style="font-size:13px;white-space:nowrap;flex-shrink:0">Open in Swap</a></div>
    <div class="seg trade" id="side"><button class="on buy" data-s="buy">Buy</button><button class="sell" data-s="sell">Sell</button></div>
    <div><label class="l" id="amtl">You pay (ETH)</label><input class="inp" id="amt" inputmode="decimal" placeholder="0.0" value="${esc(prefill)}" />
      <div class="help" id="bal">&nbsp;</div><div style="display:flex;gap:6px;margin-top:8px" id="quick"></div></div>
    <div><label class="l">Slippage</label><div class="seg" id="slip">${[50, 100, 300, 500].map((b) => `<button data-b="${b}" class="${b === t.slip ? "on" : ""}">${b / 100}%</button>`).join("")}</div></div>
    <div class="out" id="q"><span class="muted">Enter an amount to see a live quote.</span></div>
    <button class="btn pri block" id="go" data-wl="Buy">${W.address ? "Buy" : "Connect wallet"}</button>
    <div class="help">Buys are paid in WETH. Missing WETH is wrapped from your ETH automatically, and approvals are for the exact amount only.</div>`;
  const dec = () => (t.side === "buy" ? 18 : ctx.tok.decimals);
  let bals = null;
  const loadBals = async () => {
    if (!W.address) { $("#bal").textContent = ""; return; }
    try {
      const [eth, weth, tk] = await Promise.all([pc.getBalance({ address: W.address }), balanceOf(WETH, W.address), balanceOf(ctx.tok.address, W.address)]);
      bals = { eth, weth, tk };
      showBal();
    } catch {}
  };
  const showBal = () => {
    if (!bals) return;
    $("#bal").innerHTML = t.side === "buy" ? `Balance: ${fu(bals.eth, 18)} ETH + ${fu(bals.weth, 18)} WETH` : `Balance: ${fu(bals.tk, ctx.tok.decimals)} ${esc(ctx.tok.symbol)}`;
    $("#quick").innerHTML = t.side === "buy" ? ["0.001", "0.005", "0.01", "0.1"].map((v) => `<button class="btn sm" data-v="${v}">${v}</button>`).join("") + `<button class="btn sm" data-max="1" title="All your WETH and ETH, minus a little ETH for gas">Max</button>`
      : [25, 50, 100].map((p) => `<button class="btn sm" data-p="${p}">${p}%</button>`).join("");
  };
  $("#quick").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) $("#amt").value = b.dataset.v;
    else if (b.dataset.max) { if (bals) $("#amt").value = formatUnits(maxBuy(bals), 18); }
    else if (bals) $("#amt").value = formatUnits(bals.tk * BigInt(b.dataset.p) / 100n, ctx.tok.decimals);
    requote();
  };
  const amount = () => { const v = $("#amt").value.trim(); if (!v) return 0n; try { return parseUnits(v, dec()); } catch { return -1n; } };
  let qn = 0, timer;
  const requote = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const n = ++qn, amt = amount();
      if (amt === 0n) { $("#q").innerHTML = `<span class="muted">Enter an amount to see a live quote.</span>`; return; }
      if (amt < 0n) { $("#q").innerHTML = `<span class="bad">Invalid amount.</span>`; return; }
      $("#q").innerHTML = `<span class="muted">Quoting…</span>`;
      try {
        const q = await eng.quote(t.side, amt, t.slip);
        if (n !== qn) return;
        const outDec = t.side === "buy" ? ctx.tok.decimals : 18, outSym = t.side === "buy" ? ctx.tok.symbol : "WETH";
        const min = q.amountOut * BigInt(10_000 - t.slip) / 10_000n;
        $("#q").innerHTML = `<div class="kv"><span>You receive</span><b>${fu(q.amountOut, outDec, 6)} ${esc(outSym)}</b></div>
          <div class="kv"><span>Minimum (after slippage)</span><b>${fu(min, outDec, 6)}</b></div>
          <div class="kv"><span>Trading fee</span><b>${fu(q.fee, 18, 4)} WETH</b></div>${q.note}`;
      } catch (e) { if (n === qn) $("#q").innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
    }, 350);
  };
  $("#side").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    t.side = b.dataset.s;
    $("#side").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    $("#amtl").textContent = t.side === "buy" ? "You pay (ETH)" : `You sell (${ctx.tok.symbol})`;
    $("#go").dataset.wl = t.side === "buy" ? "Buy" : "Sell";
    if (W.address) $("#go").textContent = $("#go").dataset.wl;
    $("#amt").value = ""; showBal(); requote();
  };
  $("#slip").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; t.slip = Number(b.dataset.b); $("#slip").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); requote(); };
  $("#amt").oninput = requote;
  $("#go").onclick = async () => {
    const go = $("#go");
    try {
      await ensureWallet();
      const amt = amount();
      if (amt <= 0n) throw new Error("Enter an amount.");
      go.disabled = true;
      await runSteps(t.side === "buy" ? `Buying $${ctx.tok.symbol}` : `Selling $${ctx.tok.symbol}`, await eng.steps(t.side, amt, t.slip));
      toast(`Trade complete.`, "ok");
      render();
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err", 9000); }
    finally { go.disabled = false; }
  };
  loadBals();
  if (prefill) requote();
}

function migrateBox(ctx) {
  $("#trade").innerHTML = `<h3>Ready to graduate</h3>
    <div class="alert info" style="margin:0">The bonding curve is full. One permissionless transaction moves its liquidity into a permanent Ammora pool, where trading continues.</div>
    <button class="btn pri block" id="mig" data-wl="Graduate to Ammora pool">${W.address ? "Graduate to Ammora pool" : "Connect wallet to graduate"}</button>
    <div class="help">Costs gas only. The SDK checks that the curve is authentic and ready before building the transaction.</div>`;
  $("#mig").onclick = async () => {
    try {
      await ensureWallet();
      $("#mig").disabled = true;
      await runSteps("Graduating", [{ label: "Migrate curve → Ammora pool", run: async () => sendTx((await ctx.cc.planMigrateAtBlock(await pc.getBlockNumber())).transaction, "Graduation") }]);
      launchCache.at = 0;
      render();
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err", 9000); $("#mig").disabled = false; }
  };
}

/* ───────────── view: create ───────────── */
// Ammora V4 limits metadataURI to 2048 bytes; metadata is a plain JSON data: URI (image included).
const META_LIMIT = 2048;
const utf8Bytes = (s) => new TextEncoder().encode(s).length;
const toJsonUri = (o) => "data:application/json," + JSON.stringify(o).replace(/[%#\u0000-\u001f\u007f-\u{10ffff}]/gu, (c) => encodeURIComponent(c));
const IMG_STEPS = [[96, 0.6], [80, 0.6], [64, 0.6], [56, 0.5], [48, 0.5], [40, 0.5], [32, 0.5]];
function encodeImage(bmp, size, q) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, size, size);
  const k = Math.max(size / bmp.width, size / bmp.height);
  g.drawImage(bmp, (size - bmp.width * k) / 2, (size - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  const webp = c.toDataURL("image/webp", q);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/jpeg", q);
}
function buildMeta(base, bmp) {
  const meta = JSON.parse(JSON.stringify(base));
  const plain = toJsonUri(meta);
  if (utf8Bytes(plain) > META_LIMIT) throw new Error(`Too much text for the on-chain metadata limit (${utf8Bytes(plain)} / ${META_LIMIT} bytes).`);
  if (!bmp) return { uri: plain, meta };
  for (const [size, q] of IMG_STEPS) {
    const image = encodeImage(bmp, size, q);
    const uri = toJsonUri({ ...meta, image });
    if (utf8Bytes(uri) <= META_LIMIT) return { uri, meta: { ...meta, image }, image, size };
  }
  return { uri: plain, meta, tooBig: true };
}

async function viewCreate(id, arg) {
  // #/create/<configId> launches with a specific Config (e.g. a one-off official launch); default is the site's Config.
  const cid = arg && /^\d+$/.test(arg) ? BigInt(arg) : launchConfigId();
  if (cid === null) {
    app.innerHTML = `<div class="form card"><h2>Launching is not set up yet</h2>
      <p class="muted">This launchpad needs its own Ammora launch Config first. The site owner creates it once on the setup page (gas only), then every token launched here uses it.</p>
      <a class="btn pri" href="#/setup">Open owner setup</a></div>`;
    return;
  }
  app.innerHTML = `
  <div class="form">
    <div><h1 style="font-size:40px">Launch a token</h1><p class="muted" style="margin:10px 0 0">One transaction creates an ERC-20 token and its Ammora bonding curve. Name, ticker, description, links and image are stored on-chain.</p></div>
    <div class="card cfg" id="cfg"><div class="muted">Reading launch Config #${cid}…</div></div>
    <div class="card fgrid">
      <div><label class="l" for="name">Name</label><input class="inp" id="name" maxlength="40" placeholder="Spark Cat" /></div>
      <div><label class="l" for="sym">Ticker</label><input class="inp" id="sym" maxlength="12" placeholder="ICAT" /></div>
      <div class="full"><label class="l" for="desc">Description</label><textarea class="inp" id="desc" maxlength="280" placeholder="What is this token about? Keep it short; it is stored on-chain."></textarea></div>
      <div class="full"><label class="l" for="file">Image</label><div class="imgpick"><div id="prev" class="avatar lg">?</div><input type="file" id="file" class="inp" accept="image/png,image/jpeg,image/webp,image/gif" /></div>
        <div class="help" id="mhelp">The image is compressed to fit Ammora's 2 KB on-chain metadata limit.</div></div>
      <div><label class="l" for="web">Website</label><input class="inp" id="web" placeholder="https://" /></div>
      <div><label class="l" for="tw">X / Twitter</label><input class="inp" id="tw" placeholder="https://x.com/…" /></div>
      <div><label class="l" for="tg">Telegram</label><input class="inp" id="tg" placeholder="https://t.me/…" /></div>
      <div><label class="l" for="first">First buy in ETH (optional)</label><input class="inp" id="first" inputmode="decimal" placeholder="0.001" /><div class="help" id="firsthelp">Bought in the same transaction as the launch, so no bot can buy before you.</div></div>
    </div>
    <div id="cmsg"></div>
    <button class="btn pri block" id="launch" data-wl="Launch token">${W.address ? "Launch token" : "Connect wallet & launch"}</button>
    <div class="help" style="text-align:center">You become the token's creator and earn the creator share of curve trading fees set by the Config.</div>
  </div>`;

  let cfg = null, bmp = null, fitted = null;
  try {
    cfg = await A.getAmmoraV4ConfigAtBlock(pc, L.configRegistry, cid, await pc.getBlockNumber());
    if (id !== renderId) return;
    const c = cfg.config;
    $("#cfg").innerHTML = `
      <div><span class="muted">Launch Config</span> <b>#${cid}</b> ${cfg.enabled ? `<span class="good">enabled</span>` : `<span class="bad">disabled</span>`}</div>
      <div><span class="muted">Creation fee</span> <b>${formatUnits(c.poolCreationFee, 18)} ETH</b></div>
      <div><span class="muted">Total supply</span> <b>${fu(c.totalSupply, c.tokenDecimals)}</b></div>
      <div><span class="muted">Graduates at</span> <b>${fu(c.migrationQuoteThreshold, 18)} WETH</b></div>
      <div><span class="muted">Curve fee</span> <b>${(Number(c.cliffFeeBps) / 100).toFixed(2)}%</b></div>
      <div><span class="muted">Creator fee share</span> <b>${(Number(c.creatorShareOfNonProtocolBps) / 100).toFixed(0)}%</b></div>`;
    if (!atomicEligible(c)) $("#firsthelp").textContent = "This Config can't bundle a first buy into the launch; it is prefilled on the token page right after.";
    if (!cfg.enabled) $("#cmsg").innerHTML = `<div class="alert err">Config #${cid} is disabled. The site owner should create a new one on the setup page.</div>`;
  } catch (e) { if (id === renderId) $("#cfg").innerHTML = `<div class="alert err" style="grid-column:1/-1">Could not read Config #${cid}: ${esc(errText(e))}</div>`; }

  const base = () => ({
    name: $("#name").value.trim(), symbol: $("#sym").value.trim().toUpperCase(), description: $("#desc").value.trim() || undefined,
    website: safeUrl($("#web").value.trim()) || undefined, twitter: safeUrl($("#tw").value.trim()) || undefined, telegram: safeUrl($("#tg").value.trim()) || undefined,
    launchpad: SITE.name,
  });
  let ft;
  const refit = () => {
    clearTimeout(ft);
    ft = setTimeout(() => {
      try {
        fitted = buildMeta(base(), bmp);
        $("#prev").outerHTML = fitted.image ? `<img id="prev" class="avatar lg" src="${esc(fitted.image)}" alt="">` : `<div id="prev" class="avatar lg">?</div>`;
        $("#mhelp").innerHTML = fitted.tooBig ? `<span class="bad">The image does not fit next to this much text. Shorten the description or links.</span>`
          : `On-chain metadata: <b>${utf8Bytes(fitted.uri)} / ${META_LIMIT} bytes</b>${fitted.size ? ` · image ${fitted.size}px` : ""}`;
      } catch (e) { fitted = null; $("#mhelp").innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
    }, 250);
  };
  ["#name", "#sym", "#desc", "#web", "#tw", "#tg"].forEach((s) => ($(s).oninput = refit));
  $("#file").onchange = async (e) => {
    const f = e.target.files?.[0];
    bmp = null;
    if (f) { try { bmp = await createImageBitmap(f); } catch { toast("Could not read that image.", "err"); } }
    refit();
  };

  $("#launch").onclick = async () => {
    const name = $("#name").value.trim(), symbol = $("#sym").value.trim().toUpperCase();
    const btn = $("#launch");
    try {
      if (!name || !symbol) throw new Error("Name and ticker are required.");
      if (!/^[A-Z0-9$_.-]{1,12}$/.test(symbol)) throw new Error("Ticker: 1–12 letters or numbers.");
      const firstStr = $("#first").value.trim();
      const firstBuy = firstStr ? parseUnits(firstStr, 18) : 0n;
      await ensureWallet();
      if (!cfg?.enabled) throw new Error("The launch Config is not available.");
      const built = buildMeta({ ...base(), name, symbol }, bmp);
      if (built.tooBig) throw new Error("The image does not fit next to this much text. Shorten the description or remove the image.");
      btn.disabled = true;
      let created;
      const record = (receipt) => {
        created = A.parseAmmoraV4LaunchCreatedReceipt(receipt, L.factory);
        if (created.configId !== cid || created.configHash !== cfg.configHash) throw new Error("Launch receipt does not match the selected Config.");
        const rec = { token: created.token, curve: created.curve, creator: W.address, configId: cid, configHash: cfg.configHash, metadataURI: built.uri, block: Number(receipt.blockNumber), time: Math.floor(Date.now() / 1000), tx: receipt.transactionHash };
        store.set("anvora.created", [rec, ...store.get("anvora.created", []).filter((x) => x.curve !== rec.curve)].slice(0, 100));
        launchCache.at = 0;
      };
      const launchArgs = () => ({ name, symbol, metadataURI: built.uri, creatorMetadataURI: built.uri, tokenDecimals: cfg.config.tokenDecimals });
      const steps = [{ label: "Verify Ammora contracts & Config", run: async () => {
        const bn = await pc.getBlockNumber();
        await A.verifyAmmoraV4CoreAtBlock(pc, CORE, bn);
        cfg = await A.getAmmoraV4ConfigAtBlock(pc, L.configRegistry, cid, bn);
        if (!cfg.enabled) throw new Error(`Config #${cid} is disabled.`);
        if ((await pc.getBalance({ address: W.address })) < cfg.config.poolCreationFee + firstBuy) throw new Error("Not enough ETH for the creation fee, first buy and gas.");
      } }];
      const atomic = firstBuy > 0n && atomicEligible(cfg.config);
      if (atomic) {
        // Launch + first buy in one transaction through Ammora's first-buy executor: nobody can buy before the creator.
        const planAtomic = async () => {
          const bn = await pc.getBlockNumber();
          const dctx = await A.verifyAmmoraPortableDeploymentAtBlock(pc, A.giwaSepoliaAtomicLaunchDeployment, bn);
          const q = curveBuyQuote(cfg.config, cfg.segments, firstBuy);
          if (q.unfilled > 0n || q.amountOut <= 0n) throw new Error("The first buy is larger than the bonding curve allows. Use a smaller amount.");
          const fees = await pc.estimateFeesPerGas();
          return new A.AmmoraPortableLifecyclePlanner(dctx, A.giwaSepoliaAtomicLaunchTargets).planExistingConfigAtomicFirstBuy({
            account: W.address, configId: cid, expectedConfigHash: cfg.configHash, launch: launchArgs(),
            firstBuys: [{ includedQuoteAmountRaw: firstBuy, minimumBaseAmountOutRaw: q.amountOut * 99n / 100n, allowPartialFill: false, recipient: W.address }],
            deadline: nowSec() + 1800n, allowancePolicy: "prepare-approval",
            gas: { maxFeePerGasNativeRaw: (fees.maxFeePerGas ?? fees.gasPrice ?? 1_000_000n) * 2n, safetyMarginBps: 2000n },
          });
        };
        steps.push(
          { label: "Prepare WETH for the first buy", run: async () => {
            const wbal = await balanceOf(WETH, W.address);
            if (wbal < firstBuy) return sendTx(wrapTx(firstBuy - wbal), "Wrap ETH");
          } },
          { label: "Approve the first buy (exact amount)", run: async () => {
            await waitFor(async () => (await balanceOf(WETH, W.address)) >= firstBuy, "Your wrapped WETH is not visible yet. Wait a few seconds and try again.");
            const plan = await retryLag(planAtomic);
            if (plan.status !== "APPROVAL_REQUIRED") return;
            const a = plan.approvalRequirements?.[0];
            if (!a || a.token.toLowerCase() !== WETH.toLowerCase() || a.exactAmountRaw !== firstBuy) throw new Error("Unexpected approval request from the planner.");
            return sendTx(plan.transaction, "Approval");
          } },
          { label: `Create $${symbol} + first buy in one transaction`, run: async () => {
            let plan;
            for (let i = 0; i < 6; i++) { plan = await retryLag(planAtomic); if (plan.status === "READY") break; await sleep(2500); }
            if (plan.status !== "READY") throw new Error("The approval is not visible yet. Wait a few seconds and try again.");
            if (plan.transaction.to.toLowerCase() !== L.factory.toLowerCase()) throw new Error("Unexpected launch target.");
            record(await sendTx({ to: plan.transaction.to, data: plan.transaction.data, value: plan.transaction.value ?? 0n }, "Launch + first buy"));
          } },
        );
      } else {
        steps.push({ label: `Create $${symbol} + bonding curve`, run: async () => {
          const tx = A.buildCreateAmmoraV4Launch(launchArgs(), cid, cfg.config.poolCreationFee);
          record(await sendTx({ to: L.factory, data: tx.data, value: tx.value ?? 0n }, "Token launch"));
        } });
      }
      await runSteps(`Launching ${name}`, steps);
      if (firstBuy > 0n && !atomic) sessionStorage.setItem("anvora.prefillBuy", firstStr);
      toast(`$${esc(symbol)} is live!${atomic ? " Your first buy is in." : firstBuy > 0n ? " Confirm your first buy on the token page." : ""}`, "ok", 9000);
      try { sessionStorage.setItem("anvora.justLaunched", created.curve); } catch {}
      location.hash = `#/token/${created.curve}`;
    } catch (e) { if (!e.shown) $("#cmsg").innerHTML = `<div class="alert err">${esc(errText(e))}</div>`; }
    finally { btn.disabled = false; }
  };
}

// A first buy can be bundled into the launch only on Configs without time- or volume-dependent fees.
function atomicEligible(c) {
  return !!c && !c.dynamicFeeEnabled && !c.rateLimiterEnabled && !c.enableFirstSwapWithMinFee
    && Number(c.collectFeeMode) === 0 && Number(c.activationDelay) === 0;
}
// Quote a buy on a brand-new curve straight from the Config's segments (no curve exists yet).
function curveBuyQuote(config, segments, amountIn) {
  const Q2 = 1n << 128n;
  const fee = amountIn * BigInt(config.cliffFeeBps) / 10_000n;
  let rem = amountIn - fee, out = 0n, sp = config.startSqrtPrice;
  for (const seg of segments || []) {
    if (rem <= 0n) break;
    if (sp >= seg.upperSqrtPrice) continue;
    if (sp < seg.lowerSqrtPrice) sp = seg.lowerSqrtPrice;
    const Lq = seg.liquidity;
    const maxIn = Lq * (seg.upperSqrtPrice - sp) / Q2;
    let s1;
    if (rem >= maxIn) { s1 = seg.upperSqrtPrice; rem -= maxIn; } else { s1 = sp + rem * Q2 / Lq; rem = 0n; }
    out += Lq * (s1 - sp) / (sp * s1);
    sp = s1;
  }
  return { amountOut: out, fee, unfilled: rem };
}

/* ───────────── view: portfolio ───────────── */
// A wallet's whole picture: a one-line summary on top, details in tabs (Holdings · Earnings · Launches · Activity).
const PTABS = [["hold", "Holdings"], ["earn", "Earnings"], ["launch", "Launches"], ["act", "Activity"]];
let ptab = "hold";
let psum = null; // summary values filled in as each part loads
const poolPriceAbi = [{ type: "function", name: "sqrtPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] }];

async function viewPortfolio(id, arg) {
  // #/portfolio/<address> shows any wallet read-only (handy for sharing); otherwise the connected wallet.
  const other = arg && isAddress(arg) && (!W.address || getAddress(arg) !== getAddress(W.address)) ? getAddress(arg) : null;
  if (!W.address && !other) { app.innerHTML = `<div class="empty"><h2 style="margin-bottom:12px">Your portfolio</h2>Connect your wallet to see your holdings, earnings, launches and trades.<br><button class="btn pri" id="pc" style="margin-top:14px">Connect wallet</button></div>`; $("#pc").onclick = () => ensureWallet().catch((e) => toast(esc(errText(e)), "err")); return; }
  const me = other || getAddress(W.address);
  psum = { hold: null, fees: null, vault: null, lp: null, launched: null, trades: null };
  const item = (k, label) => `<button class="psum-i" data-go="${k === "fees" ? "earn" : k === "launched" ? "launch" : k === "trades" ? "act" : "hold"}"><span>${label}</span><b id="ps-${k}"><i class="dots">…</i></b></button>`;
  app.innerHTML = `<div class="phead"><h1>${other ? "Portfolio" : "Your portfolio"}</h1><a class="mono muted" href="${addrUrl(me)}" target="_blank" rel="noopener">${short(me)} ${ICON_OUT}</a></div>
    <div class="psum">${item("hold", "Holdings")}${item("fees", "To claim")}${item("launched", "Launched")}${item("trades", "Trades")}</div>
    <div class="ptabs" id="ptabs" role="tablist">${PTABS.map(([k, n]) => `<button data-t="${k}" role="tab" class="${k === ptab ? "on" : ""}">${n}<em id="pc-${k}"></em></button>`).join("")}</div>
    <div class="ppanel" data-p="hold"><div class="pwallet muted" id="pwallet"></div><div id="phold"><div class="skel" style="height:120px"></div></div></div>
    <div class="ppanel" data-p="earn">
      <div class="earn-grid"><div class="earn-box" id="evault"><div class="skel" style="height:96px"></div></div><div class="earn-box" id="elp"><div class="skel" style="height:96px"></div></div></div></div>
    <div class="ppanel" data-p="launch"><div id="plaunch"><div class="skel" style="height:80px"></div></div></div>
    <div class="ppanel" data-p="act"><div id="pact"><div class="skel" style="height:120px"></div></div></div>`;
  const show = (t) => {
    ptab = t;
    $$a(".ptabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    $$a(".ppanel").forEach((p) => (p.hidden = p.dataset.p !== t));
  };
  $("#ptabs").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.t); };
  $$a(".psum-i").forEach((b) => (b.onclick = () => { show(b.dataset.go); $("#ptabs").scrollIntoView({ behavior: "smooth", block: "nearest" }); }));
  show(ptab);

  loadEarnings(id, me);
  let list = [];
  try { list = await loadLaunches(); } catch (e) { if (id === renderId) $("#phold").innerHTML = `<div class="muted">${esc(errText(e))}</div>`; }
  if (id !== renderId) return;
  portfolioHoldings(id, me, list);
  portfolioLaunches(id, me, list);
  portfolioActivity(id, me, list);
}
const $$a = (q) => [...document.querySelectorAll(q)];
function psumSet(k, html, count) {
  const el = $(`#ps-${k}`); if (el) el.innerHTML = html;
  if (count !== undefined) { const c = $(`#pc-${{ hold: "hold", launched: "launch", trades: "act", fees: "earn" }[k]}`); if (c) c.textContent = count ? String(count) : ""; }
}
function psumFees() {
  if (!psum || psum.vault === null || psum.lp === null) return;
  const t = psum.vault + psum.lp;
  psumSet("fees", t > 0n ? `${fu(t, 18, 4)} <small>WETH</small>` : `0 <small>WETH</small>`, (psum.cv || 0) + (psum.cl || 0));
  const s = $(".psum-i[data-go=earn]"); if (s) s.classList.toggle("hot", t > 0n);
}

async function portfolioHoldings(id, me, list) {
  try {
    const res = [];
    for (let i = 0; i < list.length; i += 250) res.push(...await pc.multicall({ contracts: list.slice(i, i + 250).map((x) => ({ address: x.token, abi: erc20Abi, functionName: "balanceOf", args: [me] })), allowFailure: true }));
    const [eth, weth] = await Promise.all([pc.getBalance({ address: me }), balanceOf(WETH, me)]);
    const held = list.map((x, i) => ({ x, bal: res[i]?.status === "success" ? res[i].result : 0n })).filter((h) => h.bal > 0n);
    // Graduated tokens are priced by their Ammora pool; live ones by their curve.
    const grads = held.filter((h) => h.x.status === 3 && h.x.pool && h.x.pool !== zeroAddress);
    if (grads.length) {
      const pr = await pc.multicall({ contracts: grads.map((h) => ({ address: h.x.pool, abi: poolPriceAbi, functionName: "sqrtPrice" })), allowFailure: true });
      grads.forEach((h, i) => {
        if (pr[i]?.status !== "success") return;
        const p = sqrtToPrice(pr[i].result, h.x.decimals), inv = 1 / sqrtToPrice(pr[i].result, 18, h.x.decimals), ref = h.x.price || p;
        const dist = (v) => (v > 0 && Number.isFinite(v) ? Math.abs(Math.log(v / ref)) : Infinity);
        h.poolPrice = dist(p) <= dist(inv) ? p : inv;
      });
    }
    held.forEach((h) => { h.price = h.poolPrice ?? h.x.price ?? 0; h.amount = Number(formatUnits(h.bal, h.x.decimals)); h.value = h.x.junk ? 0 : h.amount * h.price; });
    held.sort((a, b) => b.value - a.value);
    if (id !== renderId) return;
    const total = held.reduce((a, h) => a + h.value, 0);
    psumSet("hold", `${fmt(total)} <small>ETH</small>`, held.length);
    $("#pwallet").innerHTML = `Wallet <b>${fu(eth, 18, 5)}</b> ETH · <b>${fu(weth, 18, 5)}</b> WETH${weth > 0n ? ` · <a href="#/swap/weth">Unwrap</a>` : ""}`;
    $("#phold").innerHTML = held.length ? `<div class="plist2">${held.map((h) => `
      <a class="prow2" href="#/token/${h.x.curve}">${avatar(h.x, "sm")}
        <div class="pr-main"><b>${esc(h.x.name || "Unnamed")}${verTag(h.x.curve, h.x.token)}</b><span class="muted">${fmt(h.amount)} $${esc(h.x.symbol || "?")}</span></div>
        <div class="pr-side"><b>${h.value ? fmt(h.value) + " ETH" : "—"}</b>${statusBadge(h.x.status)}</div></a>`).join("")}</div>`
      : `<div class="pempty">You don't hold any launch tokens yet. <a href="#/">Explore launches</a></div>`;
  } catch (e) { if (id === renderId) { $("#phold").innerHTML = `<div class="muted">Holdings could not be read right now. ${esc(errText(e))}</div>`; psumSet("hold", "—"); } }
}

function portfolioLaunches(id, me, list) {
  const mine = list.filter((x) => x.creator.toLowerCase() === me.toLowerCase());
  psumSet("launched", String(mine.length), mine.length);
  $("#plaunch").innerHTML = mine.length ? `<div class="plist2">${mine.map((x) => `
    <a class="prow2" href="#/token/${x.curve}">${avatar(x, "sm")}
      <div class="pr-main"><b>${esc(x.name || "Unnamed")}${verTag(x.curve, x.token)}</b><span class="muted">$${esc(x.symbol || "?")} · ${x.time ? ago(x.time) : "block " + x.block}</span></div>
      <div class="pr-side"><b>${fmt(x.raised)} WETH</b>${x.status === 1 ? `<span class="muted" style="font-size:12px">${(x.progress * 100).toFixed(1)}% to graduation</span>` : statusBadge(x.status)}</div></a>`).join("")}</div>`
    : `<div class="pempty">You haven't launched a token yet. <a href="#/create">Launch one</a></div>`;
}

// Activity: the wallet's token transfers from the explorer, grouped per transaction into buys and sells.
async function portfolioActivity(id, me, list) {
  try {
    const byToken = new Map(list.map((x) => [x.token.toLowerCase(), x]));
    const q = new URLSearchParams({ module: "account", action: "tokentx", address: me, sort: "desc", page: "1", offset: "1000" });
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25_000);
    const j = await fetch(`${EXPLORER}/api?${q}`, { signal: ctl.signal }).then((r) => r.json()).finally(() => clearTimeout(t));
    const me_ = me.toLowerCase(), weth = WETH.toLowerCase();
    const txs = new Map();
    for (const r of Array.isArray(j.result) ? j.result : []) {
      const k = r.hash; if (!txs.has(k)) txs.set(k, { hash: k, time: Number(r.timeStamp), tok: new Map(), weth: 0n });
      const g = txs.get(k), v = BigInt(r.value || 0), sign = r.to?.toLowerCase() === me_ ? 1n : r.from?.toLowerCase() === me_ ? -1n : 0n;
      const c = r.contractAddress?.toLowerCase();
      if (c === weth) g.weth += sign * v;
      else if (byToken.has(c)) g.tok.set(c, (g.tok.get(c) || 0n) + sign * v);
    }
    const rows = [];
    for (const g of txs.values()) for (const [c, net] of g.tok) {
      if (!net) continue;
      const x = byToken.get(c);
      const kind = net > 0n ? (g.weth < 0n ? "Buy" : "Received") : g.weth > 0n ? "Sell" : "Sent";
      rows.push({ x, kind, amt: net < 0n ? -net : net, weth: g.weth < 0n ? -g.weth : g.weth, hash: g.hash, time: g.time });
    }
    if (id !== renderId) return;
    const trades = rows.filter((r) => r.kind === "Buy" || r.kind === "Sell").length;
    psumSet("trades", String(trades), rows.length);
    $("#pact").innerHTML = rows.length ? `<div class="plist2">${rows.slice(0, 100).map((r) => `
      <div class="prow2"><span class="pk ${r.kind === "Buy" || r.kind === "Received" ? "good" : "bad"}">${r.kind}</span>
        <div class="pr-main"><a href="#/token/${r.x.curve}"><b>$${esc(r.x.symbol || "?")}</b></a><span class="muted">${fmt(Number(formatUnits(r.amt, r.x.decimals)))} tokens${r.weth && (r.kind === "Buy" || r.kind === "Sell") ? ` · ${fu(r.weth, 18, 5)} WETH` : ""}</span></div>
        <div class="pr-side"><a class="muted" href="${txUrl(r.hash)}" target="_blank" rel="noopener">${ago(r.time)} ${ICON_OUT}</a></div></div>`).join("")}</div>`
      : `<div class="pempty">No trades yet. <a href="#/swap">Make your first swap</a></div>`;
  } catch (e) { if (id === renderId) { $("#pact").innerHTML = `<div class="muted">Activity could not be read right now. ${esc(errText(e))}</div>`; psumSet("trades", "—"); } }
}

/* ───────────── earnings (Portfolio) ───────────── */
// Two income streams, both read on-chain through the SDK's ABIs:
//  • Trading fees: each curve trade sets aside a creator share and a Config-owner (partner) share.
//    They accumulate in Ammora's fee vault as WETH until the owner claims them.
//  • Pool fees: at graduation the liquidity becomes a position NFT in the Ammora pool;
//    every pool trade accrues fees to that position, claimable by whoever holds the NFT.
const ERC721_TRANSFER = toEventSelector("Transfer(address,address,uint256)");
const PM = () => L.concentratedPositionManager;
const pmAbi = () => A.ammConcentratedPositionManagerV3Abi;

function loadEarnings(id, me) {
  vaultCard(id, me);
  positionsCard(id, me);
}

async function vaultCard(id, me) {
  const box = () => $("#evault");
  let vault, owed;
  try {
    vault = await retryLag(() => pc.readContract({ address: L.factory, abi: A.ammoraLaunchFactoryV4Abi, functionName: "feeVault" }));
    owed = await pc.readContract({ address: vault, abi: A.feeVaultAbi, functionName: "claimable", args: [WETH, me] });
  } catch (e) { if (psum) { psum.vault = 0n; psumFees(); } if (id === renderId && box()) box().innerHTML = `<div class="muted">Trading fees could not be read right now. ${esc(errText(e))}</div>`; return; }
  if (id !== renderId || !box()) return;
  if (psum) { psum.vault = owed; psum.cv = owed > 0n ? 1 : 0; psumFees(); }
  box().innerHTML = `<div class="earn-k">Trading fees</div>
    <div class="earn-v">${fu(owed, 18, 6)} <small>WETH</small></div>
    <div class="muted earn-d">Your creator and Config-owner share of every bonding-curve trade, across all your launches.</div>
    <button class="btn ${owed > 0n ? "pri" : ""} block" id="vclaim" ${owed > 0n ? "" : "disabled"}>${owed > 0n ? "Claim to wallet" : "Nothing to claim yet"}</button>`;
  $("#vclaim").onclick = async () => {
    try {
      await ensureWallet();
      if (getAddress(W.address) !== me) throw new Error("Switch back to the wallet this portfolio belongs to.");
      const tx = A.buildClaimFeeVaultFor(WETH, me, me);
      await runSteps("Claiming trading fees", [{ label: `Claim ${fu(owed, 18, 6)} WETH`, run: () => sendTx({ to: vault, data: tx.data }, "Fee claim") }]);
      toast("Fees claimed. They arrive as WETH; unwrap on the Wrap page if you want ETH.", "ok", 8000);
      setTimeout(() => vaultCard(id, me), 2500);
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err", 9000); }
  };
}

async function positionsCard(id, me) {
  const box = () => $("#elp");
  let rows = [];
  try {
    const logs = await explorerLogs({ address: PM(), topic0: ERC721_TRANSFER, topic2: "0x" + me.slice(2).toLowerCase().padStart(64, "0") });
    const ids = [...new Set(logs.filter((l) => l.topics[3]).map((l) => BigInt(l.topics[3])))].slice(-40);
    const launches = await loadLaunches().catch(() => []);
    rows = (await Promise.all(ids.map(async (tokenId) => {
      const owner = await pc.readContract({ address: PM(), abi: pmAbi(), functionName: "ownerOf", args: [tokenId] }).catch(() => null);
      if (!owner || owner.toLowerCase() !== me.toLowerCase()) return null;
      const pos = await pc.readContract({ address: PM(), abi: pmAbi(), functionName: "getPosition", args: [tokenId] }).catch(() => null);
      let fees = null;
      try { fees = (await pc.simulateContract({ address: PM(), abi: pmAbi(), functionName: "claimPositionFees", args: [tokenId, me], account: me })).result; } catch {}
      const launch = pos && launches.find((x) => x.pool && x.pool.toLowerCase() === String(pos.pool).toLowerCase());
      // Liquidity split: unlocked (withdrawable), vesting, and permanently locked (never withdrawable; fees still claimable).
      const big = (v) => { try { return BigInt(v ?? 0); } catch { return 0n; } };
      const liq = { unlocked: big(pos?.unlockedLiquidity), vested: big(pos?.vestedLiquidity), locked: big(pos?.permanentLockedLiquidity) };
      const dust = liq.unlocked + liq.vested + liq.locked < 1_000_000n && !(fees && (fees[0] > 0n || fees[1] > 0n));
      return dust ? null : { tokenId, launch, fees, liq };
    }))).filter(Boolean);
  } catch (e) { if (psum) { psum.lp = 0n; psumFees(); } if (id === renderId && box()) box().innerHTML = `<div class="earn-k">Pool fees</div><div class="muted">Positions could not be read right now. ${esc(errText(e))}</div>`; return; }
  if (id !== renderId || !box()) return;
  const has = (r) => r.fees && (r.fees[0] > 0n || r.fees[1] > 0n);
  if (psum) { psum.lp = rows.reduce((a, r) => a + (r.fees?.[1] || 0n), 0n); psum.cl = rows.filter(has).length; psumFees(); }
  box().innerHTML = `<div class="earn-k">Pool fees</div>
    ${rows.length ? `<div class="earn-list">${rows.map((r, i) => `<div class="earn-row">
        <div><b>${r.launch ? "$" + esc(r.launch.symbol) : "Position"}</b> <span class="muted mono">#${r.tokenId}</span>${r.liq?.locked > 0n && !r.liq.unlocked ? ` <span class="lockt" title="This liquidity is locked in the pool forever. It can never be withdrawn, but its trading fees are yours to claim.">🔒 Locked forever</span>` : r.liq?.vested > 0n ? ` <span class="lockt">Vesting</span>` : ""}
          <div class="muted" style="font-size:12.5px">${r.fees ? `${fu(r.fees[0], r.launch?.decimals ?? 18)} ${esc(r.launch?.symbol || "token")} + ${fu(r.fees[1], 18, 6)} WETH` : "Fees unavailable"}</div></div>
        <button class="btn ${has(r) ? "pri" : ""}" data-p="${i}" ${has(r) ? "" : "disabled"}>${has(r) ? "Claim" : "—"}</button></div>`).join("")}</div>`
      : `<div class="earn-v">0 <small>positions</small></div>`}
    <div class="muted earn-d">When one of your tokens graduates, its pool position earns a fee on every pool trade. Each position is claimed separately. Graduation liquidity is locked in the pool forever, so it can't be withdrawn, but its fees keep coming.</div>
    ${rows.filter(has).length > 1 ? `<button class="btn pri block" id="pclaimall">Claim all (${rows.filter(has).length} positions)</button>` : ""}`;
  const claim = async (list) => {
    try {
      await ensureWallet();
      if (getAddress(W.address) !== me) throw new Error("Switch back to the wallet this portfolio belongs to.");
      await runSteps("Claiming pool fees", list.map((r) => ({ label: `Claim fees of ${r.launch ? "$" + r.launch.symbol + " " : ""}position #${r.tokenId}`,
        run: () => sendTx({ to: PM(), data: encodeFunctionData({ abi: pmAbi(), functionName: "claimPositionFees", args: [r.tokenId, me] }) }, "Pool fee claim") })));
      toast("Pool fees claimed.", "ok", 6000);
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err", 9000); }
    setTimeout(() => positionsCard(id, me), 2500);
  };
  box().querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => claim([rows[Number(b.dataset.p)]])));
  const all = $("#pclaimall"); if (all) all.onclick = () => claim(rows.filter(has));
}

/* ───────────── view: swap ───────────── */
// One screen to swap ETH ⇄ any Ammora launch token. Live curves trade on their bonding curve,
// graduated tokens in their Ammora pool: the same engines as the token page.
const sw = { curve: null, buy: true, slip: SITE.defaultSlippageBps };

async function viewSwap(id, arg) {
  if (arg && isAddress(arg)) sw.curve = getAddress(arg);
  else if (arg && arg.toLowerCase() === "weth") sw.curve = "WETH";
  app.innerHTML = `<div class="form" style="max-width:520px">
    <div><h1 style="font-size:40px">Swap</h1><p class="muted" style="margin:10px 0 0">Swap ETH for any token launched on Ammora, and back. Live tokens trade on their bonding curve, graduated tokens in their Ammora pool. Pick WETH to wrap or unwrap.</p></div>
    <div class="card swap">
      <div class="sbox"><div class="kv"><span>You pay</span><span id="sbal1"></span></div>
        <div class="srow"><input class="inp samt" id="samt" inputmode="decimal" placeholder="0.0" /><button class="btn asset" id="a1"></button></div>
        <div id="squick" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
      <button class="btn flip" id="flip" aria-label="Switch direction">⇅</button>
      <div class="sbox"><div class="kv"><span>You receive</span><span id="sbal2"></span></div>
        <div class="srow"><div class="samt out-amt" id="sout">0.0</div><button class="btn asset" id="a2"></button></div></div>
      <div id="sslipwrap"><label class="l">Slippage</label><div class="seg" id="sslip">${[50, 100, 300, 500].map((b) => `<button data-b="${b}" class="${b === sw.slip ? "on" : ""}">${b / 100}%</button>`).join("")}</div></div>
      <div class="out" id="sq"><span class="muted">Choose a token and enter an amount.</span></div>
      <button class="btn pri block" id="sgo" data-wl="Swap">${W.address ? "Swap" : "Connect wallet"}</button>
      <div class="help">Buys are paid in WETH: missing WETH is wrapped from your ETH automatically. Sells pay out WETH; choose <a href="#/swap/weth" id="toweth">WETH</a> as the token to unwrap it back to ETH.</div>
    </div></div>`;

  let list = [];
  try { list = (await loadLaunches()).filter((x) => x.status === 1 || x.status === 3); } catch {}
  if (id !== renderId) return;
  if (!sw.curve && list.length) sw.curve = [...list].sort((a, b) => b.raised - a.raised)[0].curve;

  let ctx = null, eng = null, bals = null, qn = 0, timer;
  const isWrap = () => sw.curve === "WETH";
  const wethLabel = `<span class="avatar sm eth">W</span><b>WETH</b><span>▾</span>`;
  const tokLabel = () => {
    if (isWrap()) return wethLabel;
    const x = list.find((y) => y.curve === sw.curve);
    if (!ctx && !x) return `<b>Select token</b><span>▾</span>`;
    const sym = ctx?.tok.symbol || x?.symbol || "?";
    return `${avatar(x ? { ...x } : { symbol: sym }, "sm")}<b>${esc(sym)}</b><span>▾</span>`;
  };
  const ethLabel = `<span class="avatar sm eth">Ξ</span><b>ETH</b>`;
  const paint = () => {
    $("#a1").innerHTML = sw.buy ? ethLabel : tokLabel();
    $("#a2").innerHTML = sw.buy ? tokLabel() : ethLabel;
    $("#a1").disabled = sw.buy; $("#a2").disabled = !sw.buy;
    showBal();
  };
  const showBal = () => {
    if (!bals || !ctx) { $("#sbal1").textContent = ""; $("#sbal2").textContent = ""; return; }
    const ethTxt = isWrap() ? `${fu(bals.eth, 18)} ETH` : `${fu(bals.eth, 18)} ETH + ${fu(bals.weth, 18)} WETH`, tokTxt = `${fu(bals.tk, ctx.tok.decimals)} ${ctx.tok.symbol}`;
    $("#sbal1").textContent = sw.buy ? ethTxt : tokTxt;
    $("#sbal2").textContent = sw.buy ? tokTxt : ethTxt;
    $("#squick").innerHTML = sw.buy ? ["0.001", "0.005", "0.01", "0.1"].map((v) => `<button class="btn sm" data-v="${v}">${v}</button>`).join("") + `<button class="btn sm" data-max="1" title="All your ${isWrap() ? "" : "WETH and "}ETH, minus a little ETH for gas">Max</button>`
      : [25, 50, 100].map((v) => `<button class="btn sm" data-p="${v}">${v}%</button>`).join("");
  };
  const loadBals = async () => {
    bals = null;
    if (!W.address || !ctx) return showBal();
    try {
      const [eth, weth, tk] = await Promise.all([pc.getBalance({ address: W.address }), balanceOf(WETH, W.address), balanceOf(ctx.tok.address, W.address)]);
      bals = { eth, weth, tk };
    } catch {}
    showBal();
  };
  const select = async (curve) => {
    sw.curve = curve; ctx = null; eng = null;
    $("#sslipwrap").hidden = curve === "WETH";
    if (curve === "WETH") {
      // ETH ⇄ WETH is a 1:1 wrap on the WETH contract: no pool, no fee, no slippage.
      ctx = { tok: { address: WETH, symbol: "WETH", decimals: 18 }, st: { status: "wrap" } };
      eng = {
        quote: async (side, amt) => ({ amountOut: amt, fee: 0n }),
        steps: async (side, amt) => [side === "buy"
          ? { label: `Wrap ${fu(amt, 18, 6)} ETH → WETH`, run: () => sendTx(wrapTx(amt), "Wrap") }
          : { label: `Unwrap ${fu(amt, 18, 6)} WETH → ETH`, run: () => sendTx(unwrapTx(amt), "Unwrap") }],
      };
      if (history.replaceState) history.replaceState(null, "", "#/swap/weth");
      paint(); loadBals(); requote();
      return;
    }
    paint();
    $("#sq").innerHTML = `<span class="muted">Loading token…</span>`;
    try {
      ctx = await retryLag(() => loadCtx(curve), 4);
      if (id !== renderId) return;
      eng = ctx.st.status === 1 ? curveEngine(ctx) : ctx.st.status === 3 ? poolEngine(ctx) : null;
      if (history.replaceState) history.replaceState(null, "", `#/swap/${curve}`);
      paint(); loadBals();
      if (!eng) { $("#sq").innerHTML = `<span class="muted">This token is ready to graduate and can't be traded right now. <a href="#/token/${curve}">Open its page</a> to graduate it.</span>`; return; }
      requote();
    } catch (e) { $("#sq").innerHTML = `<span class="bad">${esc(errText(e))}</span>`; }
  };
  const amount = () => {
    const v = $("#samt").value.trim(); if (!v) return 0n;
    try { return parseUnits(v, sw.buy ? 18 : (ctx?.tok.decimals ?? 18)); } catch { return -1n; }
  };
  const requote = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const n = ++qn, amt = amount();
      if (!eng) return;
      if (amt === 0n) { $("#sout").textContent = "0.0"; $("#sq").innerHTML = `<span class="muted">Enter an amount to see a live quote.</span>`; return; }
      if (amt < 0n) { $("#sq").innerHTML = `<span class="bad">Invalid amount.</span>`; return; }
      $("#sq").innerHTML = `<span class="muted">Quoting…</span>`;
      try {
        const side = sw.buy ? "buy" : "sell";
        const q = await eng.quote(side, amt, sw.slip);
        if (n !== qn) return;
        const outDec = sw.buy ? ctx.tok.decimals : 18, outSym = sw.buy ? ctx.tok.symbol : isWrap() ? "ETH" : "WETH";
        if (isWrap()) {
          $("#sout").textContent = fu(q.amountOut, 18, 6);
          $("#sq").innerHTML = `<div class="kv"><span>Route</span><b>${sw.buy ? "Wrap (WETH contract)" : "Unwrap (WETH contract)"}</b></div>
            <div class="kv"><span>You receive</span><b>${fu(q.amountOut, 18, 6)} ${outSym}</b></div><div class="kv"><span>Fee</span><b>None, 1:1</b></div>`;
          return;
        }
        const min = q.amountOut * BigInt(10_000 - sw.slip) / 10_000n;
        $("#sout").textContent = fu(q.amountOut, outDec, 6);
        $("#sq").innerHTML = `<div class="kv"><span>Route</span><b>${ctx.st.status === 1 ? "Bonding curve" : "Ammora pool"}</b></div>
          <div class="kv"><span>Minimum received</span><b>${fu(min, outDec, 6)} ${esc(outSym)}</b></div>
          <div class="kv"><span>Trading fee</span><b>${fu(q.fee, 18, 4)} WETH</b></div>${q.note || ""}`;
      } catch (e) { if (n === qn) { $("#sout").textContent = "—"; $("#sq").innerHTML = `<span class="bad">${esc(errText(e))}</span>`; } }
    }, 350);
  };
  const pick = () => {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `<div class="modal"><h3>Select a token</h3><input class="inp" id="pq" placeholder="Search name, ticker or address" />
      <div class="plist" id="pl"></div><button class="btn block" data-x>Close</button></div>`;
    const draw = () => {
      const q = $("#pq", bg).value.trim().toLowerCase();
      const rows = list.filter((x) => !q || [x.name, x.symbol, x.token, x.curve].some((v) => String(v || "").toLowerCase().includes(q)))
        .filter((x) => q || (!x.junk && !x.test)).sort((a, b) => b.raised - a.raised).slice(0, 60);
      const wrow = !q || "weth wrapped ether eth".includes(q) ? `<button class="prow" data-c="WETH"><span class="avatar sm eth">W</span><span><b>Wrapped Ether</b><em>WETH · wrap / unwrap</em></span></button>` : "";
      $("#pl", bg).innerHTML = wrow + (rows.length ? rows.map((x) => `<button class="prow" data-c="${x.curve}">${avatar(x, "sm")}<span><b>${esc(x.name || "Unnamed")}${verTag(x.curve, x.token)}</b><em>$${esc(x.symbol || "?")}</em></span>${statusBadge(x.status)}</button>`).join("")
        : wrow ? "" : `<div class="muted" style="padding:12px">No tokens match.</div>`);
    };
    bg.onclick = (e) => {
      const r = e.target.closest(".prow");
      if (r) { bg.remove(); $("#samt").value = ""; select(r.dataset.c); }
      else if (e.target === bg || e.target.closest("[data-x]")) bg.remove();
    };
    document.body.appendChild(bg);
    $("#pq", bg).oninput = draw;
    draw();
  };
  $("#a1").onclick = pick; $("#a2").onclick = pick;
  $("#toweth").onclick = (e) => { e.preventDefault(); sw.buy = false; $("#samt").value = ""; select("WETH"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  $("#flip").onclick = () => { sw.buy = !sw.buy; $("#samt").value = ""; $("#sout").textContent = "0.0"; paint(); requote(); };
  $("#samt").oninput = requote;
  $("#squick").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) $("#samt").value = b.dataset.v;
    else if (b.dataset.max) { if (bals) $("#samt").value = formatUnits(maxBuy(bals, isWrap()), 18); }
    else if (bals && ctx) $("#samt").value = formatUnits(bals.tk * BigInt(b.dataset.p) / 100n, ctx.tok.decimals);
    requote();
  };
  $("#sslip").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; sw.slip = Number(b.dataset.b); $("#sslip").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); requote(); };
  $("#sgo").onclick = async () => {
    const go = $("#sgo");
    try {
      await ensureWallet();
      if (!eng) throw new Error("Choose a token to swap.");
      const amt = amount();
      if (amt <= 0n) throw new Error("Enter an amount.");
      go.disabled = true;
      const side = sw.buy ? "buy" : "sell";
      await runSteps(isWrap() ? (sw.buy ? "Wrapping ETH" : "Unwrapping WETH") : sw.buy ? `Buying $${ctx.tok.symbol}` : `Selling $${ctx.tok.symbol}`, await eng.steps(side, amt, sw.slip));
      toast(isWrap() ? (sw.buy ? "Wrapped." : "Unwrapped to ETH.") : "Swap complete.", "ok");
      $("#samt").value = ""; $("#sout").textContent = "0.0";
      loadBals(); requote();
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err", 9000); }
    finally { go.disabled = false; }
  };
  paint();
  if (sw.curve) select(sw.curve);
  else $("#sq").innerHTML = `<span class="muted">No tradable tokens found yet.</span>`;
}

/* ───────────── view: bridge ───────────── */
// Ethereum Sepolia → GIWA Sepolia ETH deposits through GIWA's OptimismPortal (OP Stack, the method in
// GIWA's own bridging docs). Withdrawals take ~7 days (prove + finalize), so they go to GIWA's official bridge.
const L1 = {
  id: 11155111, hex: "0xaa36a7", name: "Ethereum Sepolia",
  rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://eth-sepolia.blockscout.com",
  // OptimismPortal of GIWA Sepolia on Ethereum Sepolia (verified on-chain: systemConfig().l2ChainId() = 91342).
  portal: "0x956962C34687A954e611A83619ABaA37Ce6bC78A",
};
const OFFICIAL_BRIDGE = "https://sepolia-bridge.giwa.io/";
const portalAbi = [{ type: "function", name: "depositTransaction", stateMutability: "payable",
  inputs: [{ name: "_to", type: "address" }, { name: "_value", type: "uint256" }, { name: "_gasLimit", type: "uint64" }, { name: "_isCreation", type: "bool" }, { name: "_data", type: "bytes" }], outputs: [] }];
const l1Chain = defineChain({ id: L1.id, name: L1.name, nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [L1.rpc] } } });
const pc1 = createPublicClient({ chain: l1Chain, transport: http(L1.rpc, { retryCount: 3, retryDelay: 800 }) });
const L1_GAS_RESERVE = parseUnits("0.003", 18);
let bridgeTab = "in";
// Simple network marks (letter badges, not the networks' official logos).
const NET = { eth: `<span class="net n-eth" aria-hidden="true">Ξ</span>`, giwa: `<span class="net n-giwa" aria-hidden="true">G</span>` };
const netAsset = (n, label) => `<span class="btn asset netasset" style="cursor:default">${NET[n]}<span class="na"><b>ETH</b><em>${label}</em></span></span>`;

async function switchTo(hexId, add) {
  try { await W.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] }); }
  catch (e) {
    if (e.code === 4902 || /Unrecognized|not been added|unknown chain/i.test(e.message || "")) await W.provider.request({ method: "wallet_addEthereumChain", params: [add] });
    else throw e;
  }
  W.chainId = Number(await W.provider.request({ method: "eth_chainId" }));
  renderHeader();
}

async function viewBridge(id) {
  app.innerHTML = `<div class="form" style="max-width:540px">
    <div><h1 style="font-size:40px">Bridge</h1><p class="muted" style="margin:10px 0 0">Move ETH from Ethereum Sepolia to GIWA Sepolia to start launching and trading. Deposits arrive in a few minutes.</p></div>
    <div class="seg bseg" id="btabs"><button data-t="in" class="${bridgeTab === "in" ? "on" : ""}">${NET.eth} Ethereum <span class="tarr">→</span> ${NET.giwa} GIWA</button><button data-t="out" class="${bridgeTab === "out" ? "on" : ""}">${NET.giwa} GIWA <span class="tarr">→</span> ${NET.eth} Ethereum</button></div>
    <div id="bbody"></div></div>`;
  $("#btabs").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; bridgeTab = b.dataset.t; $("#btabs").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); draw(); };
  const draw = () => (bridgeTab === "in" ? depositView(id) : withdrawView());
  draw();
}

function withdrawView() {
  $("#bbody").innerHTML = `<div class="card swap">
    <div class="bnet"><div class="bn">${NET.giwa}<div><span class="muted">From</span><b>GIWA Sepolia</b></div></div><span class="barrow">→</span><div class="bn">${NET.eth}<div><span class="muted">To</span><b>Ethereum Sepolia</b></div></div></div>
    <p style="margin:0">Withdrawals from GIWA back to Ethereum go through a challenge period of about <b>7 days</b> and need three steps: start, prove, then finalize. GIWA's official bridge tracks all of them for you.</p>
    <a class="btn pri block" href="${OFFICIAL_BRIDGE}" target="_blank" rel="noopener">Open the official GIWA bridge ${ICON_OUT}</a>
    <div class="help">Want to leave GIWA quickly? You don't have to: test ETH on GIWA is free from the <a href="https://faucet.giwa.io/" target="_blank" rel="noopener">GIWA faucet</a>.</div></div>`;
}

function depositView(id) {
  $("#bbody").innerHTML = `<div class="card swap">
    <div class="sbox"><div class="kv"><span class="nlab">${NET.eth} From <b>Ethereum Sepolia</b></span><span id="b1"></span></div>
      <div class="srow"><input class="inp samt" id="bamt" inputmode="decimal" placeholder="0.0" />${netAsset("eth", "Ethereum Sepolia")}</div>
      <div id="bquick" style="display:flex;gap:6px;flex-wrap:wrap">${["0.01", "0.05", "0.1"].map((v) => `<button class="btn sm" data-v="${v}">${v}</button>`).join("")}<button class="btn sm" data-max="1" title="All your Sepolia ETH, minus a little for gas">Max</button></div></div>
    <div class="btn flip bflip" aria-hidden="true">↓</div>
    <div class="sbox"><div class="kv"><span class="nlab">${NET.giwa} To <b>GIWA Sepolia</b></span><span id="b2"></span></div>
      <div class="srow"><div class="samt out-amt" id="bout">0.0</div>${netAsset("giwa", "GIWA Sepolia")}</div></div>
    <div class="out" id="bq"><div class="kv"><span>Route</span><b>Official GIWA portal</b></div><div class="kv"><span>Arrives in</span><b>~1–3 minutes</b></div><div class="kv"><span>Bridge fee</span><b>None, only Sepolia gas</b></div></div>
    <button class="btn pri block" id="bgo" data-wl="Bridge to GIWA">${W.address ? "Bridge to GIWA" : "Connect wallet"}</button>
    <div class="help">Your wallet switches to Ethereum Sepolia to sign the deposit, then back to GIWA. Need Sepolia ETH? Try the <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noopener">Sepolia faucet</a>. Withdrawing back takes ~7 days, see the other tab.</div>
  </div>`;
  let bals = null;
  const loadBals = async () => {
    if (!W.address) return;
    try {
      const [b1, b2] = await Promise.all([pc1.getBalance({ address: W.address }), pc.getBalance({ address: W.address })]);
      bals = { b1, b2 };
      if ($("#b1")) { $("#b1").textContent = `Balance: ${fu(b1, 18, 5)} ETH`; $("#b2").textContent = `Balance: ${fu(b2, 18, 5)} ETH`; }
    } catch {}
  };
  const sync = () => { $("#bout").textContent = $("#bamt").value.trim() || "0.0"; };
  $("#bamt").oninput = sync;
  $("#bquick").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) $("#bamt").value = b.dataset.v;
    else if (bals) $("#bamt").value = formatUnits(bals.b1 > L1_GAS_RESERVE ? bals.b1 - L1_GAS_RESERVE : 0n, 18);
    sync();
  };
  loadBals();
  $("#bgo").onclick = async () => {
    const go = $("#bgo");
    try {
      if (!W.address) { await connect(); refreshWalletLabels(); await loadBals(); return; }
      let amt; try { amt = parseUnits($("#bamt").value.trim() || "0", 18); } catch { throw new Error("Invalid amount."); }
      if (amt <= 0n) throw new Error("Enter an amount.");
      await loadBals();
      if (bals && bals.b1 < amt) throw new Error(`Not enough ETH on Ethereum Sepolia: you have ${fu(bals.b1, 18, 5)} ETH.`);
      go.disabled = true;
      const me = getAddress(W.address), before = bals?.b2 ?? (await pc.getBalance({ address: me }));
      const data = encodeFunctionData({ abi: portalAbi, functionName: "depositTransaction", args: [me, amt, 100_000n, false, "0x"] });
      let l1hash;
      await runSteps(`Bridging ${fu(amt, 18, 6)} ETH to GIWA`, [
        { label: "Switch wallet to Ethereum Sepolia", run: () => switchTo(L1.hex, { chainId: L1.hex, chainName: L1.name, nativeCurrency: l1Chain.nativeCurrency, rpcUrls: [L1.rpc], blockExplorerUrls: [L1.explorer] }) },
        { label: `Deposit ${fu(amt, 18, 6)} ETH (Ethereum Sepolia)`, run: async () => {
          await pc1.call({ account: me, to: L1.portal, data, value: amt });
          l1hash = await W.provider.request({ method: "eth_sendTransaction", params: [{ from: me, to: L1.portal, data, value: toHex(amt) }] });
          toast(`Deposit sent · <a href="${L1.explorer}/tx/${l1hash}" target="_blank" rel="noopener">view</a>`);
          const r = await pc1.waitForTransactionReceipt({ hash: l1hash, pollingInterval: 3000, timeout: 300_000 });
          if (r.status !== "success") throw new Error("The deposit reverted on Ethereum Sepolia.");
        } },
        { label: "Switch wallet back to GIWA Sepolia", run: async () => { try { await ensureChain(); } catch {} } },
        { label: "Wait for the ETH to arrive on GIWA", run: async () => {
          for (let i = 0; i < 60; i++) {
            const now = await pc.getBalance({ address: me }).catch(() => before);
            if (now > before) return;
            await sleep(5000);
          }
          throw new Error("Not visible on GIWA yet. Deposits can take a few more minutes; your ETH is safe and will arrive.");
        } },
      ]);
      toast(`Bridged! ${fu(amt, 18, 6)} ETH is on GIWA.`, "ok", 8000);
      $("#bamt").value = ""; sync(); loadBals();
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err", 9000); }
    finally { if ($("#bgo")) $("#bgo").disabled = false; }
  };
}

/* ───────────── view: wrap ───────────── */
async function viewWrap() {
  app.innerHTML = `<div class="form card" style="max-width:520px"><h2>ETH ⇄ WETH</h2>
    <p class="muted" style="margin:0">Ammora curves trade against WETH (<a class="mono" href="${addrUrl(WETH)}" target="_blank" rel="noopener">${short(WETH)}</a>). Buys wrap automatically; use this to wrap or unwrap by hand.</p>
    <div class="out" id="wb"><span class="muted">${W.address ? "Loading balances…" : "Connect your wallet to see balances."}</span></div>
    <div><label class="l" for="wamt">Amount</label><input class="inp" id="wamt" inputmode="decimal" placeholder="0.0" /></div>
    <div class="fgrid"><button class="btn pri" id="dw">Wrap ETH → WETH</button><button class="btn" id="uw">Unwrap WETH → ETH</button></div></div>`;
  const loadB = async () => {
    if (!W.address) return;
    const [e, w] = await Promise.all([pc.getBalance({ address: W.address }), balanceOf(WETH, W.address)]);
    $("#wb").innerHTML = `<div class="kv"><span>ETH</span><b>${fu(e, 18, 6)}</b></div><div class="kv"><span>WETH</span><b>${fu(w, 18, 6)}</b></div>`;
  };
  const act = (wrap) => async () => {
    try {
      await ensureWallet();
      const amt = parseUnits($("#wamt").value.trim() || "0", 18);
      if (amt <= 0n) throw new Error("Enter an amount.");
      await runSteps(wrap ? "Wrapping ETH" : "Unwrapping WETH", [{ label: wrap ? "Wrap ETH" : "Unwrap WETH", run: () => sendTx(wrap ? wrapTx(amt) : unwrapTx(amt), wrap ? "Wrap" : "Unwrap") }]);
      loadB();
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err"); }
  };
  $("#dw").onclick = act(true); $("#uw").onclick = act(false);
  loadB().catch(() => {});
}

/* ───────────── view: owner setup (create the launchpad's own Config) ───────────── */
// Derives a registry-valid Config from the reviewed template: only sale supply, graduation target
// and recipients change (same approach as the public Ammora examples' deriveConfigFromTemplate).
// Integer square root (Newton's method) for bigint.
function isqrt(n) {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
// The price rises CURVE_SQRT_RATIO² = 16x from the first buy to graduation. The start price is
// solved from the sale supply and target instead of copied from the template: a template start
// price that is far too low makes the curve sell almost all of its supply in the first buys.
const CURVE_SQRT_RATIO = 4n;
function deriveConfig(template, saleSupply, threshold, owner) {
  if (template.config.migrationMode !== A.AmmoraV4MigrationMode.Concentrated) throw new Error("The template must use concentrated graduation.");
  // upper = Q128·threshold / (saleSupply·start) and upper = r·start  =>  start = √(Q128·threshold / (saleSupply·r))
  const startSqrtPrice = isqrt(((1n << 128n) * threshold) / (saleSupply * CURVE_SQRT_RATIO));
  const curve = A.buildSingleSegmentCurve(startSqrtPrice, saleSupply, threshold);
  const seg = curve[0];
  if (!seg) throw new Error("Curve construction returned no segment.");
  const range = { sqrtPriceX64: seg.upperSqrtPrice, sqrtMinPriceX64: seg.lowerSqrtPrice, sqrtMaxPriceX64: seg.upperSqrtPrice * 2n };
  const quoteFee = threshold * BigInt(template.config.migrationQuoteFeeBps) / 10_000n;
  const dest = A.concentratedDepositQuote(range, { quoteAmount: threshold - quoteFee });
  const v = template.config.lockedBaseVesting;
  const locked = v.cliffUnlockAmount + v.amountPerPeriod * BigInt(v.numberOfPeriods);
  const config = {
    ...template.config,
    startSqrtPrice,
    totalSupply: saleSupply + dest.baseAmount + locked,
    migrationQuoteThreshold: threshold,
    migrationBaseThreshold: dest.baseAmount,
    postMigrationSqrtMinPrice: range.sqrtMinPriceX64,
    postMigrationSqrtMaxPrice: range.sqrtMaxPriceX64,
    postMigrationLiquidity: dest.liquidity,
    partnerRecipient: owner,
    leftoverReceiver: owner,
    liquidityDistribution: { ...template.config.liquidityDistribution, partner: owner },
  };
  A.assertAmmoraV4Config(config, curve);
  return { config, curve };
}

// Pick a reviewed, enabled Config to copy the curve shape and fees from. The configured template is
// tried first; if Ammora has disabled it, the newest enabled Config that derives cleanly is used.
async function findTemplate(owner) {
  const bn = await pc.getBlockNumber();
  const ok = (t) => {
    if (!t?.enabled || t.config.migrationMode !== A.AmmoraV4MigrationMode.Concentrated) return false;
    if (Number(t.config.feeSchedulerMode) !== 0 || !atomicEligible(t.config)) return false;
    try { deriveConfig(t, 10n ** BigInt(t.config.tokenDecimals) * 800_000_000n, 10n ** 16n, owner); return true; } catch { return false; }
  };
  if (SITE.templateConfigId) {
    try { const t = await A.getAmmoraV4ConfigAtBlock(pc, L.configRegistry, BigInt(SITE.templateConfigId), bn); if (ok(t)) return { id: BigInt(SITE.templateConfigId), t }; } catch {}
  }
  const next = await A.getAmmoraV4NextConfigId(pc, L.configRegistry, bn);
  for (let id = next - 1n; id >= 1n && id > next - 150n; id -= 8n) {
    const ids = []; for (let k = 0n; k < 8n && id - k >= 1n; k++) ids.push(id - k);
    const got = await Promise.all(ids.map((i) => A.getAmmoraV4ConfigAtBlock(pc, L.configRegistry, i, bn).catch(() => null)));
    for (let j = 0; j < ids.length; j++) if (ok(got[j])) return { id: ids[j], t: got[j] };
  }
  throw new Error("No enabled Ammora template Config was found. Try again later.");
}

function viewSetup() {
  const cur = launchConfigId();
  const d = SITE.setupDefaults;
  app.innerHTML = `<div class="form">
    <div><h1 style="font-size:36px">Owner setup</h1><p class="muted" style="margin:10px 0 0">Create this launchpad's own Ammora launch Config. It copies the curve shape and fees of an enabled, reviewed Ammora Config and makes your wallet the partner: you receive the partner share of trading fees and partner LP on graduation. Creating a Config costs gas only.</p></div>
    ${cur !== null ? `<div class="alert ok" style="margin:0">Current launch Config: <b>#${cur}</b>${SITE.launchConfigId === null ? " (saved in this browser only)" : ""}.</div>` : ""}
    <div class="card fgrid">
      <div><label class="l" for="thr">Graduation target (WETH)</label><input class="inp" id="thr" inputmode="decimal" value="${esc(d.graduationWeth)}" /><div class="help">WETH raised on the curve before the token graduates.</div></div>
      <div><label class="l" for="sup">Tokens sold on the curve</label><input class="inp" id="sup" inputmode="numeric" value="${esc(d.saleSupply)}" /><div class="help">Extra supply for the graduation pool is added automatically.</div></div>
      <div class="full help">The price rises 16× along the curve, from the first buy to graduation, so early buyers get a fair share instead of the whole supply.</div>
      <div class="full help" id="tpl">Looking for an enabled Ammora template Config…</div>
    </div>
    <div id="smsg"></div>
    <button class="btn pri block" id="mk" data-wl="Create launch Config">${W.address ? "Create launch Config" : "Connect wallet"}</button>
  </div>`;
  let found = null;
  const look = (owner) => findTemplate(owner || W.address || "0x000000000000000000000000000000000000dEaD").then((f) => {
    found = f;
    const c = f.t.config;
    if ($("#tpl")) $("#tpl").innerHTML = `Template: <b>Config #${f.id}</b> · curve fee ${(Number(c.cliffFeeBps) / 100).toFixed(2)}% · creator share ${(Number(c.creatorShareOfNonProtocolBps) / 100).toFixed(0)}% · ${c.tokenDecimals} decimals`;
    return f;
  });
  look().catch((e) => { if ($("#tpl")) $("#tpl").innerHTML = `<span class="bad">${esc(errText(e))}</span>`; });
  $("#mk").onclick = async () => {
    const btn = $("#mk");
    try {
      const owner = await ensureWallet();
      btn.disabled = true;
      let created;
      await runSteps("Creating launch Config", [
        { label: "Verify Ammora contracts", run: async () => A.verifyAmmoraV4CoreAtBlock(pc, CORE, await pc.getBlockNumber()) },
        { label: "Register Config on-chain", run: async () => {
          const f = await look(owner);
          const template = f.t;
          const threshold = parseUnits($("#thr").value.trim(), 18);
          const saleSupply = parseUnits($("#sup").value.trim(), template.config.tokenDecimals);
          if (threshold <= 0n || saleSupply <= 0n) throw new Error("Target and supply must be positive.");
          const { config, curve } = deriveConfig(template, saleSupply, threshold, owner);
          const plan = await A.planCreateAmmoraV4Config(pc, L.configRegistry, config, curve, owner, owner);
          const receipt = await sendTx(plan.transaction, "Create Config");
          created = A.parseAmmoraV4ConfigCreatedReceipt(receipt, L.configRegistry);
        } },
      ]);
      store.set("anvora.configId", created.configId);
      $("#smsg").innerHTML = `<div class="alert ok"><b>Launch Config #${created.configId} created.</b> It is already active in this browser.
        To make it the default for every visitor, set <span class="mono">launchConfigId: ${created.configId}n</span> in <span class="mono">src/config.js</span>, then rebuild and redeploy.</div>`;
    } catch (e) { if (!e.shown) $("#smsg").innerHTML = `<div class="alert err">${esc(errText(e))}</div>`; }
    finally { btn.disabled = false; }
  };
}

/* ───────────── router ───────────── */
async function render() {
  const id = ++renderId;
  renderHeader();
  const [route, arg] = location.hash.replace(/^#\/?/, "").split("/");
  window.scrollTo(0, 0);
  try {
    if (route === "token") return await viewToken(id, arg);
    if (route === "create") return await viewCreate(id, arg);
    if (route === "portfolio") return await viewPortfolio(id, arg);
    if (route === "swap") return await viewSwap(id, arg);
    if (route === "wrap") return await viewWrap();
    if (route === "bridge") return await viewBridge(id);
    if (route === "leaderboard") return await viewLeaderboard(id);
    if (route === "setup") return viewSetup();
    return await viewExplore(id);
  } catch (e) { if (id === renderId) app.innerHTML = `<div class="empty">Something went wrong: ${esc(errText(e))}</div>`; }
}
window.addEventListener("hashchange", () => { lastChart = null; render(); });
// Phone "More" sheet (Bridge, Leaderboard, Wrap): toggle, close on outside tap.
document.getElementById("tbmore")?.addEventListener("click", (e) => { e.stopPropagation(); const sh = document.getElementById("tbsheet"); sh.hidden = !sh.hidden; });
document.getElementById("tbsheet")?.addEventListener("click", (e) => { if (e.target.id === "tbsheet") e.currentTarget.hidden = true; });
// Links inside clickable cards (e.g. the creator on a token card) can't be nested <a>; route them here.
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-href]"); if (!c) return;
  e.preventDefault(); e.stopPropagation(); location.hash = c.dataset.href;
}, true);
applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const fl = [SITE.links?.x && `<a href="${esc(SITE.links.x)}" target="_blank" rel="noopener">X</a>`, SITE.links?.github && `<a href="${esc(SITE.links.github)}" target="_blank" rel="noopener">GitHub</a>`].filter(Boolean);
if (fl.length) $("#footlinks").innerHTML += " · " + fl.join(" · ");
render();
