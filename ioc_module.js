'use strict';

const KpiApiService = require('./dist/commonjs/index').KpiApiService;

function registerInContainer(container) {

  container
    .register('KpiApiService', KpiApiService)
    .dependencies('IamService', 'FlowNodeInstanceRepository', 'LoggingRepository')
    .singleton();
}

module.exports.registerInContainer = registerInContainer;
