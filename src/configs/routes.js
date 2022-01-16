'use strict';

const walletRoutesV1 = require('routes/v1/wallet');

exports.configure = (express, app) => {
  console.log('Configuring routes');
  walletRoutesV1(express, app);
};
