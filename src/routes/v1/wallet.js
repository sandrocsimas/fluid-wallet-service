'use strict';

const walletService = require('services/wallet');

async function createWallet(req, res) {
  const wallet = await walletService.createWallet(req.query.address_type);
  res.json(wallet);
}

async function importWallet(req, res) {
  const wallet = await walletService.importWallet(req.body.mnemonic, req.query.address_type);
  res.json(wallet);
}

async function getWallet(req, res) {
  const wallet = await walletService.getWallet(req.params.address);
  res.json(wallet);
}

async function listTransactions(req, res) {
  const transactions = await walletService.listTransactions(req.params.address);
  res.json(transactions);
}

async function prepareTransaction(req, res) {
  const result = await walletService.prepareTransaction(req.params.address, req.body.to_address, req.body.change_address, req.body.amount);
  res.json(result);
}

async function broadcastTransaction(req, res) {
  const result = await walletService.broadcastTransaction(req.body.tx_hex);
  res.json(result);
}

async function sendToWallet(req, res) {
  const result = await walletService.send(req.body.private_key, req.params.address, req.body.to_address, req.body.change_address, req.body.amount);
  res.json(result);
}

module.exports = (express, app) => {
  const router = express.Router({mergeParams: true});
  router.post('/', createWallet);
  router.post('/import', importWallet);
  router.get('/:address', getWallet);
  router.get('/:address/transactions', listTransactions);
  router.post('/:address/transactions/prepare', prepareTransaction);
  router.post('/:address/transactions/broadcast', broadcastTransaction);
  router.post('/:address/send', sendToWallet);
  app.use('/v1/wallets', router);
};
