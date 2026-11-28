# Changelog

## 2026-11-25
- **Share buttons**: Share on the token page, an automatic share sheet right after a launch, and a share icon for the site. Each opens Share on X / Share via… / Copy link.
- **Cleaner icons**: SVG icons replace emoji arrows (fixes iOS rendering).
- **Step modal**: the Close button only appears if a step fails.
- **Pool trades**: after graduation, trades in the Ammora pool show up in Recent trades (tagged *Pool*) and continue the price chart.
- **Your earnings** (Portfolio): creators and Config owners see the trading fees waiting for them in Ammora's fee vault and the fees earned by their graduated pool positions, and claim them (Claim all for pool positions).
- **Live Anvora counter** on Explore: tokens launched, creators, graduations and WETH raised on Anvora, read from the chain. Tap it to list Anvora launches.
- **New badge** on launches from the last 24 hours, and more compact token cards.
- **ETH ⇄ WETH on the Swap page**: pick WETH to wrap or unwrap 1:1, no separate page needed.
- **Wallet stays connected** after a page refresh (remembers which wallet you used).
- **New Portfolio**: a one-line summary (holdings value, fees to claim, launches, trades) and tabs for Holdings, Earnings, Launches and Activity. Any wallet can be viewed at #/portfolio/<address>.
- **Quick buy amounts**: 0.1 and Max (all WETH + ETH, keeping a little ETH for gas).
- **Token page on mobile**: the Buy/Sell box now sits right under the token header; compact header and stats; graduated tokens show a single "Graduated" line instead of an empty curve.
- **Locked liquidity shown**: graduated pool positions are marked 🔒 Locked forever (liquidity can never be pulled, fees stay claimable); empty leftover positions are hidden.
- **New launch Config #108**: new tokens now graduate at 0.25 WETH (was 0.05), so one buyer can't fill the whole curve at once. Earlier Anvora launches (Config #96) still count as On Anvora.
- **Bridge tab**: deposit ETH from Ethereum Sepolia to GIWA Sepolia in one click through GIWA's official OP Stack portal (arrives in ~1–3 min). Withdrawals link to the official GIWA bridge (~7 days).
- **$ANVORA v2** is the new official token (0.5 WETH graduation, launched with a same-transaction first buy). The first $ANVORA stays listed as v1.
- **$ANVORA graduated** into a permanent Ammora pool; pool buys and sells verified on-chain.

## 2026-11-26
- **Top holders** on every token page: share of supply, with the bonding curve, Ammora pool, creator and you labelled.
- **Creator links**: tap a creator's address to see their launches and holdings.
- **24h stats on cards**: volume, trade count and price change, plus a new **Trending** sort.
- **Leaderboard**: top traders (all-time WETH volume) and top creators (graduations, WETH raised) on Anvora tokens.
- **New home card**: Anvora's own numbers (tokens, creators, graduated, WETH raised) up front, a live strip of the latest trades and launches inside it, and all-of-GIWA stats as a small line underneath.
- **Anvora badge** on tokens launched on Anvora, so they stand out in the full Ammora list.
- **Link preview**: sharing anvora.vercel.app on X now shows a proper card with the Anvora image.

## 2026-11-27
- **Phone layout, app-style**: a bottom tab bar (Explore · Swap · Launch · Portfolio · More), compact token rows that fit 5–6 tokens on one screen, a shorter hero and one-row swipeable filters. Desktop is unchanged.
- **Tidier desktop**: filters, search, a live token count and a sort menu now sit on one line, and a Launch button sits next to the wallet in the header.
- **Wider on big screens**: 4 token cards per row and less empty space on wide laptops and monitors; the header lines up with the page content.
- **One-approval trades**: wallets that support batching (EIP-5792) confirm the wrap, approval and trade in a single approval; other wallets keep the step-by-step flow.
- **Receive ETH on sells**: an on-by-default option turns the WETH from a sell straight into ETH.
- **Buy & graduate**: the buy that fills a bonding curve now also graduates the token into its Ammora pool in the same flow.
- **🔥 Closest to graduation**: the home page now spotlights the live token nearest to graduating, with how much WETH is left, so anyone can make the buy that graduates it.
- **한국어 지원 (Korean)**: switch between English and Korean from the header; Korean browsers open in Korean automatically. Token names and descriptions stay as their creators wrote them.

## Earlier
- Swap page, Official badge, hidden test tokens, $ANVORA X link fix, launch wording, mobile menu, trades show the real trader.
