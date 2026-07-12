const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const {
  Connection, Keypair, PublicKey, Transaction, SystemProgram,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const {
  createMint, getOrCreateAssociatedTokenAccount, mintTo,
  createSetAuthorityInstruction, AuthorityType
} = require('@solana/spl-token');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ==================== CONFIG ====================
const HELIUS_RPC = 'https://devnet.helius-rpc.com/?api-key=3b40bb84-eb28-4b1e-9cdb-cc93fb602326';
const TREASURY = '7cTdE23rMWkTNwtc1WLSDZSAzQSzBPmnpBLHtgG9oGFt';
const TARGET_SOL = 85;
const VIRTUAL_SOL = 30;
const FEE_PERCENT = 0.02; // 2% total
const CREATOR_FEE_PERCENT = 0.01; // 1% to creator
const PLATFORM_FEE_PERCENT = 0.01; // 1% to platform

// Backend wallet (token creator)
function base58Decode(str) {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const map = new Map([...alphabet].map((c, i) => [c, BigInt(i)]));
    let num = BigInt(0);
    for (const char of str) {
        num = num * BigInt(58) + map.get(char);
    }
    const bytes = [];
    while (num > BigInt(0)) {
        bytes.unshift(Number(num % BigInt(256)));
        num = num / BigInt(256);
    }
    for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.unshift(0);
    return new Uint8Array(bytes);
}

const BACKEND_SECRET_KEY = base58Decode('3WQMZE2eGLo7xi2qvHBcFN4SPccu3DbaiaGiKAZdcpjcipDT6oE8a5pfWewcxD3zF4K2TQB9MG1JJhyL1LcVhHNi');
const backendWallet = Keypair.fromSecretKey(BACKEND_SECRET_KEY);
const conn = new Connection(HELIUS_RPC, 'confirmed');

// In-memory storage (use Redis/DB in production)
const tokens = new Map();
const trades = [];

// ==================== UTILS ====================
function formatNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(4);
}

function getBondingCurveState(token) {
  const realSol = token.real_sol || 0.5;
  const virtualSol = token.virtual_sol || VIRTUAL_SOL;
  const totalSol = virtualSol + realSol;
  const totalTokens = token.total_tokens_in_curve || (token.supply * 1.073);
  const k = totalSol * totalTokens;
  return { realSol, virtualSol, totalSol, totalTokens, k };
}

function getPrice(token) {
  const state = getBondingCurveState(token);
  return state.totalSol / state.totalTokens;
}

function getMarketCap(token) {
  return getPrice(token) * token.supply;
}

function getBuyAmount(token, solAmount) {
  const state = getBondingCurveState(token);
  const fee = solAmount * FEE_PERCENT;
  const effectiveSol = solAmount - fee;
  const newTotalSol = state.totalSol + effectiveSol;
  const tokensOut = state.totalTokens - (state.k / newTotalSol);
  return tokensOut;
}

function getSellAmount(token, tokenAmount) {
  const state = getBondingCurveState(token);
  const newTotalTokens = state.totalTokens + tokenAmount;
  const newTotalSol = state.k / newTotalTokens;
  const solOut = state.totalSol - newTotalSol;
  return solOut * (1 - FEE_PERCENT);
}

function getProgress(token) {
  const realSol = token.real_sol || 0.5;
  return Math.min((realSol / TARGET_SOL) * 100, 100);
}

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', wallet: TREASURY });
});

// ==================== LAUNCH TOKEN ====================
app.post('/launch', async (req, res) => {
  try {
    const { name, symbol, image, supply, creator } = req.body;
    
    if (!name || !symbol || !supply || !creator) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create new mint
    const mintKeypair = Keypair.generate();
    
    // Create mint account
    const mint = await createMint(
      conn,
      backendWallet,
      backendWallet.publicKey,
      null,
      9 // 9 decimals
    );

    // Create metadata account (simplified - would use Metaplex in production)
    // For now, store metadata in our database
    
    const totalTokens = parseInt(supply);
    const tokensInCurve = Math.floor(totalTokens * 1.073);
    const virtualTokens = Math.floor(totalTokens * 0.2799);
    const realTokens = tokensInCurve - virtualTokens;
    const initialPrice = VIRTUAL_SOL / tokensInCurve;

    const tokenData = {
      mint: mint.toString(),
      name,
      symbol,
      image,
      supply: totalTokens,
      creator,
      created_at: Date.now(),
      virtual_sol: VIRTUAL_SOL,
      real_sol: 0.5,
      total_tokens_in_curve: tokensInCurve,
      virtual_tokens: virtualTokens,
      real_tokens: realTokens,
      price: initialPrice,
      mcap_usd: initialPrice * totalTokens,
      holders: 1,
      graduated: false,
      first_buy_done: false,
      dexscreener_url: null,
      volume_24h: 0
    };

    tokens.set(mint.toString(), tokenData);

    // Mint total supply to backend wallet first
    const backendATA = await getOrCreateAssociatedTokenAccount(
      conn, backendWallet, mint, backendWallet.publicKey
    );
    
    await mintTo(
      conn, backendWallet, mint, backendATA.address, backendWallet,
      totalTokens
    );

    // Revoke mint authority (fixed supply)
    const revokeTx = new Transaction().add(
      createSetAuthorityInstruction(
        mint,
        backendWallet.publicKey,
        AuthorityType.MintTokens,
        null
      )
    );
    await sendAndConfirmTransaction(conn, revokeTx, [backendWallet]);

    res.json({ success: true, token: tokenData });

  } catch (e) {
    console.error('Launch error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== BUY TOKEN ====================
app.post('/buy', async (req, res) => {
  try {
    const { mint, buyer, solAmount } = req.body;
    const token = tokens.get(mint);
    
    if (!token) return res.status(404).json({ error: 'Token not found' });
    if (token.graduated) return res.status(400).json({ error: 'Token graduated' });

    const amount = parseFloat(solAmount);
    const fee = amount * FEE_PERCENT;
    const creatorFee = amount * CREATOR_FEE_PERCENT;
    const platformFee = amount * PLATFORM_FEE_PERCENT;
    const tradeAmount = amount - fee;

    // Calculate tokens out
    const tokensOut = getBuyAmount(token, amount);

    // Update token state
    token.real_sol += tradeAmount;
    token.total_tokens_in_curve -= tokensOut;
    token.holders += 1;
    token.price = getPrice(token);
    token.mcap_usd = getMarketCap(token);
    token.volume_24h += amount;

    // Record trade
    trades.push({
      type: 'buy',
      mint,
      buyer,
      solAmount: amount,
      tokensOut,
      fee,
      timestamp: Date.now()
    });

    // Check graduation
    if (token.real_sol >= TARGET_SOL && !token.graduated) {
      token.graduated = true;
      token.graduated_at = Date.now();
    }

    // First buy check
    if (!token.first_buy_done) {
      token.first_buy_done = true;
      // Trigger DexScreener (in production, create pool)
    }

    res.json({
      success: true,
      tokensOut,
      price: token.price,
      mcap: token.mcap_usd,
      graduated: token.graduated
    });

  } catch (e) {
    console.error('Buy error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== SELL TOKEN ====================
app.post('/sell', async (req, res) => {
  try {
    const { mint, seller, tokenAmount } = req.body;
    const token = tokens.get(mint);
    
    if (!token) return res.status(404).json({ error: 'Token not found' });

    const amount = parseFloat(tokenAmount);
    const solOut = getSellAmount(token, amount);
    const fee = solOut * FEE_PERCENT;
    const creatorFee = solOut * CREATOR_FEE_PERCENT;
    const netSol = solOut - fee;

    // Update token state
    token.real_sol = Math.max(0, token.real_sol - solOut);
    token.total_tokens_in_curve += amount;
    token.holders = Math.max(1, token.holders - 1);
    token.price = getPrice(token);
    token.mcap_usd = getMarketCap(token);
    token.volume_24h += solOut;

    // Record trade
    trades.push({
      type: 'sell',
      mint,
      seller,
      tokenAmount: amount,
      solOut: netSol,
      fee,
      timestamp: Date.now()
    });

    res.json({
      success: true,
      solOut: netSol,
      price: token.price,
      mcap: token.mcap_usd
    });

  } catch (e) {
    console.error('Sell error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==================== GET TOKEN ====================
app.get('/token/:mint', (req, res) => {
  const token = tokens.get(req.params.mint);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  
  token.progress = getProgress(token);
  res.json(token);
});

// ==================== LIST TOKENS ====================
app.get('/tokens', (req, res) => {
  const allTokens = Array.from(tokens.values());
  res.json(allTokens);
});

// ==================== GET TRADES ====================
app.get('/trades/:mint', (req, res) => {
  const mintTrades = trades.filter(t => t.mint === req.params.mint);
  res.json(mintTrades);
});

// ==================== START ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OpenFun backend running on port ${PORT}`);
  console.log(`Wallet: ${TREASURY}`);
});
