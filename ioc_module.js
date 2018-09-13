'use strict';

const KpiApiService = require('./dist/commonjs/index').KpiApiService;

function registerInContainer(container) {

  container
    .register('KpiApiService', KpiApiService)
    .dependencies('FlowNodeInstanceRepository', 'IamService', 'MetricsRepository')
    .singleton();
}

module.exports.registerInContainer = registerInContainer;
