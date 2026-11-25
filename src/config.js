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
  launchConfigId: 108n, // created on #/setup by the owner wallet (GIWA Sepolia): 0.25 WETH graduation target

  // Earlier Configs of this site. Their launches still count as "On Anvora" (filter, counter).
  previousConfigIds: [96n, 110n], // #96: 0.05 WETH target (Nov 2026) · #110: 0.5 WETH, official $ANVORA v2

  // Config the setup page copies (curve shape, fees, vesting). null = pick the newest enabled
  // Ammora Config automatically. (Template #6 has been disabled by Ammora.)
  templateConfigId: null,

  // Defaults for the setup page.
  setupDefaults: { graduationWeth: "0.25", saleSupply: "800000000" },

  // Official launches: shown with an "Official" badge and pinned to the top of Explore.
  officialTokens: [
    "0xe2a84193088b5061A793601739e0899A31f8Ecb6", // $ANVORA (v2), the official Anvora token (Config #110, 0.5 WETH)
  ],

  // Small version tags shown next to a token's name (curve or token address → label).
  tokenLabels: {
    "0x39F9819744EE83f337aab7269e14B06a1922E5D5": "v1", // first $ANVORA (Config #96, graduated)
  },

  // Corrections for on-chain metadata, keyed by curve address. On-chain metadata can't be
  // edited, so this site shows these values instead (other sites still show the on-chain ones).
  metadataOverrides: {
    // $ANVORA v1: links removed and description replaced on this site (the official token is now v2).
    "0x39F9819744EE83f337aab7269e14B06a1922E5D5": { website: "", twitter: "", telegram: "", description: "The first Anvora token (v1). It graduated into a permanent Ammora pool. The official Anvora token is now $ANVORA v2." },
  },

  // Launches hidden from this site's lists (curve or token addresses). They stay on-chain and
  // their token pages still open from a direct link.
  hiddenTokens: [
    "0xe41b668173Bb967152956Dc92D1AB95feB79263e", // Anvora Test (ANVTEST), Config #96
    "0x94E293136b3a97aBFE7f7C917a449868E3ACe230", // Moraforge Test (MFTEST), old Config #94
  ],

  // Default trade slippage in basis points (100 = 1%).
  defaultSlippageBps: 100,

  // Optional footer links.
  links: { x: "https://x.com/anvoraapp", github: "https://github.com/KriptoKolik/anvora" },
};
