// Anvora: a token launchpad + bonding-curve exchange on GIWA Sepolia.
// Every on-chain action goes through @ammora-protocol/sdk: the Ammora V4 launch factory,
// the ALC bonding curve, graduation (migration) and post-graduation pool swaps.
import * as A from "@ammora-protocol/sdk";
import {
  createPublicClient, createWalletClient, custom, http, defineChain, formatUnits, parseUnits,
  erc20Abi, getAddress, isAddress, decodeEventLog, toEventSelector, encodeFunctionData, zeroAddress, toHex,
} from "viem";
import { SITE } from "./config.js";

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
const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ type: "uint256", name: "wad" }], outputs: [] },
];

/* ───────────── storage helpers (all optional, never required) ───────────── */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))); } catch {} },
};
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
const officialBadge = `<span class="badge b-official" title="The official ${esc(SITE.name)} token">✓ Official</span>`;
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
setTimeout(async () => {   // silent reconnect if the wallet already trusts this site
  const p = WALLETS[0]?.provider || window.ethereum;
  if (!p || store.get("anvora.disconnected")) return;
  try { const [a] = await p.request({ method: "eth_accounts" }); if (a) { attach(p, a, await p.request({ method: "eth_chainId" })); renderHeader(); render(); } } catch {}
}, 80);

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
}
/* ───────────── sharing ───────────── */
const SITE_X = (SITE.links?.x || "").match(/x\.com\/([A-Za-z0-9_]+)/)?.[1] || "";
const pageUrl = (hash) => `${location.origin}${location.pathname}${hash}`;
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
    const q = new URLSearchParams({ module: "logs", action: "getLogs", fromBlock: String(from), toBlock: "latest", address, topic0 });
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
async function rpcLogs({ address, event, windows = 10 }) {
  const head = await pc.getBlockNumber();
  const out = [];
  for (let i = 0; i < windows; i++) {
    const to = head - BigInt(i * 10_000);
    if (to < BigInt(FACTORY_START)) break;
    const logs = await pc.getLogs({ address, event, fromBlock: to - 9_999n, toBlock: to });
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
      <div class="row"><a class="btn pri" href="#/create">Launch a token</a><button class="btn" id="browse">Browse launches</button><button class="btn" id="shareSite" aria-label="Share ${esc(SITE.name)}">Share ↗</button></div>
    </div>
    <div class="plate"><div class="ph"><i></i>Live on GIWA Sepolia</div>
      <div class="stats" id="stats">${[0, 1, 2, 3].map(() => `<div class="stat"><span>&nbsp;</span><b>—</b></div>`).join("")}</div>
      <div style="font-size:13px;color:var(--ironmute)">Every launch starts on an Ammora bonding curve and graduates into a permanent Ammora pool.</div></div>
  </section>
  <div class="toolbar" id="list">
    <div class="seg" id="filter">${[["all", "All"], ["live", "Live"], ["near", "Near graduation"], ["grad", "Graduated"], ["site", `On ${SITE.name}`]]
      .map(([k, n]) => `<button data-k="${k}" class="${ui.filter === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="seg" id="sort">${[["hot", "Most raised"], ["new", "Newest"], ["mcap", "Market cap"], ["prog", "Progress"]].map(([k, n]) => `<button data-k="${k}" class="${ui.sort === k ? "on" : ""}">${n}</button>`).join("")}</div>
  </div>
  <div class="toolbar">
    <input class="inp search" id="q" placeholder="Search name, ticker or address" value="${esc(ui.q)}" />
    <label class="chk"><input type="checkbox" id="hide" ${ui.hideTest ? "checked" : ""}/> Hide test &amp; broken tokens</label>
  </div>
  <div class="grid" id="cards">${Array.from({ length: 6 }, () => `<div class="skel"></div>`).join("")}</div>
  <div id="more" style="text-align:center;margin-top:18px"></div>`;

  $("#shareSite").onclick = () => shareSheet({ title: `Share ${SITE.name}`, text: `${SITE.name}: launch a token on GIWA in one transaction and watch it rise on the bonding curve ⚒️`, url: pageUrl("#/") });
  $("#browse").onclick = () => $("#list").scrollIntoView({ behavior: "smooth" });
  let list;
  try { list = await loadLaunches(); }
  catch (e) { if (id === renderId) $("#cards").outerHTML = `<div class="empty">Could not load launches: ${esc(errText(e))}<br><button class="btn" style="margin-top:12px" onclick="location.reload()">Retry</button></div>`; return; }
  if (id !== renderId) return;

  const live = list.filter((x) => x.status === 1).length, grad = list.filter((x) => x.status === 3).length;
  const vol = list.reduce((s, x) => s + Number(formatUnits(x.quoteReserve ?? 0n, 18)), 0);
  $("#stats").innerHTML = [["Tokens launched", fmt(list.length)], ["Live curves", fmt(live)], ["Graduated", fmt(grad)], ["WETH on curves", fmt(vol)]]
    .map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");

  const draw = () => {
    const q = ui.q.trim().toLowerCase();
    let rows = list.filter((x) =>
      (ui.filter === "all") || (ui.filter === "live" && x.status === 1) || (ui.filter === "grad" && x.status === 3)
      || (ui.filter === "near" && x.status === 1 && x.progress >= 0.5) || (ui.filter === "site" && cid !== null && x.configId === cid));
    if (q) rows = rows.filter((x) => [x.name, x.symbol, x.token, x.curve].some((v) => String(v || "").toLowerCase().includes(q)));
    // Your own launchpad's tokens are never hidden.
    else if (ui.hideTest) rows = rows.filter((x) => (cid !== null && x.configId === cid) || (!x.junk && !x.test));
    const m = (x) => (x.junk ? -1 : x.mcap);
    if (ui.sort === "hot") rows = [...rows].sort((a, b) => b.raised - a.raised || b.block - a.block);
    if (ui.sort === "mcap") rows = [...rows].sort((a, b) => m(b) - m(a));
    if (ui.sort === "prog") rows = [...rows].sort((a, b) => b.progress - a.progress);
    rows = [...rows.filter((x) => isOfficial(x.curve, x.token)), ...rows.filter((x) => !isOfficial(x.curve, x.token))];
    $("#cards").innerHTML = rows.length ? rows.slice(0, ui.limit).map(card).join("")
      : `<div class="empty" style="grid-column:1/-1">No launches match. <a href="#/create">Launch the first one</a>.</div>`;
    $("#more").innerHTML = rows.length > ui.limit ? `<button class="btn" id="morebtn">Load more (${rows.length - ui.limit} left)</button>` : "";
    $("#morebtn")?.addEventListener("click", () => { ui.limit += PAGE; draw(); });
  };
  const reset = () => { ui.limit = PAGE; draw(); };
  $("#filter").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.filter = b.dataset.k; $("#filter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); reset(); };
  $("#sort").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; ui.sort = b.dataset.k; $("#sort").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); reset(); };
  $("#q").oninput = (e) => { ui.q = e.target.value; reset(); };
  $("#hide").onchange = (e) => { ui.hideTest = e.target.checked; reset(); };
  draw();
}
const card = (x) => `
  <a class="card tcard" href="#/token/${x.curve}">
    <div class="thead">${avatar(x)}<div style="flex:1"><b>${esc(x.name || x.meta?.name || "Unnamed")}</b><span class="muted mono">$${esc(x.symbol || "?")}</span></div><div style="display:grid;gap:4px;justify-items:end">${statusBadge(x.status)}${isOfficial(x.curve, x.token) ? officialBadge : ""}</div></div>
    ${x.meta?.description ? `<div class="muted" style="font-size:13px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(x.meta.description)}</div>` : ""}
    <div class="kv"><span>Market cap</span><b>${x.junk ? "—" : `${fmt(x.mcap)} ETH`}</b></div>
    <div class="kv"><span>Raised</span><b>${fmt(x.raised)} WETH</b></div>
    <div class="kv"><span>Graduation</span><b>${(x.progress * 100).toFixed(1)}%</b></div>
    <div class="bar"><i style="width:${(x.progress * 100).toFixed(1)}%"></i></div>
    <div class="kv"><span>Creator ${short(x.creator)}</span><span>${x.time ? ago(x.time) : `block ${x.block}`}</span></div>
  </a>`;

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
      <div class="card">
        <div class="thero">${avatar({ meta, symbol: tok.symbol }, "lg")}
          <button class="btn sm share" id="shareTok" aria-label="Share this token">Share ↗</button>
          <div style="flex:1"><h2>${esc(tok.name)} <span class="muted mono" style="font-size:16px">$${esc(tok.symbol)}</span></h2>
            <div style="margin-top:6px">${statusBadge(st.status)} ${isOfficial(curve, tok.address) ? officialBadge : ""} <span class="muted" style="font-size:13px">Config #${st.configId} · fee ${feePct}%</span></div>
            ${links.length ? `<div class="links">${links.map(([n, u]) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener nofollow">${n} ↗</a>`).join("")}</div>` : ""}</div></div>
        ${meta.description ? `<p class="muted" style="margin:14px 0 0">${esc(meta.description)}</p>` : ""}
      </div>
      <div class="sgrid">
        <div class="stat"><span>Price</span><b>${fmt(price, 5)}</b><span>ETH per token</span></div>
        <div class="stat"><span>Market cap</span><b>${fmt(mcap)}</b><span>ETH</span></div>
        <div class="stat"><span>Curve reserve</span><b>${fu(st.quoteReserve, 18)}</b><span>WETH</span></div>
      </div>
      <div class="card">
        <div class="kv" style="font-size:14px"><span>Graduation progress</span><b>${(progress * 100).toFixed(2)}%</b></div>
        <div class="bar" style="margin:10px 0"><i style="width:${(progress * 100).toFixed(2)}%"></i></div>
        <div class="muted" style="font-size:13px">${st.status === 3 ? "This token graduated. Its liquidity now lives in a permanent Ammora pool." :
          `When ${fu(thr, 18)} WETH has been raised on the curve, it becomes ready to graduate into a permanent Ammora pool.`}</div>
      </div>
      <div class="card"><h3>Price</h3><div class="chart" id="chart"><div class="muted" style="padding:20px">Loading trades…</div></div></div>
      <div class="card"><h3 style="margin-bottom:8px">Recent trades</h3><div class="scroll" id="trades"><div class="muted">Loading…</div></div></div>
      <div class="card" style="display:grid;gap:8px;font-size:13.5px">
        <div class="kv"><span>Token</span><a class="mono" href="${addrUrl(tok.address)}" target="_blank" rel="noopener">${short(tok.address)} ↗</a></div>
        <div class="kv"><span>Bonding curve</span><a class="mono" href="${addrUrl(curve)}" target="_blank" rel="noopener">${short(curve)} ↗</a></div>
        <div class="kv"><span>Creator</span><a class="mono" href="${addrUrl(st.creator)}" target="_blank" rel="noopener">${short(st.creator)} ↗</a></div>
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
}

async function loadTrades(ctx, id) {
  let logs;
  try { logs = await explorerLogs({ address: ctx.curve, topic0: SWAP_TOPIC }); }
  catch { try { logs = await rpcLogs({ address: ctx.curve, event: SWAP_EVENT, windows: 3 }); } catch { logs = []; } }
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
  trades.sort((a, b) => a.block - b.block);
  drawChart(trades);
  $("#trades").innerHTML = trades.length ? `<table class="trades"><thead><tr><th>Type</th><th class="r">WETH</th><th class="r">${esc(ctx.tok.symbol)}</th><th>Trader</th><th class="r">When</th></tr></thead><tbody>
    ${trades.slice(-40).reverse().map((t) => `<tr><td class="${t.sell ? "bad" : "good"}">${t.sell ? "Sell" : "Buy"}</td><td class="r">${fu(t.weth, 18)}</td><td class="r">${fu(t.tokens, dec)}</td>
      <td><a class="mono" href="${addrUrl(t.trader)}" target="_blank" rel="noopener">${short(t.trader)}</a></td><td class="r"><a href="${txUrl(t.tx)}" target="_blank" rel="noopener">${t.time ? ago(t.time) : "#" + t.block}</a></td></tr>`).join("")}
    </tbody></table>` : `<div class="muted">No trades yet on the bonding curve.</div>`;
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
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3>${esc(eng.title)}</h3><a href="#/swap/${ctx.curve}" style="font-size:13px;white-space:nowrap">Open in Swap</a></div>
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
    $("#quick").innerHTML = t.side === "buy" ? ["0.001", "0.005", "0.01"].map((v) => `<button class="btn sm" data-v="${v}">${v}</button>`).join("")
      : [25, 50, 100].map((p) => `<button class="btn sm" data-p="${p}">${p}%</button>`).join("");
  };
  $("#quick").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) $("#amt").value = b.dataset.v;
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

async function viewCreate(id) {
  const cid = launchConfigId();
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
async function viewPortfolio(id) {
  if (!W.address) { app.innerHTML = `<div class="empty"><h2 style="margin-bottom:12px">Your portfolio</h2>Connect your wallet to see your tokens and launches.<br><button class="btn pri" id="pc" style="margin-top:14px">Connect wallet</button></div>`; $("#pc").onclick = () => ensureWallet().catch((e) => toast(esc(errText(e)), "err")); return; }
  app.innerHTML = `<h1 style="font-size:36px;margin-bottom:20px">Your portfolio</h1><div class="grid" id="mine"><div class="skel"></div><div class="skel"></div></div>`;
  let list;
  try { list = await loadLaunches(); } catch (e) { if (id === renderId) $("#mine").innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  const res = await pc.multicall({ contracts: list.map((x) => ({ address: x.token, abi: erc20Abi, functionName: "balanceOf", args: [W.address] })), allowFailure: true });
  if (id !== renderId) return;
  const me = W.address.toLowerCase();
  const rows = list.map((x, i) => ({ ...x, bal: res[i]?.status === "success" ? res[i].result : 0n })).filter((x) => x.bal > 0n || x.creator.toLowerCase() === me);
  $("#mine").innerHTML = rows.length ? rows.map((x) => `
    <a class="card tcard" href="#/token/${x.curve}"><div class="thead">${avatar(x)}<div style="flex:1"><b>${esc(x.name || "Unnamed")}</b><span class="muted mono">$${esc(x.symbol || "?")}</span></div>${statusBadge(x.status)}</div>
      <div class="kv"><span>Balance</span><b>${fu(x.bal, x.decimals)}</b></div>
      <div class="kv"><span>Value</span><b>${fmt(Number(formatUnits(x.bal, x.decimals)) * x.price)} ETH</b></div>
      ${x.creator.toLowerCase() === me ? `<div class="kv"><span>Role</span><b class="good">You launched this</b></div>` : ""}</a>`).join("")
    : `<div class="empty" style="grid-column:1/-1">No tokens yet. <a href="#/">Explore launches</a> or <a href="#/create">launch one</a>.</div>`;
}

/* ───────────── view: swap ───────────── */
// One screen to swap ETH ⇄ any Ammora launch token. Live curves trade on their bonding curve,
// graduated tokens in their Ammora pool: the same engines as the token page.
const sw = { curve: null, buy: true, slip: SITE.defaultSlippageBps };

async function viewSwap(id, arg) {
  if (arg && isAddress(arg)) sw.curve = getAddress(arg);
  app.innerHTML = `<div class="form" style="max-width:520px">
    <div><h1 style="font-size:40px">Swap</h1><p class="muted" style="margin:10px 0 0">Swap ETH for any token launched on Ammora, and back. Live tokens trade on their bonding curve, graduated tokens in their Ammora pool.</p></div>
    <div class="card swap">
      <div class="sbox"><div class="kv"><span>You pay</span><span id="sbal1"></span></div>
        <div class="srow"><input class="inp samt" id="samt" inputmode="decimal" placeholder="0.0" /><button class="btn asset" id="a1"></button></div>
        <div id="squick" style="display:flex;gap:6px;flex-wrap:wrap"></div></div>
      <button class="btn flip" id="flip" aria-label="Switch direction">⇅</button>
      <div class="sbox"><div class="kv"><span>You receive</span><span id="sbal2"></span></div>
        <div class="srow"><div class="samt out-amt" id="sout">0.0</div><button class="btn asset" id="a2"></button></div></div>
      <div><label class="l">Slippage</label><div class="seg" id="sslip">${[50, 100, 300, 500].map((b) => `<button data-b="${b}" class="${b === sw.slip ? "on" : ""}">${b / 100}%</button>`).join("")}</div></div>
      <div class="out" id="sq"><span class="muted">Choose a token and enter an amount.</span></div>
      <button class="btn pri block" id="sgo" data-wl="Swap">${W.address ? "Swap" : "Connect wallet"}</button>
      <div class="help">Buys are paid in WETH: missing WETH is wrapped from your ETH automatically. Sells pay out WETH; unwrap it on the <a href="#/wrap">Wrap</a> page.</div>
    </div></div>`;

  let list = [];
  try { list = (await loadLaunches()).filter((x) => x.status === 1 || x.status === 3); } catch {}
  if (id !== renderId) return;
  if (!sw.curve && list.length) sw.curve = [...list].sort((a, b) => b.raised - a.raised)[0].curve;

  let ctx = null, eng = null, bals = null, qn = 0, timer;
  const tokLabel = () => {
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
    const ethTxt = `${fu(bals.eth, 18)} ETH + ${fu(bals.weth, 18)} WETH`, tokTxt = `${fu(bals.tk, ctx.tok.decimals)} ${ctx.tok.symbol}`;
    $("#sbal1").textContent = sw.buy ? ethTxt : tokTxt;
    $("#sbal2").textContent = sw.buy ? tokTxt : ethTxt;
    $("#squick").innerHTML = sw.buy ? ["0.001", "0.005", "0.01"].map((v) => `<button class="btn sm" data-v="${v}">${v}</button>`).join("")
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
        const outDec = sw.buy ? ctx.tok.decimals : 18, outSym = sw.buy ? ctx.tok.symbol : "WETH";
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
      $("#pl", bg).innerHTML = rows.length ? rows.map((x) => `<button class="prow" data-c="${x.curve}">${avatar(x, "sm")}<span><b>${esc(x.name || "Unnamed")}</b><em>$${esc(x.symbol || "?")}</em></span>${statusBadge(x.status)}</button>`).join("")
        : `<div class="muted" style="padding:12px">No tokens match.</div>`;
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
  $("#flip").onclick = () => { sw.buy = !sw.buy; $("#samt").value = ""; $("#sout").textContent = "0.0"; paint(); requote(); };
  $("#samt").oninput = requote;
  $("#squick").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) $("#samt").value = b.dataset.v;
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
      await runSteps(sw.buy ? `Buying $${ctx.tok.symbol}` : `Selling $${ctx.tok.symbol}`, await eng.steps(side, amt, sw.slip));
      toast("Swap complete.", "ok");
      $("#samt").value = ""; $("#sout").textContent = "0.0";
      loadBals(); requote();
    } catch (e) { if (!e.shown) toast(esc(errText(e)), "err", 9000); }
    finally { go.disabled = false; }
  };
  paint();
  if (sw.curve) select(sw.curve);
  else $("#sq").innerHTML = `<span class="muted">No tradable tokens found yet.</span>`;
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
    if (route === "create") return await viewCreate(id);
    if (route === "portfolio") return await viewPortfolio(id);
    if (route === "swap") return await viewSwap(id, arg);
    if (route === "wrap") return await viewWrap();
    if (route === "setup") return viewSetup();
    return await viewExplore(id);
  } catch (e) { if (id === renderId) app.innerHTML = `<div class="empty">Something went wrong: ${esc(errText(e))}</div>`; }
}
window.addEventListener("hashchange", () => { lastChart = null; render(); });
applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const fl = [SITE.links?.x && `<a href="${esc(SITE.links.x)}" target="_blank" rel="noopener">X</a>`, SITE.links?.github && `<a href="${esc(SITE.links.github)}" target="_blank" rel="noopener">GitHub</a>`].filter(Boolean);
if (fl.length) $("#footlinks").innerHTML += " · " + fl.join(" · ");
render();
