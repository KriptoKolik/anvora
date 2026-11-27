// English / Korean interface. The app writes its UI in English; when Korean is selected, every UI string
// that appears on the page is swapped for its Korean version as it is rendered (text, placeholders, titles).
// Token names, tickers and descriptions are user content stored on-chain and are never translated.

const KEY = "anvora.lang";
const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
export const LANG = saved === "ko" || saved === "en" ? saved
  : (navigator.languages || [navigator.language || "en"]).some((l) => /^ko\b/i.test(l)) ? "ko" : "en";

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch {}
  location.reload();
}

// Exact UI strings (trimmed text) → Korean.
const KO = {
  // navigation, header, footer
  "Explore": "탐색", "Swap": "스왑", "Launch": "런칭", "Portfolio": "포트폴리오", "Leaderboard": "리더보드", "Bridge": "브리지",
  "More": "더보기", "Main": "메인", "Anvora home": "Anvora 홈",
  "Connect wallet": "지갑 연결", "Connect a wallet": "지갑 연결", "Cancel": "취소", "Close": "닫기", "Retry": "다시 시도",
  "Switch to light mode": "라이트 모드로 전환", "Switch to dark mode": "다크 모드로 전환",
  "Disconnect this wallet from Anvora?": "Anvora에서 이 지갑의 연결을 해제할까요?",
  "Your wallet is on another network.": "지갑이 다른 네트워크에 연결되어 있습니다.", "Switch to GIWA Sepolia": "GIWA Sepolia로 전환",
  "Anvora is an independent community launchpad on": "Anvora는 다음 네트워크 위의 독립 커뮤니티 런치패드입니다:",
  "GIWA Sepolia testnet": "GIWA Sepolia 테스트넷",
  "(chain 91342), not an official Ammora product. Testnet only: never use real funds.": "(체인 91342). Ammora의 공식 제품이 아닙니다. 테스트넷 전용이므로 실제 자금을 절대 사용하지 마세요.",
  "Powered by the": "Powered by", "Ammora SDK": "Ammora SDK", "GIWA Explorer": "GIWA 익스플로러", "Wrap ETH": "ETH 래핑", "Owner setup": "오너 설정", "GitHub": "GitHub",
  "🌉 Bridge": "🌉 브리지", "Ethereum Sepolia → GIWA": "Ethereum Sepolia → GIWA", "🏆 Leaderboard": "🏆 리더보드",
  "Top traders and creators": "상위 트레이더와 크리에이터", "Ξ Wrap ETH": "Ξ ETH 래핑", "ETH ⇄ WETH": "ETH ⇄ WETH",

  // home
  "Launch a token.": "토큰을 런칭하고,", "Watch it rise": "커브 위에서", "on the curve.": "성장을 지켜보세요.",
  "Launch a token on GIWA in one transaction. Watch it rise on an Ammora bonding curve until the market fills it, then graduate into a permanent pool.":
    "GIWA에서 한 번의 트랜잭션으로 토큰을 런칭하세요. Ammora 본딩 커브에서 시장이 채울 때까지 성장한 뒤, 영구적인 풀로 졸업합니다.",
  "Launch a token": "토큰 런칭", "Browse launches": "런칭 둘러보기", "Share Anvora": "Anvora 공유",
  "Live on Anvora": "Anvora 실시간 현황", "See them →": "보러 가기 →", "Show tokens launched on Anvora": "Anvora에서 런칭된 토큰 보기",
  "Tokens launched": "런칭된 토큰", "Creators": "크리에이터", "Graduated": "졸업", "WETH raised": "모금된 WETH",
  "Across all of Ammora on GIWA:": "GIWA의 Ammora 전체:", "launches ·": "런칭 ·", "live ·": "진행 중 ·", "graduated": "졸업",
  "bought": "매수", "sold": "매도", "Loading the latest trades…": "최근 거래를 불러오는 중…",
  "No trades in the last 24 hours yet. Be the first!": "최근 24시간 동안 거래가 없습니다. 첫 거래를 해보세요!",
  "All": "전체", "Live": "진행 중", "Near graduation": "졸업 임박", "On Anvora": "Anvora", "tokens": "개 토큰", "token": "개 토큰",
  "Sort": "정렬", "Trending": "트렌딩", "Most raised": "최다 모금", "Newest": "최신순", "Market cap": "시가총액", "Progress": "진행률",
  "Hide tests": "테스트 숨기기", "Hide test and broken tokens": "테스트 및 오류 토큰 숨기기", "Search name, ticker or address": "이름, 티커 또는 주소 검색",
  "✓ Official": "✓ 공식", "The official Anvora token": "Anvora 공식 토큰", "New": "신규", "Launched in the last 24 hours": "최근 24시간 내 런칭",
  "Launched on Anvora": "Anvora에서 런칭됨", "Ready to graduate": "졸업 준비 완료", "Inactive": "비활성",
  "Raised": "모금", "Closest to graduation": "졸업에 가장 가까운 토큰", "Creator": "크리에이터", "See this creator's launches and holdings": "이 크리에이터의 런칭과 보유 자산 보기",
  "No launches match.": "조건에 맞는 런칭이 없습니다.", "Launch the first one": "첫 토큰을 런칭하세요",
  "Could not load launches:": "런칭 목록을 불러오지 못했습니다:",

  // token page
  "Website": "웹사이트", "Share": "공유", "Price": "가격", "ETH per token": "토큰당 ETH", "Curve reserve": "커브 준비금", "Supply": "공급량",
  "Graduation progress": "졸업 진행률", "Liquidity now lives in a permanent Ammora pool, where this token trades.": "유동성은 이제 영구적인 Ammora 풀에 있으며, 이 토큰은 그 풀에서 거래됩니다.",
  "Recent trades": "최근 거래", "Type": "유형", "Trader": "트레이더", "When": "시간", "Buy": "매수", "Sell": "매도", "Pool": "풀",
  "Traded in the Ammora pool after graduation": "졸업 후 Ammora 풀에서 거래됨", "Loading…": "불러오는 중…", "Loading trades…": "거래를 불러오는 중…",
  "No trades yet.": "아직 거래가 없습니다.", "The chart appears after a couple of trades.": "거래가 몇 번 발생하면 차트가 표시됩니다.",
  "Top holders": "상위 홀더", "Bonding curve": "본딩 커브", "Ammora pool": "Ammora 풀", "Contract": "컨트랙트", "Burned": "소각", "You": "나",
  "Share of total supply. The bonding curve and the Ammora pool hold the unsold tokens and liquidity; they are contracts, not people.":
    "총 공급량 대비 비율입니다. 본딩 커브와 Ammora 풀은 판매되지 않은 토큰과 유동성을 보관하는 컨트랙트이며, 사람이 아닙니다.",
  "Holder data isn't available right now.": "지금은 홀더 정보를 불러올 수 없습니다.",
  "Token": "토큰", "Total supply": "총 공급량", "View on explorer": "익스플로러에서 보기",
  "Trade on the bonding curve": "본딩 커브에서 거래", "Trade in the concentrated Ammora pool": "Ammora 집중 유동성 풀에서 거래", "Open in Swap": "스왑에서 열기",
  "You pay (ETH)": "지불 (ETH)", "Slippage": "슬리피지", "Enter an amount to see a live quote.": "금액을 입력하면 실시간 견적이 표시됩니다.",
  "Quoting…": "견적 계산 중…", "You pay": "지불", "You receive": "수령", "Minimum received": "최소 수령량", "Minimum (after slippage)": "최소 (슬리피지 반영)",
  "Trading fee": "거래 수수료", "Fee": "수수료", "Route": "경로",
  "Buys are paid in WETH. Missing WETH is wrapped from your ETH automatically, and approvals are for the exact amount only.":
    "매수는 WETH로 결제됩니다. 부족한 WETH는 ETH에서 자동으로 래핑되며, 승인은 정확한 금액만큼만 요청됩니다.",
  "This token is ready to graduate and can't be traded right now.": "이 토큰은 졸업 준비가 완료되어 지금은 거래할 수 없습니다.",
  "This curve is not active.": "이 커브는 활성 상태가 아닙니다.", "Open its page": "페이지 열기",
  "Trading": "거래", "Graduating": "졸업 진행 중", "Invalid curve address.": "잘못된 커브 주소입니다.",

  // swap
  "Swap ETH for any token launched on Ammora, and back. Live tokens trade on their bonding curve, graduated tokens in their Ammora pool. Pick WETH to wrap or unwrap.":
    "Ammora에서 런칭된 모든 토큰을 ETH와 스왑할 수 있습니다. 진행 중인 토큰은 본딩 커브에서, 졸업한 토큰은 Ammora 풀에서 거래됩니다. WETH를 선택하면 래핑/언래핑할 수 있습니다.",
  "Choose a token and enter an amount.": "토큰을 선택하고 금액을 입력하세요.", "Select token": "토큰 선택", "Select a token": "토큰 선택",
  "Switch direction": "방향 전환", "No tokens match.": "일치하는 토큰이 없습니다.", "No tradable tokens found yet.": "아직 거래 가능한 토큰이 없습니다.",
  "Wrapped Ether": "Wrapped Ether", "WETH · wrap / unwrap": "WETH · 래핑 / 언래핑", "Loading token…": "토큰을 불러오는 중…",
  "Buys are paid in WETH: missing WETH is wrapped from your ETH automatically. Sells pay out WETH; choose": "매수는 WETH로 결제되며 부족한 WETH는 ETH에서 자동으로 래핑됩니다. 매도 대금은 WETH로 지급됩니다.",
  "as the token to unwrap it back to ETH.": "를 토큰으로 선택하면 ETH로 언래핑할 수 있습니다.",
  "None, 1:1": "없음, 1:1", "Max": "최대", "All your WETH and ETH, minus a little ETH for gas": "가스비용 ETH를 조금 남기고 모든 WETH와 ETH",

  // launch
  "One transaction creates an ERC-20 token and its Ammora bonding curve. Name, ticker, description, links and image are stored on-chain.":
    "한 번의 트랜잭션으로 ERC-20 토큰과 Ammora 본딩 커브가 생성됩니다. 이름, 티커, 설명, 링크, 이미지는 온체인에 저장됩니다.",
  "Launch Config": "런칭 Config", "enabled": "활성화됨", "Creation fee": "생성 수수료", "Graduates at": "졸업 기준", "Curve fee": "커브 수수료",
  "Creator fee share": "크리에이터 수수료 비율", "Name": "이름", "Ticker": "티커", "Description": "설명", "Image": "이미지",
  "The image is compressed to fit Ammora's 2 KB on-chain metadata limit.": "이미지는 Ammora의 2KB 온체인 메타데이터 한도에 맞게 압축됩니다.",
  "X / Twitter": "X / 트위터", "Telegram": "텔레그램", "First buy in ETH (optional)": "첫 매수 (ETH, 선택 사항)",
  "Bought in the same transaction as the launch, so no bot can buy before you.": "런칭과 같은 트랜잭션에서 매수되므로 어떤 봇도 먼저 살 수 없습니다.",
  "Connect wallet & launch": "지갑 연결 후 런칭", "Launch token": "토큰 런칭",
  "You become the token's creator and earn the creator share of curve trading fees set by the Config.": "토큰의 크리에이터가 되어 Config에 설정된 커브 거래 수수료의 크리에이터 몫을 받게 됩니다.",
  "What is this token about? Keep it short; it is stored on-chain.": "어떤 토큰인가요? 온체인에 저장되니 짧게 적어주세요.",
  "Launching is not set up yet": "아직 런칭이 설정되지 않았습니다", "Open owner setup": "오너 설정 열기",
  "The image does not fit next to this much text. Shorten the description or links.": "이 정도 텍스트와 함께 이미지를 넣을 수 없습니다. 설명이나 링크를 줄여주세요.",
  "Confirm each step in your wallet.": "각 단계를 지갑에서 확인하세요.",

  // portfolio
  "Your portfolio": "내 포트폴리오", "Holdings": "보유 자산", "To claim": "청구 가능", "Launched": "런칭", "Trades": "거래",
  "Earnings": "수익", "Launches": "런칭", "Activity": "활동", "Wallet": "지갑", "Unwrap": "언래핑",
  "Connect your wallet to see your holdings, earnings, launches and trades.": "지갑을 연결하면 보유 자산, 수익, 런칭, 거래 내역을 볼 수 있습니다.",
  "Trading fees": "거래 수수료", "Your creator and Config-owner share of every bonding-curve trade, across all your launches.": "내 모든 런칭의 본딩 커브 거래에서 발생한 크리에이터 및 Config 오너 몫입니다.",
  "Nothing to claim yet": "아직 청구할 수 있는 수수료가 없습니다", "Claim to wallet": "지갑으로 청구", "Claim": "청구", "Pool fees": "풀 수수료",
  "🔒 Locked forever": "🔒 영구 잠김", "Vesting": "베스팅",
  "This liquidity is locked in the pool forever. It can never be withdrawn, but its trading fees are yours to claim.": "이 유동성은 풀에 영구적으로 잠겨 있어 인출할 수 없지만, 거래 수수료는 청구할 수 있습니다.",
  "When one of your tokens graduates, its pool position earns a fee on every pool trade. Each position is claimed separately. Graduation liquidity is locked in the pool forever, so it can't be withdrawn, but its fees keep coming.":
    "내 토큰이 졸업하면 풀 포지션이 모든 풀 거래에서 수수료를 받습니다. 포지션마다 따로 청구합니다. 졸업 유동성은 풀에 영구적으로 잠겨 인출할 수 없지만, 수수료는 계속 쌓입니다.",
  "You don't hold any launch tokens yet.": "아직 보유한 런칭 토큰이 없습니다.", "Explore launches": "런칭 둘러보기",
  "You haven't launched a token yet.": "아직 런칭한 토큰이 없습니다.", "Launch one": "런칭하기",
  "No trades yet": "아직 거래가 없습니다", "Make your first swap": "첫 스왑 하기", "Received": "수령", "Sent": "전송",

  // leaderboard
  "The most active wallets on tokens launched on Anvora, straight from the chain.": "Anvora에서 런칭된 토큰의 가장 활발한 지갑들을 체인에서 직접 집계합니다.",
  "Top traders": "상위 트레이더", "Top creators": "상위 크리에이터", "Volume": "거래량", "Tokens": "토큰",
  "All-time WETH volume on Anvora tokens, bonding curve and Ammora pool trades included.": "Anvora 토큰의 누적 WETH 거래량입니다 (본딩 커브와 Ammora 풀 거래 포함).",
  "Ranked by tokens graduated, then WETH raised.": "졸업시킨 토큰 수, 그다음 모금된 WETH 순으로 순위를 매깁니다.",
  "No launches yet.": "아직 런칭이 없습니다.", "No trades yet. ": "아직 거래가 없습니다.",

  // bridge & wrap
  "Move ETH from Ethereum Sepolia to GIWA Sepolia to start launching and trading. Deposits arrive in a few minutes.": "Ethereum Sepolia의 ETH를 GIWA Sepolia로 옮겨 런칭과 거래를 시작하세요. 입금은 몇 분 안에 도착합니다.",
  "From": "보내는 곳", "To": "받는 곳", "Official GIWA portal": "GIWA 공식 포털", "Arrives in": "도착 예상", "~1–3 minutes": "약 1–3분",
  "Bridge fee": "브리지 수수료", "None, only Sepolia gas": "없음 (Sepolia 가스비만)", "Bridge to GIWA": "GIWA로 브리지",
  "Your wallet switches to Ethereum Sepolia to sign the deposit, then back to GIWA. Need Sepolia ETH? Try the": "입금 서명을 위해 지갑이 Ethereum Sepolia로 전환된 뒤 다시 GIWA로 돌아옵니다. Sepolia ETH가 필요하다면:",
  "Sepolia faucet": "Sepolia 파우셋", ". Withdrawing back takes ~7 days, see the other tab.": ". 다시 출금하려면 약 7일이 걸립니다. 다른 탭을 참고하세요.",
  "All your Sepolia ETH, minus a little for gas": "가스비를 조금 남기고 모든 Sepolia ETH",
  "Withdrawals from GIWA back to Ethereum go through a challenge period of about": "GIWA에서 Ethereum으로의 출금은 약",
  "7 days": "7일", "and need three steps: start, prove, then finalize. GIWA's official bridge tracks all of them for you.": "의 챌린지 기간을 거치며 시작, 증명, 완료의 세 단계가 필요합니다. GIWA 공식 브리지가 모든 단계를 관리해 줍니다.",
  "Open the official GIWA bridge": "GIWA 공식 브리지 열기",
  "Want to leave GIWA quickly? You don't have to: test ETH on GIWA is free from the": "GIWA를 빨리 떠나고 싶으신가요? 그럴 필요 없습니다. GIWA의 테스트 ETH는 다음에서 무료로 받을 수 있습니다:",
  "GIWA faucet": "GIWA 파우셋",
  "Ammora curves trade against WETH (": "Ammora 커브는 WETH(", "). Buys wrap automatically; use this to wrap or unwrap by hand.": ")로 거래됩니다. 매수 시 자동으로 래핑되며, 여기서 직접 래핑/언래핑할 수도 있습니다.",
  "Connect your wallet to see balances.": "지갑을 연결하면 잔액을 볼 수 있습니다.", "Amount": "금액",
  "Wrap ETH → WETH": "ETH → WETH 래핑", "Unwrap WETH → ETH": "WETH → ETH 언래핑",

  // share sheet
  "Share on X": "X에 공유", "Share via…": "다른 앱으로 공유…", "Copy link": "링크 복사", "Link copied ✓": "링크 복사됨 ✓",
  "Copy failed: long-press the link above": "복사 실패: 위 링크를 길게 눌러 복사하세요",

  // steps, toasts, errors
  "Approve exact amount": "정확한 금액만 승인", "Approve the first buy (exact amount)": "첫 매수 승인 (정확한 금액)",
  "Migrate curve → Ammora pool": "커브 → Ammora 풀 마이그레이션", "Prepare WETH for the first buy": "첫 매수용 WETH 준비",
  "Register Config on-chain": "Config 온체인 등록", "Switch wallet back to GIWA Sepolia": "지갑을 GIWA Sepolia로 다시 전환",
  "Switch wallet to Ethereum Sepolia": "지갑을 Ethereum Sepolia로 전환", "Verify Ammora contracts & Config": "Ammora 컨트랙트 및 Config 확인",
  "Verify Ammora contracts": "Ammora 컨트랙트 확인", "Wait for the ETH to arrive on GIWA": "ETH가 GIWA에 도착할 때까지 대기",
  "Claiming pool fees": "풀 수수료 청구 중", "Claiming trading fees": "거래 수수료 청구 중", "Creating launch Config": "런칭 Config 생성 중",
  "Request rejected in your wallet.": "지갑에서 요청이 거부되었습니다.", "Unknown error": "알 수 없는 오류",
  "Choose a token to swap.": "스왑할 토큰을 선택하세요.", "Enter an amount.": "금액을 입력하세요.", "Invalid amount.": "잘못된 금액입니다.",
  "Name and ticker are required.": "이름과 티커는 필수입니다.", "No account selected.": "선택된 계정이 없습니다.",
  "No browser wallet found. Install MetaMask, Rabby or another EVM wallet.": "브라우저 지갑을 찾을 수 없습니다. MetaMask, Rabby 등 EVM 지갑을 설치하세요.",
  "Not enough ETH for the creation fee, first buy and gas.": "생성 수수료, 첫 매수, 가스비에 필요한 ETH가 부족합니다.",
  "Not visible on GIWA yet. Deposits can take a few more minutes; your ETH is safe and will arrive.": "아직 GIWA에 반영되지 않았습니다. 입금에는 몇 분 더 걸릴 수 있으며, ETH는 안전하게 도착합니다.",
  "Partial sells are not allowed. Try a smaller amount.": "부분 매도는 허용되지 않습니다. 더 적은 금액으로 시도하세요.",
  "Please switch your wallet to GIWA Sepolia.": "지갑을 GIWA Sepolia로 전환하세요.",
  "Switch back to the wallet this portfolio belongs to.": "이 포트폴리오의 지갑으로 다시 전환하세요.",
  "The approval is not visible yet. Wait a few seconds and try again.": "승인이 아직 반영되지 않았습니다. 몇 초 후 다시 시도하세요.",
  "The deposit reverted on Ethereum Sepolia.": "Ethereum Sepolia에서 입금이 실패했습니다.",
  "The first buy is larger than the bonding curve allows. Use a smaller amount.": "첫 매수 금액이 본딩 커브 한도를 초과합니다. 더 적은 금액을 사용하세요.",
  "The image does not fit next to this much text. Shorten the description or remove the image.": "이 정도 텍스트와 함께 이미지를 넣을 수 없습니다. 설명을 줄이거나 이미지를 제거하세요.",
  "The launch Config is not available.": "런칭 Config를 사용할 수 없습니다.",
  "The pool cannot fill this amount. Try a smaller trade.": "풀이 이 금액을 처리할 수 없습니다. 더 작은 거래로 시도하세요.",
  "This address is not an Ammora V4 launch curve.": "이 주소는 Ammora V4 런칭 커브가 아닙니다.",
  "This order cannot be filled in full on the curve. Try a smaller amount.": "이 주문은 커브에서 전부 체결될 수 없습니다. 더 적은 금액으로 시도하세요.",
  "Ticker: 1–12 letters or numbers.": "티커: 영문 또는 숫자 1–12자.",
  "Could not read that image.": "이미지를 읽을 수 없습니다.", "Pool fees claimed.": "풀 수수료가 청구되었습니다.",
  "Fees claimed. They arrive as WETH; unwrap on the Wrap page if you want ETH.": "수수료가 청구되었습니다. WETH로 지급되며, ETH가 필요하면 래핑 페이지에서 언래핑하세요.",
  "Trade complete.": "거래가 완료되었습니다.", "Wrapped.": "래핑되었습니다.", "Unwrapped to ETH.": "ETH로 언래핑되었습니다.", "Swap complete.": "스왑이 완료되었습니다.",
  "Wrapping ETH": "ETH 래핑 중", "Unwrapping WETH": "WETH 언래핑 중",
  "view": "보기",
};

// UI strings with numbers or names inside: [regex, replacement function].
const ago = (n, u) => `${n}${{ m: "분", h: "시간", d: "일" }[u]} 전`;
const KO_PATTERNS = [
  [/^just now$/, () => "방금"],
  [/^(\d+)([mhd]) ago$/, (_, n, u) => ago(n, u)],
  [/^(.*?)(\d+)([mhd]) ago$/, (_, pre, n, u) => `${translate(pre.replace(/ · $/, "").trim()) ?? pre.replace(/ · $/, "").trim()}${pre.endsWith(" · ") ? " · " : " "}${ago(n, u)}`],
  [/^(.*?) · just now$/, (_, pre) => `${translate(pre) ?? pre} · 방금`],
  [/^for (.+) WETH$/, (_, a) => `${a} WETH에`],
  [/^launched$/, () => "런칭됨"],
  [/^(\d[\d,.]*) holders?$/, (_, n) => `홀더 ${n}명`],
  [/^· (\d+) trades?$/, (_, n) => `· 거래 ${n}회`],
  [/^(.+) WETH vol$/, (_, a) => `거래량 ${a} WETH`],
  [/^(.+)% to graduation$/, (_, p) => `졸업까지 ${p}%`],
  [/^(.+) tokens · (.+) WETH$/, (_, a, b) => `${a}개 · ${b} WETH`],
  [/^(.+) tokens$/, (_, a) => `${a}개`],
  [/^Load more \((\d+) left\)$/, (_, n) => `더 보기 (${n}개 남음)`],
  [/^Config #(\d+) · fee (.+)%$/, (_, c, f) => `Config #${c} · 수수료 ${f}%`],
  [/^When (.+) WETH has been raised on the curve, it becomes ready to graduate into a permanent Ammora pool\.$/, (_, a) => `커브에서 ${a} WETH가 모금되면 영구적인 Ammora 풀로 졸업할 준비가 됩니다.`],
  [/^(.+) WETH to graduate$/, (_, a) => `졸업까지 ${a} WETH`],
  [/^Buy \$(.+) →$/, (_, s) => `$${s} 매수 →`],
  [/^Balance: (.+)$/, (_, b) => `잔액: ${b}`],
  [/^Buy \$(.+) on the curve$/, (_, s) => `커브에서 $${s} 매수`],
  [/^Sell \$(.+) on the curve$/, (_, s) => `커브에서 $${s} 매도`],
  [/^Buy \$(.+) in the Ammora pool$/, (_, s) => `Ammora 풀에서 $${s} 매수`],
  [/^Sell \$(.+) in the Ammora pool$/, (_, s) => `Ammora 풀에서 $${s} 매도`],
  [/^Buying \$(.+)$/, (_, s) => `$${s} 매수 중`],
  [/^Selling \$(.+)$/, (_, s) => `$${s} 매도 중`],
  [/^Claim (.+) WETH$/, (_, a) => `${a} WETH 청구`],
  [/^Claim all \((\d+) positions\)$/, (_, n) => `모두 청구 (${n}개 포지션)`],
  [/^Claim fees of (.*)position #(\d+)$/, (_, s, n) => `${s}포지션 #${n} 수수료 청구`],
  [/^Create \$(.+) \+ bonding curve$/, (_, s) => `$${s} + 본딩 커브 생성`],
  [/^Create \$(.+) \+ first buy in one transaction$/, (_, s) => `$${s} 생성 + 첫 매수 (한 번의 트랜잭션)`],
  [/^Deposit (.+) ETH \(Ethereum Sepolia\)$/, (_, a) => `${a} ETH 입금 (Ethereum Sepolia)`],
  [/^Wrap (.+) ETH → WETH$/, (_, a) => `${a} ETH → WETH 래핑`],
  [/^Unwrap (.+) WETH → ETH$/, (_, a) => `${a} WETH → ETH 언래핑`],
  [/^Bridging (.+) ETH to GIWA$/, (_, a) => `${a} ETH를 GIWA로 브리지 중`],
  [/^Launching (.+)$/, (_, n) => `${n} 런칭 중`],
  [/^Bridged! (.+) ETH is on GIWA\.$/, (_, a) => `브리지 완료! ${a} ETH가 GIWA에 도착했습니다.`],
  [/^(.+) confirmed ·$/, (_, l) => `${translate(l) ?? l} 확인됨 ·`],
  [/^(.+) sent ·$/, (_, l) => `${translate(l) ?? l} 전송됨 ·`],
  [/^Deposit sent ·$/, () => "입금 전송됨 ·"],
  [/^\$(.+) is live!(.*)$/, (_, s, rest) => `$${s} 런칭 완료!${rest.includes("first buy is in") ? " 첫 매수가 완료되었습니다." : rest.includes("Confirm your first buy") ? " 토큰 페이지에서 첫 매수를 확인하세요." : ""}`],
  [/^Not enough ETH: you need (.+) more ETH \(plus gas\)\.$/, (_, a) => `ETH가 부족합니다: ${a} ETH(+가스비)가 더 필요합니다.`],
  [/^Not enough ETH on Ethereum Sepolia: you have (.+) ETH\.$/, (_, a) => `Ethereum Sepolia의 ETH가 부족합니다: 현재 ${a} ETH 보유.`],
  [/^Config #(\d+) is disabled\.$/, (_, c) => `Config #${c}가 비활성화되어 있습니다.`],
  [/^Too much text for the on-chain metadata limit \((.+)\)\.$/, (_, b) => `온체인 메타데이터 한도를 초과하는 텍스트입니다 (${b}).`],
  [/^Share (.+)$/, (_, n) => `${n} 공유`],
  [/^Step (\d+) of (\d+)$/, (_, a, b) => `${b}단계 중 ${a}단계`],
];

function translate(s) {
  if (LANG !== "ko" || !s) return null;
  if (Object.prototype.hasOwnProperty.call(KO, s)) return KO[s];
  for (const [re, fn] of KO_PATTERNS) { const m = s.match(re); if (m) return fn(...m); }
  return null;
}
export const t = (s) => translate(s) ?? s;

// Never translate user content: token names, descriptions, addresses, amounts.
const SKIP = "script,style,svg,textarea,input,[data-notr],.mono,.tdesc,.tdesc2,.thead b,.thero h2,.tk-i a > b:not(.good):not(.bad),.pr-main b,.prow b,.prow em";
function trText(node) {
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  if (p.dataset.ko) { if (node.nodeValue !== p.dataset.ko) node.nodeValue = p.dataset.ko; return; }
  const raw = node.nodeValue, s = raw.replace(/\s+/g, " ").trim();
  if (!s || !/[A-Za-z]/.test(s)) return;
  const k = translate(s);
  if (k !== null && k !== s) node.nodeValue = raw.replace(raw.trim(), k);
}
function trAttrs(el) {
  for (const a of ["placeholder", "title", "aria-label"]) {
    const v = el.getAttribute?.(a);
    if (v && /[A-Za-z]/.test(v)) { const k = translate(v.trim()); if (k !== null && k !== v) el.setAttribute(a, k); }
  }
}
function walk(root) {
  if (root.nodeType === 3) return trText(root);
  if (root.nodeType !== 1 || root.closest?.("script,style")) return;
  trAttrs(root);
  root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach(trAttrs);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n; while ((n = w.nextNode())) trText(n);
}

export function initI18n() {
  document.documentElement.lang = LANG;
  const btn = document.getElementById("lang");
  if (btn) {
    btn.textContent = LANG === "ko" ? "EN" : "한국어";
    btn.title = LANG === "ko" ? "Switch to English" : "한국어로 보기";
    btn.setAttribute("aria-label", btn.title);
    btn.onclick = () => setLang(LANG === "ko" ? "en" : "ko");
  }
  if (LANG !== "ko") return;
  walk(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") trText(m.target);
      else if (m.type === "attributes") trAttrs(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
}
