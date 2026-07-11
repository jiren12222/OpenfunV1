const PLATFORM_FEE_BPS = 0;
const CREATOR_FEE_BPS = 100;
const VIP_TRADE_THRESHOLD = 10;
const JUPITER_API = 'https://quote-api.jup.ag/v6';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

let platformTokens = [];
let userTrades = [];
let userHoldings = [];

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  const navBtn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
  if (navBtn) navBtn.classList.add('active');
  if (pageId === 'homePage') loadPlatformTokens();
  else if (pageId === 'holdingsPage') loadHoldings();
  else if (pageId === 'profilePage') updateProfileStats();
}

function loadPlatformTokens() {
  const stored = localStorage.getItem('openfun_tokens');
  platformTokens = stored ? JSON.parse(stored) : [];
  renderNewTokens();
  renderTrendingTokens();
}

function savePlatformTokens() {
  localStorage.setItem('openfun_tokens', JSON.stringify(platformTokens));
}

function renderNewTokens() {
  const container = document.getElementById('newTokens');
  if (platformTokens.length === 0) {
    container.innerHTML = '<p class="empty-msg">NO LAUNCHES YET. BE THE FIRST!</p>';
    return;
  }
  const sorted = [...platformTokens].sort((a, b) => b.timestamp - a.timestamp);
  container.innerHTML = sorted.map(token => `
    <div class="token-card" onclick="openTokenDetail('${token.mint}')">
      <span class="token-tag tag-new">NEW</span>
      <img src="${token.image || 'https://via.placeholder.com/200/1a1a1a/a78bfa?text=' + token.symbol}" alt="${token.name}">
      <div class="token-name">${token.name}</div>
      <div class="token-symbol">$${token.symbol}</div>
      <div class="token-price">$${(token.price || 0).toFixed(6)}</div>
      <div class="token-mcap">MCAP: $${formatNumber(token.marketCap || 0)}</div>
    </div>
  `).join('');
}

function renderTrendingTokens() {
  const container = document.getElementById('trendingTokens');
  const trending = [...platformTokens]
    .filter(t => t.volume24h > 0)
    .sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0))
    .slice(0, 10);
  if (trending.length === 0) {
    container.innerHTML = '<p class="empty-msg">NO PLATFORM TOKENS YET. BE THE FIRST TO LAUNCH!</p>';
    container.classList.add('empty');
    return;
  }
  container.classList.remove('empty');
  container.innerHTML = trending.map(token => `
    <div class="token-card" onclick="openTokenDetail('${token.mint}')">
      <span class="token-tag tag-hot">HOT</span>
      <img src="${token.image || 'https://via.placeholder.com/200/1a1a1a/a78bfa?text=' + token.symbol}" alt="${token.name}">
      <div class="token-name">${token.name}</div>
      <div class="token-symbol">$${token.symbol}</div>
      <div class="token-price">$${(token.price || 0).toFixed(6)}</div>
      <div class="token-mcap">VOL: $${formatNumber(token.volume24h || 0)}</div>
    </div>
  `).join('');
}

async function openTokenDetail(mintAddress) {
  const token = platformTokens.find(t => t.mint === mintAddress);
  if (!token) return;
  showPage('tokenDetailPage');
  const content = document.getElementById('tokenDetailContent');
  content.innerHTML = `
    <div class="token-detail">
      <div class="token-detail-header">
        <img src="${token.image || 'https://via.placeholder.com/200/1a1a1a/a78bfa?text=' + token.symbol}" alt="${token.name}">
        <div class="token-detail-info">
          <h1>${token.name}</h1>
          <div class="symbol">$${token.symbol}</div>
        </div>
      </div>
      <div class="token-stats">
        <div class="stat-card">
          <div class="label">PRICE</div>
          <div class="value" id="detailPrice">$${(token.price || 0).toFixed(6)}</div>
        </div>
        <div class="stat-card">
          <div class="label">MARKET CAP</div>
          <div class="value" id="detailMcap">$${formatNumber(token.marketCap || 0)}</div>
        </div>
        <div class="stat-card">
          <div class="label">HOLDERS</div>
          <div class="value" id="detailHolders">${token.holders || 0}</div>
        </div>
        <div class="stat-card">
          <div class="label">24H VOL</div>
          <div class="value" id="detailVol">$${formatNumber(token.volume24h || 0)}</div>
        </div>
      </div>
      <div class="chart-container">
        <iframe src="https://dexscreener.com/solana/${mintAddress}?embed=1&theme=dark&trades=0&info=0" title="DexScreener Chart"></iframe>
      </div>
      <div class="buy-section">
        <h3>BUY $${token.symbol}</h3>
        <div class="buy-input-group">
          <input type="number" id="buyAmount" placeholder="SOL amount" min="0.001" step="0.001">
        </div>
        <button class="btn-buy" onclick="buyToken('${mintAddress}')">BUY NOW</button>
        <div class="contract-box">
          <code id="contractAddr">${mintAddress}</code>
          <button onclick="copyContract('${mintAddress}')">COPY</button>
        </div>
      </div>
    </div>
  `;
  fetchTokenLiveData(mintAddress);
}

async function fetchTokenLiveData(mintAddress) {
  try {
    const resp = await fetch(`${DEXSCREENER_API}/${mintAddress}`);
    const data = await resp.json();
    if (data.pairs && data.pairs.length > 0) {
      const pair = data.pairs[0];
      const priceEl = document.getElementById('detailPrice');
      const mcapEl = document.getElementById('detailMcap');
      const volEl = document.getElementById('detailVol');
      if (priceEl) priceEl.textContent = '$' + parseFloat(pair.priceUsd || 0).toFixed(6);
      if (mcapEl) mcapEl.textContent = '$' + formatNumber(pair.marketCap || pair.fdv || 0);
      if (volEl) volEl.textContent = '$' + formatNumber(pair.volume24h || 0);
      const idx = platformTokens.findIndex(t => t.mint === mintAddress);
      if (idx >= 0) {
        platformTokens[idx].price = parseFloat(pair.priceUsd || 0);
        platformTokens[idx].marketCap = pair.marketCap || pair.fdv || 0;
        platformTokens[idx].volume24h = pair.volume24h || 0;
        savePlatformTokens();
      }
    }
  } catch (err) {
    console.error('DexScreener fetch failed:', err);
  }
}

function copyContract(addr) {
  navigator.clipboard.writeText(addr);
  alert('Contract address copied!');
}

async function buyToken(mintAddress) {
  const amountInput = document.getElementById('buyAmount');
  const solAmount = parseFloat(amountInput?.value || 0);
  if (!solAmount || solAmount < 0.001) {
    alert('Enter at least 0.001 SOL');
    return;
  }
  const pubkey = getWalletPubkey();
  if (!pubkey) {
    alert('Connect wallet first');
    showWalletModal();
    return;
  }
  try {
    const btn = document.querySelector('.btn-buy');
    btn.textContent = 'GETTING QUOTE...';
    btn.disabled = true;
    const quoteResp = await fetch(
      `${JUPITER_API}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mintAddress}&amount=${Math.floor(solAmount * 1e9)}&slippageBps=100`
    );
    const quote = await quoteResp.json();
    if (quote.error) throw new Error(quote.error);
    btn.textContent = 'CONFIRMING...';
    const swapResp = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: pubkey,
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: 10000
      })
    });
    const swapData = await swapResp.json();
    if (swapData.error) throw new Error(swapData.error);
    btn.textContent = 'SIGNING...';
    const txBuffer = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = solanaWeb3.VersionedTransaction.deserialize(txBuffer);
    const signed = await currentWallet.signTransaction(transaction);
    btn.textContent = 'SENDING...';
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      maxRetries: 3,
      skipPreflight: false
    });
    await connection.confirmTransaction(signature, 'confirmed');
    btn.textContent = 'BOUGHT! ✅';
    btn.style.background = '#a78bfa';
    recordTrade('buy', mintAddress, solAmount, signature);
    addHolding(mintAddress, solAmount);
    setTimeout(() => {
      btn.textContent = 'BUY NOW';
      btn.disabled = false;
      btn.style.background = '';
    }, 3000);
  } catch (err) {
    console.error('Buy failed:', err);
    alert('Buy failed: ' + err.message);
    const btn = document.querySelector('.btn-buy');
    btn.textContent = 'BUY NOW';
    btn.disabled = false;
  }
}

document.getElementById('launchBtn')?.addEventListener('click', async () => {
  const pubkey = getWalletPubkey();
  if (!pubkey) {
    alert('Connect wallet first to launch a token');
    showWalletModal();
    return;
  }
  const name = document.getElementById('tokenName').value.trim();
  const symbol = document.getElementById('tokenSymbol').value.trim().toUpperCase();
  const desc = document.getElementById('tokenDesc').value.trim();
  const supply = parseInt(document.getElementById('tokenSupply').value);
  const imageFile = document.getElementById('tokenImage').files[0];
  if (!name || !symbol) {
    alert('Name and symbol required');
    return;
  }
  const status = document.getElementById('launchStatus');
  const btn = document.getElementById('launchBtn');
  try {
    btn.disabled = true;
    status.className = 'launch-status loading';
    status.textContent = 'CREATING SPL TOKEN...';
    let imageUrl = '';
    if (imageFile) imageUrl = await readFileAsDataURL(imageFile);
    const mintKeypair = solanaWeb3.Keypair.generate();
    const mintPubkey = mintKeypair.publicKey;
    status.textContent = 'BUILDING TRANSACTION...';
    const lamports = await connection.getMinimumBalanceForRentExemption(82);
    const createAccountIx = solanaWeb3.SystemProgram.createAccount({
      fromPubkey: new solanaWeb3.PublicKey(pubkey),
      newAccountPubkey: mintPubkey,
      space: 82,
      lamports: lamports,
      programId: splToken.TOKEN_PROGRAM_ID
    });
    const initMintIx = splToken.createInitializeMintInstruction(
      mintPubkey,
      9,
      new solanaWeb3.PublicKey(pubkey),
      new solanaWeb3.PublicKey(pubkey),
      splToken.TOKEN_PROGRAM_ID
    );
    const associatedTokenAccount = await splToken.getAssociatedTokenAddress(
      mintPubkey,
      new solanaWeb3.PublicKey(pubkey)
    );
    const createATAIx = splToken.createAssociatedTokenAccountInstruction(
      new solanaWeb3.PublicKey(pubkey),
      associatedTokenAccount,
      new solanaWeb3.PublicKey(pubkey),
      mintPubkey
    );
    const mintToIx = splToken.createMintToInstruction(
      mintPubkey,
      associatedTokenAccount,
      new solanaWeb3.PublicKey(pubkey),
      supply,
      [],
      splToken.TOKEN_PROGRAM_ID
    );
    const transaction = new solanaWeb3.Transaction();
    transaction.add(createAccountIx, initMintIx, createATAIx, mintToIx);
    status.textContent = 'SIGNING TRANSACTION...';
    const signature = await signAndSendTransaction(transaction, [mintKeypair]);
    status.className = 'launch-status success';
    status.innerHTML = `TOKEN LAUNCHED! <a href="https://solscan.io/tx/${signature}" target="_blank" style="color:#a78bfa">View TX</a>`;
    const newToken = {
      mint: mintPubkey.toString(),
      name: name,
      symbol: symbol,
      description: desc,
      image: imageUrl,
      supply: supply,
      creator: pubkey,
      timestamp: Date.now(),
      price: 0,
      marketCap: 0,
      volume24h: 0,
      holders: 1,
      txSignature: signature
    };
    platformTokens.push(newToken);
    savePlatformTokens();
    recordLaunch();
    document.getElementById('tokenName').value = '';
    document.getElementById('tokenSymbol').value = '';
    document.getElementById('tokenDesc').value = '';
    document.getElementById('tokenImage').value = '';
    btn.disabled = false;
    setTimeout(() => {
      showPage('homePage');
      loadPlatformTokens();
    }, 2000);
  } catch (err) {
    console.error('Launch failed:', err);
    status.className = 'launch-status error';
    status.textContent = 'LAUNCH FAILED: ' + err.message;
    btn.disabled = false;
  }
});

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function signAndSendTransaction(transaction, additionalSigners = []) {
  if (!currentWallet || !currentPublicKey) throw new Error('Wallet not connected');
  const pubKey = new solanaWeb3.PublicKey(currentPublicKey);
  transaction.feePayer = pubKey;
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  if (additionalSigners.length > 0) transaction.partialSign(...additionalSigners);
  const signed = await currentWallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    maxRetries: 3,
    skipPreflight: false
  });
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

function loadHoldings() {
  const pubkey = getWalletPubkey();
  const container = document.getElementById('holdingsList');
  const emptyState = document.getElementById('holdingsEmpty');
  if (!pubkey) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    emptyState.querySelector('p').textContent = 'CONNECT WALLET TO VIEW HOLDINGS';
    return;
  }
  const stored = localStorage.getItem('openfun_holdings_' + pubkey);
  userHoldings = stored ? JSON.parse(stored) : [];
  if (userHoldings.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    emptyState.querySelector('p').textContent = 'NO HOLDINGS YET';
    return;
  }
  emptyState.style.display = 'none';
  container.innerHTML = userHoldings.map(h => {
    const token = platformTokens.find(t => t.mint === h.mint);
    return `
      <div class="token-card" onclick="openTokenDetail('${h.mint}')">
        <img src="${token?.image || 'https://via.placeholder.com/200/1a1a1a/a78bfa?text=?'}" alt="${token?.name || 'Token'}">
        <div class="token-name">${token?.name || 'Unknown'}</div>
        <div class="token-symbol">$${token?.symbol || '???'}</div>
        <div class="token-price">${h.amount.toFixed(4)} tokens</div>
        <div class="token-mcap">Bought: ${h.solAmount.toFixed(3)} SOL</div>
      </div>
    `;
  }).join('');
}

function addHolding(mint, solAmount) {
  const pubkey = getWalletPubkey();
  if (!pubkey) return;
  const existing = userHoldings.find(h => h.mint === mint);
  if (existing) {
    existing.amount += solAmount * 1000;
    existing.solAmount += solAmount;
  } else {
    userHoldings.push({
      mint: mint,
      amount: solAmount * 1000,
      solAmount: solAmount,
      timestamp: Date.now()
    });
  }
  localStorage.setItem('openfun_holdings_' + pubkey, JSON.stringify(userHoldings));
}

function recordTrade(type, mint, amount, signature) {
  const pubkey = getWalletPubkey();
  if (!pubkey) return;
  const trade = { type, mint, amount, signature, timestamp: Date.now() };
  const stored = localStorage.getItem('openfun_trades_' + pubkey);
  const trades = stored ? JSON.parse(stored) : [];
  trades.push(trade);
  localStorage.setItem('openfun_trades_' + pubkey, JSON.stringify(trades));
  checkVIPStatus();
}

function recordLaunch() {
  const pubkey = getWalletPubkey();
  if (!pubkey) return;
  const stored = localStorage.getItem('openfun_launches_' + pubkey);
  const count = stored ? parseInt(stored) + 1 : 1;
  localStorage.setItem('openfun_launches_' + pubkey, count.toString());
}

function updateProfileStats() {
  const pubkey = getWalletPubkey();
  if (!pubkey) {
    document.getElementById('tradeCount').textContent = '0';
    document.getElementById('launchCount').textContent = '0';
    document.getElementById('creatorFees').textContent = '0 SOL';
    document.getElementById('vipBadge').classList.add('hidden');
    document.getElementById('vipBtn').disabled = true;
    return;
  }
  const tradesStored = localStorage.getItem('openfun_trades_' + pubkey);
  const trades = tradesStored ? JSON.parse(tradesStored) : [];
  document.getElementById('tradeCount').textContent = trades.length;
  const launchesStored = localStorage.getItem('openfun_launches_' + pubkey);
  document.getElementById('launchCount').textContent = launchesStored || '0';
  let totalFees = 0;
  const myTokens = platformTokens.filter(t => t.creator === pubkey);
  myTokens.forEach(token => {
    totalFees += (token.volume24h || 0) * 0.01;
  });
  document.getElementById('creatorFees').textContent = totalFees.toFixed(4) + ' SOL';
  const isVIP = trades.length >= VIP_TRADE_THRESHOLD;
  if (isVIP) {
    document.getElementById('vipBadge').classList.remove('hidden');
    document.getElementById('vipBtn').disabled = false;
  } else {
    document.getElementById('vipBadge').classList.add('hidden');
    document.getElementById('vipBtn').disabled = true;
    document.getElementById('vipBtn').textContent = `NEED ${VIP_TRADE_THRESHOLD - trades.length} MORE TRADES FOR VIP`;
  }
}

function checkVIPStatus() {
  const pubkey = getWalletPubkey();
  if (!pubkey) return;
  const tradesStored = localStorage.getItem('openfun_trades_' + pubkey);
  const trades = tradesStored ? JSON.parse(tradesStored) : [];
  if (trades.length >= VIP_TRADE_THRESHOLD) {
    if (document.getElementById('profilePage').classList.contains('active')) {
      updateProfileStats();
    }
  }
}

document.getElementById('claimFeesBtn')?.addEventListener('click', async () => {
  const pubkey = getWalletPubkey();
  if (!pubkey) {
    alert('Connect wallet first');
    return;
  }
  alert('Creator fees claimed! (In production: transfers to your wallet)');
  document.getElementById('creatorFees').textContent = '0 SOL';
});

function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

document.addEventListener('DOMContentLoaded', () => {
  loadPlatformTokens();
  updateProfileStats();
  setInterval(() => {
    if (document.getElementById('homePage').classList.contains('active')) {
      loadPlatformTokens();
    }
  }, 30000);
});
