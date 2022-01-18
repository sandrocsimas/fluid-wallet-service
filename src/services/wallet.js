'use strict';

// Segwit address
// {
//   "address": "bcrt1q8yu68tvmqrxtn528vujhz96x9zxfnmhhn9j78x",
//   "mnemonic": "october eager misery laptop shop boost long abandon fan junior desert legend",
//   "seed": "af17861266f67b25b826d69ff24992d11c9381c4d958ff8af7cf73ce31a4ddd3a1ee978a8e9865fe7fddc793635a453685bd3160caf344f298a85866f57ff816",
//   "public_key": "02e8979ad58a8e592a015c5aa9967b5dbd22647d5e842be87238fbea8e78d5de65",
//   "private_key": "cTuc3sRj3jhYMorfAj9TkyKYQ7BXQyUzqfHM9R4Yawhh1FpCtGgM",
//   "address_type": "p2wpkh"
// }

// Non Segwit address
// {
//   "address": "mus1omSG8Dxy7KxEBZ1i21sH8juWKZJ8h9",
//   "mnemonic": "mutual response neither patient mouse pride pledge angle few stem practice snack",
//   "seed": "1234be2a2a2daa50060aea5a18669034ba4f7203a6c1eb5ba154efc70f88a2239fd97233c48a7ac1ce4175178cbeb7733fe68250988b18a477fe20459efbea27",
//   "public_key": "03c1ad2457c9276d5d9ce727c8432ec21a33e6067c5d48517ebea845033b1dcd77",
//   "private_key": "cPPm59wuD9oUS8R1w1hVhTKKxFfdoLKotg4TFkTmLqZL2vQuCAZp",
//   "address_type": "p2pkh"
// }

const configs = require('configs');
const btcConfig = require('configs/btc.json');

const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');
const {BIP32Factory} = require('bip32');
const {ECPairFactory} = require('ecpair');
const ecc = require('tiny-secp256k1');
const sb = require('satoshi-bitcoin');
const coinSelect = require('coinselect');
const jayson = require('jayson/promise');
const Promise = require('bluebird');
const _ = require('lodash');

const btcEnvConfig = configs.wallets.btc;

const NETWORK = bitcoin.networks[btcEnvConfig.network];

const SCRIPT_PUB_KEY_TYPES = {
  p2pkh: bitcoin.payments.p2pkh,
  p2wpkh: bitcoin.payments.p2wpkh,
};

const bip32Factory = BIP32Factory(ecc);
const ecpairFactory = ECPairFactory(ecc);

const electrumxClient = jayson.Client.tls({
  port: btcEnvConfig.electrumx.rpcPort,
  rejectUnauthorized: false,
});

const bitcoindClient = jayson.Client.http({
  auth: `${btcEnvConfig.bitcoind.rpcUser}:${btcEnvConfig.bitcoind.rpcPass}`,
  port: btcEnvConfig.bitcoind.rpcPort,
});

function getAddressTypeConfig(address) {
  return _.find(btcConfig.address_types[btcEnvConfig.network], (addressType) => addressType.prefixes.some((prefix) => address.startsWith(prefix)));
}

function getAddressType(address) {
  return _.findKey(btcConfig.address_types[btcEnvConfig.network], (addressType) => addressType.prefixes.some((prefix) => address.startsWith(prefix)));
}

function getDerivationPath(scriptPubKeyType = 'p2wpkh') {
  return btcConfig.address_types[btcEnvConfig.network][scriptPubKeyType].derivationPath;
}

function getScriptPubKey(publicKey, scriptPubKeyType = 'p2wpkh') {
  return SCRIPT_PUB_KEY_TYPES[scriptPubKeyType]({
    pubkey: publicKey,
    network: NETWORK,
  });
}

async function getWalletDetails(mnemonic, scriptPubKeyType) {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32Factory.fromSeed(seed, NETWORK);
  const node = root.derivePath(getDerivationPath(scriptPubKeyType));
  const {address} = getScriptPubKey(node.publicKey, scriptPubKeyType);
  return {
    address,
    mnemonic,
    seed: seed.toString('hex'),
    public_key: node.publicKey.toString('hex'),
    private_key: node.toWIF(),
    address_type: getAddressType(address),
  };
}

async function callElectrumx(method, params) {
  const response = await electrumxClient.request(method, params);
  return response.result;
}

async function callBitcoind(method, params) {
  const response = await bitcoindClient.request(method, params);
  return response.result;
}

function getScriptHash(address) {
  const script = bitcoin.address.toOutputScript(address, NETWORK);
  const hash = bitcoin.crypto.sha256(script);
  return Buffer.from(hash.reverse()).toString('hex');
}

function validateSignature(pubkey, msghash, signature) {
  return ecpairFactory.fromPublicKey(pubkey).verify(msghash, signature);
}

exports.createWallet = (scriptPubKeyType) => {
  const mnemonic = bip39.generateMnemonic();
  return getWalletDetails(mnemonic, scriptPubKeyType);
};

exports.importWallet = (mnemonic, scriptPubKeyType) => {
  const valid = bip39.validateMnemonic(mnemonic);
  if (!valid) {
    throw new Error('Invalid recovery phrase');
  }
  return getWalletDetails(mnemonic, scriptPubKeyType);
};

exports.getWallet = async (address) => {
  const balance = await callElectrumx('blockchain.scripthash.get_balance', [getScriptHash(address)]);
  return {
    address,
    address_type: getAddressType(address),
    balance: {
      confirmed: sb.toBitcoin(balance.confirmed),
      unconfirmed: sb.toBitcoin(balance.unconfirmed),
    },
  };
};

exports.listTransactions = async (address) => {
  const transactions = await callElectrumx('blockchain.scripthash.get_history', [getScriptHash(address)]);
  const transactionsPromises = transactions.map((transaction) => callElectrumx('blockchain.transaction.get', [transaction.tx_hash, true]));
  const detailedTransactions = await Promise.all(transactionsPromises);
  return detailedTransactions.reverse();
};

exports.prepareTransaction = async (fromAddress, toAddress, changeAddress, amount) => {
  let estimatedFee = await callBitcoind('estimatesmartfee', [1]);
  if (estimatedFee.errors) {
    if (btcEnvConfig.network === 'mainnet') {
      throw new Error('Error estimating fee');
    }
    estimatedFee = {feerate: 0.000001};
  }

  const feeRate = sb.toSatoshi(estimatedFee.feerate);
  const utxos = (await callElectrumx('blockchain.scripthash.listunspent', [getScriptHash(fromAddress)])).filter((utxo) => utxo.height > 0);
  const target = {
    address: toAddress,
    value: sb.toSatoshi(amount),
  };

  const selection = coinSelect(utxos, [target], feeRate);
  if (!selection.inputs || !selection.outputs) {
    throw new Error('No inputs or outputs provided to create transaction');
  }
  return {
    inputs: selection.inputs.map((input) => ({hash: input.tx_hash, vout: input.tx_pos, value: input.value})),
    outputs: selection.outputs.map((output) => (output.address ? output : {address: changeAddress || fromAddress, value: output.value})),
    fee: selection.fee,
  };
};

exports.broadcastTransaction = async (transactionHex) => {
  await callElectrumx('blockchain.transaction.broadcast', [transactionHex]);
  return {};
};

exports.send = async (privateKey, fromAddress, toAddress, changeAddress, amount) => {
  const keyPair = ecpairFactory.fromWIF(privateKey, NETWORK);

  const psbt = new bitcoin.Psbt({network: NETWORK});

  const {inputs, outputs} = await this.prepareTransaction(fromAddress, toAddress, changeAddress, amount);

  const addressTypeConfig = getAddressTypeConfig(fromAddress);
  Promise.all(inputs.map(async (input) => {
    const psbtInput = {
      hash: input.hash,
      index: input.vout,
    };
    if (addressTypeConfig.segwit) {
      const scriptPubKey = getScriptPubKey(keyPair.publicKey);
      psbtInput.witnessUtxo = {
        script: scriptPubKey.output,
        value: input.value,
      };
    } else {
      const rawTx = await callElectrumx('blockchain.transaction.get', [input.hash]);
      psbtInput.nonWitnessUtxo = Buffer.from(rawTx, 'hex');
    }
    psbt.addInput(psbtInput);
  }));

  outputs.forEach((output) => {
    psbt.addOutput({
      address: output.address || fromAddress,
      value: output.value,
    });
  });

  psbt.signAllInputs(keyPair);
  if (!psbt.validateSignaturesOfAllInputs(validateSignature)) {
    throw new Error('Invalid signature');
  }
  psbt.finalizeAllInputs();

  const transaction = psbt.extractTransaction();
  this.broadcastTransaction(transaction.toHex());
  return {
    transaction_id: transaction.getId(),
  };
};
