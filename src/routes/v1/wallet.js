'use strict';

const walletService = require('services/wallet');

async function createWallet(req, res) {
  const wallet = await walletService.createWallet();
  res.json(wallet);
}

async function importWallet(req, res) {
  const wallet = await walletService.importWallet(req.body.mnemonic);
  res.json(wallet);
}

async function getWallet(req, res) {
  const wallet = await walletService.getWallet(req.params.address);
  res.json(wallet);
}

async function getWalletTransactions(req, res) {
  const transactions = await walletService.getWalletTransactions(req.params.address);
  res.json(transactions);
}

async function sendToWallet(req, res) {
  const result = await walletService.send(req.body.private_key, req.params.address, req.body.to_address, req.body.amount);
  res.json(result);
}


module.exports = (express, app) => {
  const router = express.Router({mergeParams: true});
  router.post('/', createWallet);
  router.post('/import', importWallet);
  router.get('/:address', getWallet);
  router.get('/:address/transactions', getWalletTransactions);
  router.post('/:address/send', sendToWallet);
  app.use('/v1/wallets', router);
};
