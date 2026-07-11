const NETWORK = 'https://api.mainnet-beta.solana.com';
const connection = new solanaWeb3.Connection(NETWORK, 'confirmed');

let currentWallet = null;
let currentPublicKey = null;

const WALLETS = [
  { name: 'Phantom', id: 'phantom', icon: 'https://phantom.app/img/phantom-icon-purple.png' },
  { name: 'Solflare', id: 'solflare', icon: 'https://solflare.com/assets/logo-icon.png' },
  { name: 'Backpack', id: 'backpack', icon: 'https://backpack.app/assets/logo.png' },
  { name: 'Slope', id: 'slope', icon: 'https://slope.finance/assets/logo.png' },
  { name: 'Coin98', id: 'coin98', icon: 'https://coin98.com/assets/logo.png' }
];

function detectWallets() {
  const available = [];
  if (window.solana && window.solana.isPhantom) available.push(WALLETS[0]);
  if (window.solflare) available.push(WALLETS[1]);
  if (window.backpack) available.push(WALLETS[2]);
  if (window.slope) available.push(WALLETS[3]);
  if (window.coin98) available.push(WALLETS[4]);
  if (available.length === 0) return WALLETS;
  return available;
}

function showWalletModal() {
  const modal = document.getElementById('walletModal');
  const list = document.getElementById('walletList');
  const wallets = detectWallets();
  list.innerHTML = wallets.map(w => `
    <div class="wallet-option" onclick="connectWallet('${w.id}')">
      <img src="${w.icon}" alt="${w.name}" onerror="this.style.display='none'">
      <span>${w.name}</span>
    </div>
  `).join('');
  modal.classList.add('active');
}

function closeWalletModal() {
  document.getElementById('walletModal').classList.remove('active');
}

async function connectWallet(walletId) {
  closeWalletModal();
  try {
    let provider = null;
    switch(walletId) {
      case 'phantom': provider = window.solana; break;
      case 'solflare': provider = window.solflare; break;
      case 'backpack': provider = window.backpack; break;
      case 'slope': provider = window.slope; break;
      case 'coin98': provider = window.coin98; break;
    }
    if (!provider) {
      alert('Please install ' + walletId.charAt(0).toUpperCase() + walletId.slice(1) + ' wallet extension');
      return;
    }
    const resp = await provider.connect();
    currentPublicKey = resp.publicKey.toString();
    currentWallet = provider;
    localStorage.setItem('openfun_wallet', walletId);
    localStorage.setItem('openfun_pubkey', currentPublicKey);
    updateWalletUI();
    await updateBalance();
    if (typeof loadHoldings === 'function') loadHoldings();
  } catch (err) {
    console.error('Wallet connection failed:', err);
    alert('Connection failed: ' + err.message);
  }
}

function disconnectWallet() {
  if (currentWallet && currentWallet.disconnect) currentWallet.disconnect();
  currentWallet = null;
  currentPublicKey = null;
  localStorage.removeItem('openfun_wallet');
  localStorage.removeItem('openfun_pubkey');
  updateWalletUI();
}

function updateWalletUI() {
  const btn = document.getElementById('walletBtn');
  if (currentPublicKey) {
    btn.textContent = currentPublicKey.slice(0, 4) + '...' + currentPublicKey.slice(-4);
    btn.classList.add('connected');
    btn.onclick = disconnectWallet;
    const profileWallet = document.getElementById('profileWallet');
    if (profileWallet) profileWallet.textContent = currentPublicKey;
  } else {
    btn.textContent = 'CONNECT WALLET';
    btn.classList.remove('connected');
    btn.onclick = showWalletModal;
    const profileWallet = document.getElementById('profileWallet');
    if (profileWallet) profileWallet.textContent = 'NOT CONNECTED';
  }
}

async function updateBalance() {
  if (!currentPublicKey) return;
  try {
    const pubKey = new solanaWeb3.PublicKey(currentPublicKey);
    const balance = await connection.getBalance(pubKey);
    const solBalance = balance / solanaWeb3.LAMPORTS_PER_SOL;
    const profileBalance = document.getElementById('profileBalance');
    if (profileBalance) profileBalance.textContent = solBalance.toFixed(4) + ' SOL';
  } catch (err) {
    console.error('Balance fetch failed:', err);
  }
}

async function autoReconnect() {
  const savedWallet = localStorage.getItem('openfun_wallet');
  const savedPubkey = localStorage.getItem('openfun_pubkey');
  if (savedWallet && savedPubkey) {
    let provider = null;
    switch(savedWallet) {
      case 'phantom': provider = window.solana; break;
      case 'solflare': provider = window.solflare; break;
      case 'backpack': provider = window.backpack; break;
      case 'slope': provider = window.slope; break;
      case 'coin98': provider = window.coin98; break;
    }
    if (provider && provider.isConnected) {
      currentWallet = provider;
      currentPublicKey = savedPubkey;
      updateWalletUI();
      await updateBalance();
    }
  }
}

function getWalletPubkey() {
  return currentPublicKey;
}

async function signAndSendTransaction(transaction) {
  if (!currentWallet || !currentPublicKey) throw new Error('Wallet not connected');
  const pubKey = new solanaWeb3.PublicKey(currentPublicKey);
  transaction.feePayer = pubKey;
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  const signed = await currentWallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('walletBtn').onclick = showWalletModal;
  setTimeout(autoReconnect, 500);
});
