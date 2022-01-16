'use strict';

require('app-module-path/register');
require('json.date-extensions');

const configs = require('configs');

const routes = require('configs/routes');
const bearerToken = require('express-bearer-token');
const bodyParser = require('body-parser');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const morgan = require('morgan');

JSON.useDateParser();

const app = express();
app.set('env', configs.env);
app.set('port', configs.port);
app.use(cors());
app.use(morgan('tiny', {stream: {write: (message) => console.log(message)}}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(cookieParser());
app.use(compression());
app.use(bearerToken({
  queryKey: 'off',
  bodyKey: 'off',
}));

console.log(`Using ${configs.env} environment settings`);
console.log(`Debug mode is ${configs.debug ? 'ON' : 'OFF'}`);

routes.configure(express, app);

app.listen(app.get('port'), () => {
  console.log(`Wallet service is listening on port ${app.get('port')}`);
});
