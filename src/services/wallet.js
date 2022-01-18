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
const Promise = require("bluebird");
const _ = require('lodash');

const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');
const {BIP32Factory} = require('bip32');
const {ECPairFactory} = require('ecpair');
const ecc = require('tiny-secp256k1');
const sb = require('satoshi-bitcoin');
const coinSelect = require('coinselect');
const jayson = require('jayson/promise');

const NETWORK_NAME = configs.wallets.btc.network;
const NETWORK = bitcoin.networks[NETWORK_NAME];

const SCRIPT_PUB_KEY_TYPES = {
  p2pkh: bitcoin.payments.p2pkh,
  p2sh: bitcoin.payments.p2sh,
  p2wpkh: bitcoin.payments.p2wpkh,
};

const electrumXClient = jayson.Client.tls({
  port: 50002,
  rejectUnauthorized: false,
});

const bitcoindClient = jayson.Client.http({
  auth: 'rpcuser:rpcpass',
  port: 8332,
});

function getAddressTypeConfig(address) {
  return _.find(btcConfig.address_types[NETWORK_NAME], (addressType) => addressType.prefixes.some((prefix) => address.startsWith(prefix)));
}

function getAddressType(address) {
  return _.findKey(btcConfig.address_types[NETWORK_NAME], (addressType) => addressType.prefixes.some((prefix) => address.startsWith(prefix)));
}

function getDerivationPath(scriptPubKeyType = 'p2wpkh') {
  return btcConfig.address_types[NETWORK_NAME][scriptPubKeyType].derivationPath;
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
  const account = root.derivePath(getDerivationPath(scriptPubKeyType));
  const node = account.derive(0).derive(0);

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

async function callElectrumX(method, params) {
  const response = await electrumXClient.request(method, params);
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

exports.createWallet = async function(scriptPubKeyType) {
  const mnemonic = bip39.generateMnemonic();
  return getWalletDetails(mnemonic, scriptPubKeyType);
};

exports.importWallet = async function(mnemonic, scriptPubKeyType) {
  const valid = bip39.validateMnemonic(mnemonic);
  if (!valid) {
    throw new Error('Invalid recovery phrase');
  }
  return getWalletDetails(mnemonic, scriptPubKeyType);
};

exports.getWallet = async function(address) {
  const balance = await callElectrumX('blockchain.scripthash.get_balance', [getScriptHash(address)]);
  return {
    address,
    address_type: getAddressType(address),
    balance: {
      confirmed: sb.toBitcoin(balance.confirmed),
      unconfirmed: sb.toBitcoin(balance.unconfirmed),
    },
  };
};

exports.listWalletTransactions = async function(address) {
  const transactions = await callElectrumX('blockchain.scripthash.get_history', [getScriptHash(address)]);
  const transactionsPromises = transactions.map((transaction) => callElectrumX('blockchain.transaction.get', [transaction.tx_hash, true]));
  const detailedTransactions = await Promise.all(transactionsPromises);
  return detailedTransactions.reverse();
};

exports.send = async function(privateKey, fromAddress, toAddress, amount) {
  const keyPair = ecpairFactory.fromWIF(privateKey, NETWORK);
  const scriptPubKey = getScriptPubKey(keyPair.publicKey);
  const addressTypeConfig = getAddressTypeConfig(fromAddress);

  const estimatedFee = await callBitcoind('estimatesmartfee', [1]);
  if (estimatedFee.errors) {
    throw new Error('Error estimating fee');
  }

  const feeRate = sb.toSatoshi(estimatedFee.feerate);
  const utxos = (await callElectrumX('blockchain.scripthash.listunspent', [getScriptHash(fromAddress)])).filter((utxo) => utxo.height > 0);
  const target = {
    address: toAddress,
    value: sb.toSatoshi(amount),
  };

  const {inputs, outputs, fee} = coinSelect(utxos, [target], feeRate)
  if (!inputs || !outputs) {
    throw new Error('No inputs or outputs provided to create transaction');
  }

  const psbt = new bitcoin.Psbt({network: NETWORK});

  for (const input of inputs) {
    const rawTx = await callElectrumX('blockchain.transaction.get', [input.tx_hash]);
    const psbtInput = {
      hash: input.tx_hash,
      index: input.tx_pos,
    };
    if (addressTypeConfig.segwit) {
      psbtInput.witnessUtxo = {
        script: scriptPubKey.output,
        value: input.value,
      };
    } else {
      psbtInput.nonWitnessUtxo = Buffer.from(rawTx, 'hex');
    }
    console.log(psbtInput)
    psbt.addInput(psbtInput);
  }

  outputs.forEach((output) => {
    if (!output.address) {
      output.address = fromAddress;
    }
    psbt.addOutput({
      address: output.address,
      value: output.value,
    });
  });

  psbt.signAllInputs(keyPair);
  if (!psbt.validateSignaturesOfAllInputs(validateSignature)) {
    throw new Error('Invalid signature');
  }
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  await callElectrumX('blockchain.transaction.broadcast', [tx.toHex()]);
  return {
    transaction_id: tx.getId(),
  };
};
