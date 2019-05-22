import * as moment from 'moment';

import {FlowNodeInstance, FlowNodeInstanceState, IFlowNodeInstanceRepository} from '@process-engine/flow_node_instance.contracts';
import {ActiveToken, FlowNodeRuntimeInformation, IKpiApi} from '@process-engine/kpi_api_contracts';
import {IMetricsRepository, Metric, MetricMeasurementPoint} from '@process-engine/metrics_api_contracts';

import {IIAMService, IIdentity} from '@essential-projects/iam_contracts';

/**
 * Groups Metrics by their FlowNodeIds.
 *
 * Only use internally.
 */
type FlowNodeGroups = {
  [flowNodeId: string]: Array<Metric>;
};

/**
 * Groups Metrics by their FlowNodeInstanceIds.
 *
 * Only use internally.
 */
type FlowNodeInstanceGroups = {
  [flowNodeInstanceId: string]: Array<Metric>;
};

/**
 * Contains the quartile runtime data for a FlowNode.
 *
 * Only use internally.
 */
type QuartileInfos = {
  firstQuartile: number;
  median: number;
  thirdQuartile: number;
};

export class KpiApiService implements IKpiApi {

  private iamService: IIAMService;
  private flowNodeInstanceRepository: IFlowNodeInstanceRepository;
  private metricsRepository: IMetricsRepository;

  constructor(
    flowNodeInstanceRepository: IFlowNodeInstanceRepository,
    iamService: IIAMService,
    metricsRepository: IMetricsRepository,
  ) {
    this.flowNodeInstanceRepository = flowNodeInstanceRepository;
    this.iamService = iamService;
    this.metricsRepository = metricsRepository;
  }

  public async getRuntimeInformationForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<FlowNodeRuntimeInformation>> {

    const metrics = await this.metricsRepository.readMetricsForProcessModel(processModelId);

    // Do not include FlowNode instances which are still being executed,
    // since they do net yet have a final runtime.
    const filteredMetrics = metrics.filter(this.metricBelongsToFinishedFlowNodeInstance);

    const metricsGroupedByFlowNodeId = this.groupFlowNodeInstancesByFlowNodeId(filteredMetrics);

    const groupKeys = Object.keys(metricsGroupedByFlowNodeId);

    const runtimeInformations = groupKeys.map((flowNodeId: string): FlowNodeRuntimeInformation => {
      return this.createFlowNodeRuntimeInformation(processModelId, flowNodeId, metricsGroupedByFlowNodeId[flowNodeId]);
    });

    return Promise.resolve(runtimeInformations);
  }

  public async getRuntimeInformationForFlowNode(
    identity: IIdentity,
    processModelId: string,
    flowNodeId: string,
  ): Promise<FlowNodeRuntimeInformation> {

    const metrics = await this.metricsRepository.readMetricsForProcessModel(processModelId);

    const flowNodeMetrics = metrics.filter((entry: Metric): boolean => {
      return entry.flowNodeId === flowNodeId;
    });

    // Do not include FlowNode instances which are still being executed,
    // since they do net yet have a final runtime.
    const filteredMetrics = flowNodeMetrics.filter(this.metricBelongsToFinishedFlowNodeInstance);

    const flowNodeRuntimeInformation = this.createFlowNodeRuntimeInformation(processModelId, flowNodeId, filteredMetrics);

    return flowNodeRuntimeInformation;
  }

  public async getActiveTokensForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<ActiveToken>> {

    const flowNodeInstances = await this.flowNodeInstanceRepository.queryByProcessModel(processModelId);

    const activeFlowNodeInstances = flowNodeInstances.filter(this.isFlowNodeInstanceActive);

    const activeTokenInfos = activeFlowNodeInstances.map(this.createActiveTokenInfoForFlowNodeInstance);

    return activeTokenInfos;
  }

  public async getActiveTokensForCorrelationAndProcessModel(
    identity: IIdentity,
    correlationId: string,
    processModelId: string,
  ): Promise<Array<ActiveToken>> {

    const activeFlowNodeInstances = await this.flowNodeInstanceRepository.queryActiveByCorrelationAndProcessModel(correlationId, processModelId);

    const activeTokenInfos = activeFlowNodeInstances.map(this.createActiveTokenInfoForFlowNodeInstance);

    return activeTokenInfos;
  }

  public async getActiveTokensForProcessInstance(
    identity: IIdentity,
    processInstanceId: string,
  ): Promise<Array<ActiveToken>> {

    const activeFlowNodeInstances = await this.flowNodeInstanceRepository.queryActiveByProcessInstance(processInstanceId);

    const activeTokenInfos = activeFlowNodeInstances.map(this.createActiveTokenInfoForFlowNodeInstance);

    return activeTokenInfos;
  }

  public async getActiveTokensForFlowNode(identity: IIdentity, flowNodeId: string): Promise<Array<ActiveToken>> {

    const flowNodeInstances = await this.flowNodeInstanceRepository.queryByFlowNodeId(flowNodeId);

    const activeFlowNodeInstances = flowNodeInstances.filter(this.isFlowNodeInstanceActive);

    const activeTokenInfos = activeFlowNodeInstances.map(this.createActiveTokenInfoForFlowNodeInstance);

    return activeTokenInfos;
  }

  /**
   * Array-Filter that checks if a given metric entry is suitable for including
   * it into the runtime calculations.
   *
   * First, it determines if the metric was recorded when the FlowNodeInstance
   * was finished. If so, it is a valid metric entry.
   *
   * If it is a metric that was recorded at the beginnng of a FlowNodeInstance
   * execution, the function checks if a corresponding exiting metric exists.
   *
   * If one is found, the metric is suitable for including it with runtime
   * calculation.
   *
   * If no matching exiting metric could be found, then this likely means the
   * FlowNodeInstance is still running. The metric will not be included in the
   * calculations.
   *
   * @param   metricToCheck      The metric to validate.
   * @param   metricIndex        The index the metric has in the given Array.
   * @param   allFlowNodeMetrics The full Array that is curently being filtered.
   * @returns                    True, if the metric belongs to a finished
   *                             FlowNodeInstance, otherwise false.
   */
  private metricBelongsToFinishedFlowNodeInstance(metricToCheck: Metric, metricIndex: number, allFlowNodeMetrics: Array<Metric>): boolean {

    const metricDoesNotBelongToAFlowNodeInstance = !metricToCheck.flowNodeInstanceId || !metricToCheck.flowNodeId;

    if (metricDoesNotBelongToAFlowNodeInstance) {
      return false;
    }

    const metricWasRecordedOnFlowNodeExit = metricToCheck.metricType === MetricMeasurementPoint.onFlowNodeExit;
    if (metricWasRecordedOnFlowNodeExit) {
      return true;
    }

    const hasMatchingExitMetric = allFlowNodeMetrics.some((entry: Metric): boolean => {

      const belongsToSameFlowNodeInstance = metricToCheck.flowNodeInstanceId === entry.flowNodeInstanceId;

      const hasMatchingState =
        !(entry.metricType === MetricMeasurementPoint.onFlowNodeEnter || entry.metricType === MetricMeasurementPoint.onFlowNodeSuspend);

      return belongsToSameFlowNodeInstance && hasMatchingState;
    });

    return hasMatchingExitMetric;
  }

  private groupFlowNodeInstancesByFlowNodeId(metrics: Array<Metric>): FlowNodeGroups {

    const groupedMetrics: FlowNodeGroups = {};

    for (const metric of metrics) {

      const groupHasNoMatchingEntry = !groupedMetrics[metric.flowNodeId];

      if (groupHasNoMatchingEntry) {
        groupedMetrics[metric.flowNodeId] = [];
      }

      groupedMetrics[metric.flowNodeId].push(metric);
    }

    return groupedMetrics;
  }

  private createFlowNodeRuntimeInformation(processModelId: string, flowNodeId: string, metrics: Array<Metric>): FlowNodeRuntimeInformation {

    const groupedMetrics = this.groupMetricsByFlowNodeInstance(metrics);

    const flowNodeInstanceId = Object.keys(groupedMetrics);

    const runtimes = flowNodeInstanceId.map((flowNodeInstanceKey: string): number => {
      return this.calculateRuntimeForFlowNodeInstance(groupedMetrics[flowNodeInstanceKey]);
    });

    const quartileInfos = this.calculateQuartiles(runtimes);

    const runtimeInformation = new FlowNodeRuntimeInformation();
    runtimeInformation.flowNodeId = flowNodeId;
    runtimeInformation.processModelId = processModelId;
    runtimeInformation.minRuntimeInMs = Math.min(...runtimes);
    runtimeInformation.maxRuntimeInMs = Math.max(...runtimes);
    runtimeInformation.arithmeticMeanRuntimeInMs = this.calculateFlowNodeArithmeticMeanRuntime(runtimes);
    runtimeInformation.firstQuartileRuntimeInMs = quartileInfos.firstQuartile;
    runtimeInformation.medianRuntimeInMs = quartileInfos.median;
    runtimeInformation.thirdQuartileRuntimeInMs = quartileInfos.thirdQuartile;

    return runtimeInformation;
  }

  private groupMetricsByFlowNodeInstance(metrics: Array<Metric>): FlowNodeInstanceGroups {

    const groupedMetrics = {};

    for (const metric of metrics) {

      const groupHasNoMatchingEntry = !groupedMetrics[metric.flowNodeInstanceId];

      if (groupHasNoMatchingEntry) {
        groupedMetrics[metric.flowNodeInstanceId] = [];
      }

      groupedMetrics[metric.flowNodeInstanceId].push(metric);
    }

    return groupedMetrics;
  }

  private calculateRuntimeForFlowNodeInstance(metrics: Array<Metric>): number {

    const onEnterMetric = metrics.find((token: Metric): boolean => {
      return token.metricType === MetricMeasurementPoint.onFlowNodeEnter;
    });

    const onExitMetric = metrics.find((token: Metric): boolean => {
      return token.metricType === MetricMeasurementPoint.onFlowNodeExit ||
             token.metricType === MetricMeasurementPoint.onFlowNodeError;
    });

    const startTime = moment(onEnterMetric.timeStamp);
    const endTime = moment(onExitMetric.timeStamp);

    const runtimeDiff = endTime.diff(startTime);
    const runtimeTotal = moment
      .duration(runtimeDiff)
      .asMilliseconds();

    return runtimeTotal;
  }

  private calculateQuartiles(runtimes: Array<number>): QuartileInfos {

    const runtimeAmounts = runtimes.length;

    const sortedRuntimes = runtimes.sort((prevValue: number, currentValue: number): number => {
      return prevValue - currentValue;
    });

    let quartileAmounts: number;
    let medianAmounts: number;

    let firstQuartileData: Array<number>;
    let medianQuartileData: Array<number>;
    let thirdQuartileData: Array<number>;

    // tslint:disable:no-magic-numbers
    if (runtimeAmounts >= 3) {
      // We have enough data to reasonably extrapolate the quartiles.
      quartileAmounts = Math.floor(runtimes.length / 4);
      medianAmounts = Math.ceil(runtimes.length / 2);

      firstQuartileData = sortedRuntimes.slice(0, quartileAmounts);
      medianQuartileData = sortedRuntimes.slice(quartileAmounts, quartileAmounts + medianAmounts);
      thirdQuartileData = sortedRuntimes.slice(sortedRuntimes.length - quartileAmounts);
    } else {
      // There is not enough data to reasonably extrapolate quartiles.
      // Use all available data for each quartile instead.
      quartileAmounts = runtimeAmounts;
      medianAmounts = runtimeAmounts;

      firstQuartileData = sortedRuntimes;
      medianQuartileData = sortedRuntimes;
      thirdQuartileData = sortedRuntimes;
    }

    const firstQuartileRuntime = this.calculateFlowNodeArithmeticMeanRuntime(firstQuartileData);
    const medianQuartileRuntime = this.calculateFlowNodeArithmeticMeanRuntime(medianQuartileData);
    const thirdQuartileRuntime = this.calculateFlowNodeArithmeticMeanRuntime(thirdQuartileData);

    return {
      firstQuartile: firstQuartileRuntime,
      median: medianQuartileRuntime,
      thirdQuartile: thirdQuartileRuntime,
    };
  }

  private calculateFlowNodeArithmeticMeanRuntime(runtimes: Array<number>): number {

    const allRuntimes = runtimes.reduce((previousValue: number, currentValue: number): number => {
      return previousValue + currentValue;
    }, 0);

    const meanRuntime = Math.round(allRuntimes / runtimes.length);

    return meanRuntime;
  }

  private isFlowNodeInstanceActive(flowNodeInstance: FlowNodeInstance): boolean {
    return flowNodeInstance.state === FlowNodeInstanceState.running
      || flowNodeInstance.state === FlowNodeInstanceState.suspended;
  }

  private createActiveTokenInfoForFlowNodeInstance(flowNodeInstance: FlowNodeInstance): ActiveToken {

    const currentProcessToken = flowNodeInstance.tokens[0];

    const activeTokenInfo = new ActiveToken();
    activeTokenInfo.processInstanceId = currentProcessToken.processInstanceId;
    activeTokenInfo.processModelId = currentProcessToken.processModelId;
    activeTokenInfo.correlationId = currentProcessToken.correlationId;
    activeTokenInfo.flowNodeId = flowNodeInstance.flowNodeId;
    activeTokenInfo.flowNodeInstanceId = flowNodeInstance.id;
    activeTokenInfo.identity = currentProcessToken.identity;
    activeTokenInfo.createdAt = currentProcessToken.createdAt;
    activeTokenInfo.payload = currentProcessToken.payload;

    return activeTokenInfo;
  }

}
