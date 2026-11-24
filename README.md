<p align="center"><img src="brand/anvora-banner.png" alt="Anvora" width="100%"></p>

# Anvora: token launchpad on GIWA

Anvora is a token launchpad and bonding-curve exchange on **GIWA Sepolia** (chain 91342), built with the **Ammora SDK** (`@ammora-protocol/sdk@0.3.9`) for the Ammora builder mission: *"Ship an exchange or launchpad with the Ammora SDK."*

Testnet only. Ammora is beta software without an independent audit. Never use real funds.

X: [@anvoraapp](https://x.com/anvoraapp) · Launch Config: **#96** on GIWA Sepolia

## Features

| Page | What it does | Ammora SDK |
| --- | --- | --- |
| Explore | Every Ammora V4 launch on GIWA, with live status, price, market cap and graduation progress. Search, filters and sorting. | `ammoraLaunchFactoryV4Abi` (LaunchCreated), `ammoraLaunchPoolV4Abi` |
| Launch | One transaction creates an ERC-20 and its bonding curve, optionally with the creator's first buy in the same transaction (no bot can buy first). Name, ticker, description, links and image are stored on-chain (2 KB data: URI). | `getAmmoraV4ConfigAtBlock`, `verifyAmmoraV4CoreAtBlock`, `buildCreateAmmoraV4Launch`, `AmmoraPortableLifecyclePlanner`, `parseAmmoraV4LaunchCreatedReceipt` |
| Token | Buy and sell on the curve with live quotes, slippage control, automatic ETH→WETH wrapping and exact-amount approvals. Price chart and recent trades. | `AmmoraV4LaunchCurveClient` (`getStateAtBlock`, `quoteExactInputAtBlock`, `planSwapExactInput`), `classifyAmmoraV4ExactInputFill` |
| Graduation | When the curve is full, anyone can migrate it into a permanent Ammora pool. | `planMigrateAtBlock` |
| Pool trading | Graduated tokens keep trading in their Ammora pool. | `AmmoraSwapClient.prepareExactIn` |
| Portfolio | Your token balances and the tokens you launched. | |
| Owner setup | Creates the launchpad's own launch Config from an enabled, reviewed Ammora Config, with your wallet as partner fee recipient and a fair curve (the price rises 16× from the first buy to graduation). | `buildSingleSegmentCurve`, `concentratedDepositQuote`, `assertAmmoraV4Config`, `planCreateAmmoraV4Config`, `parseAmmoraV4ConfigCreatedReceipt` |

Contract addresses come from the SDK's reviewed catalog `giwaSepoliaAutoRouteDeployment`. The site has no backend: it reads the public GIWA RPC and the GIWA explorer API, and every transaction is signed in the visitor's own wallet.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm run build
npm run preview      # serves dist/ at http://localhost:3000
```

## Deploy (free)

**Vercel:** push this folder to a GitHub repository, then on vercel.com choose *Add New → Project*, import the repository and deploy. `vercel.json` already sets the build command (`npm run build`) and output folder (`dist`).

**Netlify / Cloudflare Pages:** build command `npm run build`, publish directory `dist`.

## First-time setup (owner)

1. Get GIWA Sepolia test ETH from a GIWA faucet.
2. Open your deployed site at `#/setup`, connect your wallet and click **Create launch Config**. Your wallet becomes the partner fee recipient.
3. Copy the new Config ID into `src/config.js` (`launchConfigId: 71n`, with your own number), then rebuild and redeploy. Until then the Config is only saved in your own browser.
4. Launch a test token on `#/create` and make a small buy to check everything works.

## Builder mission checklist

1. Build with the SDK: this repository.
2. Post it on X: share the site link and a screenshot of a launch.
3. Submit the website link for review.

## Configuration

All site settings are in `src/config.js`: name, tagline, launch Config ID, setup defaults, default slippage and footer links.

## Credits

Some helper code is adapted, with permission, from [Moralume](https://www.moralume.fun) by watzenous, another Ammora SDK launchpad on GIWA: the wallet steps (wrap and exact-amount approvals), the 2 KB on-chain metadata and image fitting, the launch + first-buy flow and launch discovery through the GIWA explorer. Thank you!

The launchpad Config derivation follows the approach of the public Ammora examples (`deriveConfigFromTemplate`).
