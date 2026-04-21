// backend/xrpl/client.js
// Handles all XRP Ledger Testnet interactions
// Real: wallet creation, funding, XRP payments, account info
// Mocked: RLUSD trust lines (testnet RLUSD issuer not always stable)

const xrpl = require("xrpl");

const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
const FAUCET_URL  = "https://faucet.altnet.rippletest.net/accounts";

// In a real deployment these come from env + HSM
// For demo: generated fresh each run, stored in memory
let _client = null;
let _vaultWallet = null; // the "Sika vault" wallet on testnet

// ─────────────────────────────────────────
// CONNECTION
// ─────────────────────────────────────────
async function getClient() {
  if (_client && _client.isConnected()) return _client;
  _client = new xrpl.Client(TESTNET_URL);
  await _client.connect();
  console.log("✅ Connected to XRPL Testnet:", TESTNET_URL);
  return _client;
}

async function disconnect() {
  if (_client && _client.isConnected()) {
    await _client.disconnect();
    console.log("🔌 Disconnected from XRPL");
  }
}

// ─────────────────────────────────────────
// WALLET MANAGEMENT
// ─────────────────────────────────────────

// Create a brand-new testnet wallet and fund it via faucet
async function createAndFundWallet() {
  const client = await getClient();
  console.log("🔧 Generating new wallet + requesting testnet XRP from faucet…");
  const { wallet, balance } = await client.fundWallet(null, { faucetHost: null });
  console.log(`✅ Wallet funded: ${wallet.address} | Balance: ${balance} XRP`);
  return {
    address:    wallet.address,
    seed:       wallet.seed,
    publicKey:  wallet.publicKey,
    privateKey: wallet.privateKey,
    balance:    balance,
  };
}

// Load wallet from seed (for returning users / vault wallet)
function loadWallet(seed) {
  return xrpl.Wallet.fromSeed(seed);
}

// Get or create the vault wallet (singleton for demo)
async function getVaultWallet() {
  if (_vaultWallet) return _vaultWallet;
  // In production this comes from secure storage
  // For demo: create fresh if not cached
  const data = await createAndFundWallet();
  _vaultWallet = loadWallet(data.seed);
  _vaultWallet.address = data.address;
  console.log("🏦 Vault wallet ready:", _vaultWallet.address);
  return _vaultWallet;
}

// ─────────────────────────────────────────
// ACCOUNT INFO
// ─────────────────────────────────────────
async function getAccountInfo(address) {
  const client = await getClient();
  try {
    const response = await client.request({
      command: "account_info",
      account: address,
      ledger_index: "validated",
    });
    const info = response.result.account_data;
    return {
      address:        info.Account,
      xrpBalance:     xrpl.dropsToXrp(info.Balance),
      sequence:       info.Sequence,
      exists:         true,
    };
  } catch (err) {
    if (err.data?.error === "actNotFound") {
      return { address, xrpBalance: "0", sequence: 0, exists: false };
    }
    throw err;
  }
}

async function getTransactionHistory(address, limit = 10) {
  const client = await getClient();
  try {
    const response = await client.request({
      command:       "account_tx",
      account:       address,
      limit:         limit,
      ledger_index_min: -1,
      ledger_index_max: -1,
    });
    return response.result.transactions.map(t => ({
      hash:          t.tx.hash,
      type:          t.tx.TransactionType,
      amount:        t.tx.Amount,
      destination:   t.tx.Destination,
      account:       t.tx.Account,
      fee:           t.tx.Fee,
      ledger:        t.tx.ledger_index,
      date:          t.tx.date,
      successful:    t.meta?.TransactionResult === "tesSUCCESS",
    }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────
// TRANSACTIONS
// ─────────────────────────────────────────

// Send XRP from one wallet to another (real testnet transaction)
// In production this would be RLUSD; for demo we use XRP drops
// as a stand-in for RLUSD (XRPL testnet RLUSD is unstable)
async function sendPayment({ fromSeed, toAddress, amountXrp, memoText }) {
  const client   = await getClient();
  const wallet   = xrpl.Wallet.fromSeed(fromSeed);

  const payment = {
    TransactionType: "Payment",
    Account:         wallet.address,
    Destination:     toAddress,
    Amount:          xrpl.xrpToDrops(amountXrp.toString()),
  };

  // Attach memo (used to tag deposit/withdraw operations)
  if (memoText) {
    payment.Memos = [{
      Memo: {
        MemoData: Buffer.from(memoText, "utf8").toString("hex").toUpperCase(),
        MemoType: Buffer.from("sika/op", "utf8").toString("hex").toUpperCase(),
      },
    }];
  }

  const prepared = await client.autofill(payment);
  const signed   = wallet.sign(prepared);
  const result   = await client.submitAndWait(signed.tx_blob);

  const success  = result.result.meta.TransactionResult === "tesSUCCESS";
  return {
    success,
    hash:            signed.hash,
    ledgerIndex:     result.result.ledger_index,
    fee:             prepared.Fee,
    result:          result.result.meta.TransactionResult,
    explorerUrl:     `https://testnet.xrpl.org/transactions/${signed.hash}`,
  };
}

// "Deposit to vault" — user sends XRP to vault address
// Represents depositing RLUSD into the savings vault
async function depositToVault({ userSeed, amountXrp, userId }) {
  const vault = await getVaultWallet();
  return sendPayment({
    fromSeed:  userSeed,
    toAddress: vault.address,
    amountXrp,
    memoText:  `SIKA:DEPOSIT:${userId}`,
  });
}

// "Withdraw from vault" — vault sends XRP back to user
async function withdrawFromVault({ userAddress, amountXrp, userId }) {
  const vault  = await getVaultWallet();
  const client = await getClient();

  // Check vault has enough
  const info   = await getAccountInfo(vault.address);
  const vaultBal = parseFloat(info.xrpBalance);
  // Keep 2 XRP reserve
  if (vaultBal - amountXrp < 2) {
    throw new Error(`Vault balance insufficient. Has ${vaultBal} XRP, needs ${amountXrp} + 2 reserve.`);
  }

  return sendPayment({
    fromSeed:  vault.seed,
    toAddress: userAddress,
    amountXrp,
    memoText:  `SIKA:WITHDRAW:${userId}`,
  });
}

// Get latest validated ledger (for live display)
async function getLatestLedger() {
  const client = await getClient();
  const response = await client.request({ command: "ledger", ledger_index: "validated" });
  return {
    index:    response.result.ledger.ledger_index,
    hash:     response.result.ledger.ledger_hash,
    closeTime: response.result.ledger.close_time_human,
    txCount:  response.result.ledger.transaction_hash,
  };
}

// ─────────────────────────────────────────
// RLUSD (MOCKED FOR DEMO)
// Testnet RLUSD issuer is not reliably available.
// We track RLUSD balances in our own database and
// use real XRP transactions as the on-chain proof-of-work.
// In production: replace with actual RLUSD trust line + IOU.
// ─────────────────────────────────────────
const RLUSD_RATE    = 1.00;    // RLUSD is pegged 1:1 to USD
const GHS_RATE      = 11.47;   // GHS per USD (mock, would be live feed)
const VAULT_ADDRESS_PLACEHOLDER = "rSikaVaultDemoXXXXXXXXXXXXXXXXXX";

function xrpToRlusd(xrpAmount) {
  // For demo: 1 XRP = 1 RLUSD (simplification)
  // In production: use AMM price from XRPL DEX
  return parseFloat(xrpAmount).toFixed(6);
}

function ghsToRlusd(ghs) {
  return (parseFloat(ghs) / GHS_RATE).toFixed(4);
}

function rlusdToGhs(rlusd) {
  return (parseFloat(rlusd) * GHS_RATE).toFixed(2);
}

module.exports = {
  getClient,
  disconnect,
  createAndFundWallet,
  loadWallet,
  getVaultWallet,
  getAccountInfo,
  getTransactionHistory,
  sendPayment,
  depositToVault,
  withdrawFromVault,
  getLatestLedger,
  xrpToRlusd,
  ghsToRlusd,
  rlusdToGhs,
  GHS_RATE,
  RLUSD_RATE,
};
