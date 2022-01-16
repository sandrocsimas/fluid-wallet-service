'use strict';

// bunker mammal hammer daughter tent cherry youth movie cute nephew picture script
const jayson = require('jayson/promise');
const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');
const {BIP32Factory} = require('bip32');
const {ECPairFactory} = require('ecpair');
const ecc = require('tiny-secp256k1');
const sb = require('satoshi-bitcoin');
const coinSelect = require('coinselect')

const network = bitcoin.networks.regtest;
const explorerUrl = 'https://blockchain.info';

const bip32Factory = BIP32Factory(ecc);
const ecpairFactory = ECPairFactory(ecc);

const rpcClient = jayson.Client.tls({
  port: 50002,
  rejectUnauthorized: false,
});

async function getWalletDetails(mnemonic) {
  const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32Factory.fromSeed(seedBuffer, network);
  const account = root.derivePath("m/44'/0'/0'");
  const node = account.derive(0).derive(0);

  const address = bitcoin.payments.p2pkh({
    pubkey: node.publicKey,
    network: network
  }).address;
  return {
    address,
    mnemonic,
    seed: seedBuffer.toString('hex'),
    public_key: node.publicKey.toString('hex'),
    private_key: node.toWIF(),
  };
}

async function callRPC(method, params) {
  const response = await rpcClient.request(method, params);
  return response.result;
}

function getScriptHash(address) {
  const script = bitcoin.address.toOutputScript(address, network);
  const hash = bitcoin.crypto.sha256(script);
  return Buffer.from(hash.reverse()).toString('hex');
}

function validateSignature(pubkey, msghash, signature) {
  return ecpairFactory.fromPublicKey(pubkey).verify(msghash, signature);
}

exports.createWallet = async function() {
  const mnemonic = bip39.generateMnemonic();
  return getWalletDetails(mnemonic);
};

exports.importWallet = async function(mnemonic) {
  const valid = bip39.validateMnemonic(mnemonic);
  if (!valid) {
    throw new Error('Invalid recovery phrase');
  }
  return getWalletDetails(mnemonic);
};

exports.getWallet = async function(address) {
  const balance = await callRPC('blockchain.scripthash.get_balance', [getScriptHash(address)]);
  return {
    address: address,
    balance: {
      confirmed: sb.toBitcoin(balance.confirmed),
      unconfirmed: sb.toBitcoin(balance.unconfirmed),
    },
  };
};

exports.getWalletTransactions = async function(address) {
  const transactions = await callRPC('blockchain.scripthash.get_history', [getScriptHash(address)]);
  return transactions.reverse();
};

exports.send = async function(privateKey, fromAddress, toAddress, amount) {
  const feeRate = 55;
  const utxos = (await callRPC('blockchain.scripthash.listunspent', [getScriptHash(fromAddress)])).filter((utxo) => utxo.height > 0);
  const target = {
    address: toAddress,
    value: sb.toSatoshi(amount),
  };

  const {inputs, outputs, fee} = coinSelect(utxos, [target], feeRate)
  console.log(inputs, outputs, fee)
  if (!inputs || !outputs) {
    throw new Error('No inputs or outputs to create transaction');
  }

  const psbt = new bitcoin.Psbt({network})
  for (const input of inputs) {
    const rawTx = await callRPC('blockchain.transaction.get', [input.tx_hash]);
    psbt.addInput({
      hash: input.tx_hash,
      index: input.tx_pos,
      nonWitnessUtxo: Buffer.from(rawTx, 'hex'),
    });
  }

  outputs.forEach((output) => {
    if (!output.address) {
      output.address = fromAddress;
    }
    psbt.addOutput({
      address: output.address,
      value: output.value,
    })
  })

  psbt.signAllInputs(ecpairFactory.fromWIF(privateKey, network));
  if (!psbt.validateSignaturesOfAllInputs(validateSignature)) {
    throw new Error('Invalid signature');
  }
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  const result = await callRPC('blockchain.transaction.broadcast', [tx.toHex()]);
  return {
    transaction_id: tx.getId(),
  }
};
