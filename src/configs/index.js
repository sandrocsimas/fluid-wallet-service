'use strict';

const path = require('path');
const yaml = require('yamljs');
const _ = require('lodash');

const configs = yaml.load(path.resolve('configs.yaml'));

function get(property, defaultValue) {
  return _.get(configs, property, defaultValue);
}

function getRequired(property) {
  const value = _.get(configs, property);
  if (!value) {
    throw new Error(`Property "${property}" is required`);
  }
  return value;
}

exports.env = get('app.env', 'development');
exports.port = get('app.port', 3000);
exports.debug = get('app.debug', false);

exports.wallets = getRequired('app.wallets');
