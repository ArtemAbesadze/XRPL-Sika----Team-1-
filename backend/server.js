// backend/server.js
const express = require("express");
const cors    = require("cors");
const path    = require("path");
const vault   = require("./services/vaultService");
const xrpl    = require("./xrpl/client");
const api     = require("./routes/api");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));
app.use("/api", api);
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

async function start() {
  console.log("");
  console.log("🚀 Sika XRPL Savings Gateway — starting…");

  // Always seed demo user immediately so app works right away
  vault.seedDemoUser();

  // Try to connect to XRPL and pre-fund vault wallet in background
  // This doesn't block the server from starting
  xrpl.getVaultWallet()
    .then(vaultWallet => {
      console.log(`🏦 Vault wallet ready: ${vaultWallet.address}`);
      console.log(`🔗 View: https://testnet.xrpl.org/accounts/${vaultWallet.address}`);

      // Update demo user's wallet to the real vault address
      const demo = vault.getUser("demo-user-main");
      if (demo && demo.walletSeed && demo.walletSeed.startsWith("simulated")) {
        // Demo user gets its own real wallet too
        xrpl.createAndFundWallet().then(w => {
          demo.walletAddress = w.address;
          demo.walletSeed    = w.seed;
          console.log(`👤 Demo user wallet funded: ${w.address}`);
        }).catch(() => {
          console.log("⚠️  Demo user keeping simulated wallet (faucet slow)");
        });
      }

      return xrpl.getLatestLedger();
    })
    .then(ledger => {
      if (ledger) console.log(`📖 Current ledger: #${ledger.index}`);
    })
    .catch(err => {
      console.warn(`⚠️  XRPL connection failed: ${err.message}`);
      console.log("📱 App still works — new accounts will use simulated wallets");
      console.log("   (deposits won't show on explorer, but everything else works)");
    });

  if (require.main === module) {
    app.listen(PORT, () => {
      console.log("");
      console.log("════════════════════════════════════════");
      console.log(`✅  Sika running at http://localhost:${PORT}`);
      console.log(`📱  Demo login: phone +233241234567`);
      console.log(`💡  New accounts get real XRPL testnet wallets`);
      console.log("════════════════════════════════════════");
      console.log("");
    });
  }
}

start();

module.exports = app;
