// ─────────────────────────────────────────────────────────────
//  Anvora site settings. Edit this block, then rebuild.
// ─────────────────────────────────────────────────────────────
export const SITE = {
  name: "Anvora",
  tagline: "Launch a token on GIWA in one transaction. Watch it rise on an Ammora bonding curve until the market fills it, then graduate into a permanent pool.",

  // Your launchpad's own Ammora V4 Config. Every token launched on this site uses it,
  // and its partner fee recipient (you) earns a share of trading fees.
  // 1. Deploy the site, open #/setup, connect your wallet and create the Config.
  // 2. Paste the new Config ID here (keep the trailing n), rebuild and redeploy.
  // Until then the site uses the ID saved in your own browser by #/setup.
  launchConfigId: 96n, // created on #/setup by the owner wallet (GIWA Sepolia)

  // Config the setup page copies (curve shape, fees, vesting). null = pick the newest enabled
  // Ammora Config automatically. (Template #6 has been disabled by Ammora.)
  templateConfigId: null,

  // Defaults for the setup page.
  setupDefaults: { graduationWeth: "0.05", saleSupply: "800000000" },

  // Default trade slippage in basis points (100 = 1%).
  defaultSlippageBps: 100,

  // Optional footer links.
  links: { x: "https://x.com/anvoraapp", github: "https://github.com/KriptoKolik/anvora" },
};
