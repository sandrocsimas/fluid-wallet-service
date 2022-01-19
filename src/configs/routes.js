'use strict';

const btcWalletRoutesV1 = require('routes/v1/wallets/btc');

exports.configure = (express, app) => {
  console.log('Configuring routes');
  btcWalletRoutesV1(express, app);
};
