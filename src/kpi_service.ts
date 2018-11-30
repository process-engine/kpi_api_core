import * as moment from 'moment';

import {ActiveToken, FlowNodeRuntimeInformation, IKpiApi} from '@process-engine/kpi_api_contracts';
import {IMetricsRepository, Metric, MetricMeasurementPoint} from '@process-engine/metrics_api_contracts';
import {IFlowNodeInstanceRepository, Runtime} from '@process-engine/process_engine_contracts';

import {IIAMService, IIdentity} from '@essential-projects/iam_contracts';

/**
 * Groups Metrics by their FlowNodeIds.
 *
 * Only use internally.
 */
type FlowNodeGroups = {
  [flowNodeId: string]: Array<Metric>,
};

/**
 * Groups Metrics by their FlowNodeInstanceIds.
 *
 * Only use internally.
 */
type FlowNodeInstanceGroups = {
  [flowNodeInstanceId: string]: Array<Metric>,
};

/**
 * Contains the quartile runtime data for a FlowNode.
 *
 * Only use internally.
 */
type QuartileInfos = {
  firstQuartile: number,
  median: number,
  thirdQuartile: number,
};

export class KpiApiService implements IKpiApi {

  private _iamService: IIAMService;
  private _flowNodeInstanceRepository: IFlowNodeInstanceRepository;
  private _metricsRepository: IMetricsRepository;

  constructor(flowNodeInstanceRepository: IFlowNodeInstanceRepository,
              iamService: IIAMService,
              metricsRepository: IMetricsRepository,
             ) {
    this._flowNodeInstanceRepository = flowNodeInstanceRepository;
    this._iamService = iamService;
    this._metricsRepository = metricsRepository;
  }

  private get flowNodeInstanceRepository(): IFlowNodeInstanceRepository {
    return this._flowNodeInstanceRepository;
  }

  private get iamService(): IIAMService {
    return this._iamService;
  }

  private get metricsRepository(): IMetricsRepository {
    return this._metricsRepository;
  }

  public async getRuntimeInformationForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<FlowNodeRuntimeInformation>> {

    const metrics: Array<Metric> = await this.metricsRepository.readMetricsForProcessModel(processModelId);

    // Do not include FlowNode instances which are still being executed,
    // since they do net yet have a final runtime.
    const filteredMetrics: Array<Metric> = metrics.filter(this._metricBelongsToFinishedFlowNodeInstance);

    const metricsGroupedByFlowNodeId: FlowNodeGroups = this._groupFlowNodeInstancesByFlowNodeId(filteredMetrics);

    const groupKeys: Array<string> = Object.keys(metricsGroupedByFlowNodeId);

    const runtimeInformations: Array<FlowNodeRuntimeInformation> =
      groupKeys.map((flowNodeId: string): FlowNodeRuntimeInformation => {
        return this._createFlowNodeRuntimeInformation(processModelId, flowNodeId, metricsGroupedByFlowNodeId[flowNodeId]);
      });

    return Promise.resolve(runtimeInformations);
  }

  public async getRuntimeInformationForFlowNode(identity: IIdentity,
                                                processModelId: string,
                                                flowNodeId: string): Promise<FlowNodeRuntimeInformation> {

    const metrics: Array<Metric> = await this.metricsRepository.readMetricsForProcessModel(processModelId);

    const flowNodeMetrics: Array<Metric> = metrics.filter((entry: Metric): boolean => {
      return entry.flowNodeId === flowNodeId;
    });

    // Do not include FlowNode instances which are still being executed,
    // since they do net yet have a final runtime.
    const filteredMetrics: Array<Metric> = flowNodeMetrics.filter(this._metricBelongsToFinishedFlowNodeInstance);

    const flowNodeRuntimeInformation: FlowNodeRuntimeInformation =
      this._createFlowNodeRuntimeInformation(processModelId, flowNodeId, filteredMetrics);

    return flowNodeRuntimeInformation;
  }

  public async getActiveTokensForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<ActiveToken>> {

    const flowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository.queryByProcessModel(processModelId);

    const activeFlowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = flowNodeInstances.filter(this._isFlowNodeInstanceActive);

    const activeTokenInfos: Array<ActiveToken> = activeFlowNodeInstances.map(this._createActiveTokenInfoForFlowNodeInstance);

    return activeTokenInfos;
  }

  public async getActiveTokensForCorrelationAndProcessModel(identity: IIdentity,
                                                            correlationId: string,
                                                            processModelId: string): Promise<Array<ActiveToken>> {

    const activeFlowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository
                                                                                        .queryActiveByCorrelationAndProcessModel(correlationId,
                                                                                                                                processModelId);

    const activeTokenInfos: Array<ActiveToken> = activeFlowNodeInstances.map(this._createActiveTokenInfoForFlowNodeInstance);

    return activeTokenInfos;
  }

  public async getActiveTokensForFlowNode(identity: IIdentity, flowNodeId: string): Promise<Array<ActiveToken>> {

    const flowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository.queryByFlowNodeId(flowNodeId);

    const activeFlowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = flowNodeInstances.filter(this._isFlowNodeInstanceActive);

    const activeTokenInfos: Array<ActiveToken> = activeFlowNodeInstances.map(this._createActiveTokenInfoForFlowNodeInstance);

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
  private _metricBelongsToFinishedFlowNodeInstance(metricToCheck: Metric, metricIndex: number, allFlowNodeMetrics: Array<Metric>): boolean {

    const metricDoesNotBelongToAFlowNodeInstance: boolean = !metricToCheck.flowNodeInstanceId || !metricToCheck.flowNodeId;

    if (metricDoesNotBelongToAFlowNodeInstance) {
      return false;
    }

    const metricWasRecordedOnFlowNodeExit: boolean = metricToCheck.metricType === MetricMeasurementPoint.onFlowNodeExit;
    if (metricWasRecordedOnFlowNodeExit) {
      return true;
    }

    const hasMatchingExitMetric: boolean = allFlowNodeMetrics.some((entry: Metric): boolean => {

      const belongsToSameFlowNodeInstance: boolean = metricToCheck.flowNodeInstanceId === entry.flowNodeInstanceId;

      const hasMatchingState: boolean =
        !(entry.metricType === MetricMeasurementPoint.onFlowNodeEnter || entry.metricType === MetricMeasurementPoint.onFlowNodeSuspend);

      return belongsToSameFlowNodeInstance && hasMatchingState;
    });

    return hasMatchingExitMetric;
  }

  /**
   * Takes a list of Metrics and groups them by the FlowNode they belong to.
   *
   * @param   metrics The metrics to group.
   * @returns         The grouped metrics.
   */
  private _groupFlowNodeInstancesByFlowNodeId(metrics: Array<Metric>): FlowNodeGroups {

    const groupedMetrics: FlowNodeGroups = {};

    for (const metric of metrics) {

      const groupHasNoMatchingEntry: boolean = !groupedMetrics[metric.flowNodeId];

      if (groupHasNoMatchingEntry) {
        groupedMetrics[metric.flowNodeId] = [];
      }

      groupedMetrics[metric.flowNodeId].push(metric);
    }

    return groupedMetrics;
  }

  /**
   * Takes an Array of FlowNodeInstances and evaluates their runtimes.
   * The results will be placed in a FlowNodeRuntimeInformation object.
   *
   * @param   processModelId The ID of the ProcessModel that the FlowNode
   *                         belongs to.
   * @param   flowNodeId     The ID of the FlowNode to evaluate.
   * @param   metrics        The list of instances to evaluate.
   * @returns                The FlowNodeRuntimeInformation for the FlowNode.
   */
  private _createFlowNodeRuntimeInformation(processModelId: string, flowNodeId: string, metrics: Array<Metric>): FlowNodeRuntimeInformation {

    const groupedMetrics: FlowNodeInstanceGroups = this._groupMetricsByFlowNodeInstance(metrics);

    const flowNodeInstanceId: Array<string> = Object.keys(groupedMetrics);

    const runtimes: Array<number> = flowNodeInstanceId.map((flowNodeInstanceKey: string): number => {
      return this._calculateRuntimeForFlowNodeInstance(groupedMetrics[flowNodeInstanceKey]);
    });

    const quartileInfos: QuartileInfos = this._calculateQuartiles(runtimes);

    const runtimeInformation: FlowNodeRuntimeInformation = new FlowNodeRuntimeInformation();
    runtimeInformation.flowNodeId = flowNodeId;
    runtimeInformation.processModelId = processModelId;
    runtimeInformation.minRuntimeInMs = Math.min(...runtimes);
    runtimeInformation.maxRuntimeInMs = Math.max(...runtimes);
    runtimeInformation.arithmeticMeanRuntimeInMs = this._calculateFlowNodeArithmeticMeanRuntime(runtimes);
    runtimeInformation.firstQuartileRuntimeInMs = quartileInfos.firstQuartile;
    runtimeInformation.medianRuntimeInMs = quartileInfos.median;
    runtimeInformation.thirdQuartileRuntimeInMs = quartileInfos.thirdQuartile;

    return runtimeInformation;
  }

  /**
   * Takes a list of Metrics and groups them by the FlowNodeInstance they belong to.
   *
   * @param metrics
   */
  private _groupMetricsByFlowNodeInstance(metrics: Array<Metric>): FlowNodeInstanceGroups {

    const groupedMetrics: FlowNodeInstanceGroups = {};

    for (const metric of metrics) {

      const groupHasNoMatchingEntry: boolean = !groupedMetrics[metric.flowNodeInstanceId];

      if (groupHasNoMatchingEntry) {
        groupedMetrics[metric.flowNodeInstanceId] = [];
      }

      groupedMetrics[metric.flowNodeInstanceId].push(metric);
    }

    return groupedMetrics;
  }

  /**
   * Calculates the total runtime of a FlowNodeInstance by comparing the
   * TimeStamp on the onEnter-Token with the one on the onExit-Token.
   *
   * @param   metrics The FlowNodeInstance for which to calculate the
   *                           runtime
   * @returns                  The calculated runtime.
   */
  private _calculateRuntimeForFlowNodeInstance(metrics: Array<Metric>): number {

    const onEnterMetric: Metric = metrics.find((token: Metric): boolean => {
      return token.metricType === MetricMeasurementPoint.onFlowNodeEnter;
    });

    const onExitMetric: Metric = metrics.find((token: Metric): boolean => {
      return token.metricType === MetricMeasurementPoint.onFlowNodeExit ||
             token.metricType === MetricMeasurementPoint.onFlowNodeError;
    });

    const startTime: moment.Moment = moment(onEnterMetric.timeStamp);
    const endTime: moment.Moment = moment(onExitMetric.timeStamp);

    const runtimeDiff: number = endTime.diff(startTime);
    const runtimeTotal: number = moment
      .duration(runtimeDiff)
      .asMilliseconds();

    return runtimeTotal;
  }

  /**
   * Calculates the quartiles for the given set of runtimes.
   *
   * @param   runtimes The set of runtimes for which to calculate the quartiles.
   * @returns          A set of quartiles.
   */
  private _calculateQuartiles(runtimes: Array<number>): QuartileInfos {

    const runtimeAmounts: number = runtimes.length;

    const sortedRuntimes: Array<number> = runtimes.sort((prevValue: number, currentValue: number): number => {
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

    const firstQuartileRuntime: number = this._calculateFlowNodeArithmeticMeanRuntime(firstQuartileData);
    const medianQuartileRuntime: number = this._calculateFlowNodeArithmeticMeanRuntime(medianQuartileData);
    const thirdQuartileRuntime: number = this._calculateFlowNodeArithmeticMeanRuntime(thirdQuartileData);

    return {
      firstQuartile: firstQuartileRuntime,
      median: medianQuartileRuntime,
      thirdQuartile: thirdQuartileRuntime,
    };
  }

  /**
   * Calculates the arithmetic mean runtime from the given set of runtimes.
   *
   * @param   runtimes The set of runtimes.
   * @returns          The calculated mean runtime.
   */
  private _calculateFlowNodeArithmeticMeanRuntime(runtimes: Array<number>): number {

    const allRuntimes: number = runtimes.reduce((previousValue: number, currentValue: number) => {
      return previousValue + currentValue;
    }, 0);

    const meanRuntime: number = Math.round(allRuntimes / runtimes.length);

    return meanRuntime;
  }

  /**
   * Checks if a given FlowNode instance is currently in an active state.
   *
   * @param   flowNodeInstance The FlowNode for which to determine the state.
   * @returns                  True, if the instance is active, otherwise false.
   */
  private _isFlowNodeInstanceActive(flowNodeInstance: Runtime.Types.FlowNodeInstance): boolean {
    return flowNodeInstance.state === Runtime.Types.FlowNodeInstanceState.running
      || flowNodeInstance.state === Runtime.Types.FlowNodeInstanceState.suspended;
  }

  /**
   * Converts the given FlowNodeInstance object into an ActiveToken object.
   *
   * @param   flowNodeInstance The FlowNodeInstance to convert.
   * @returns                  The created ActiveToken.
   */
  private _createActiveTokenInfoForFlowNodeInstance(flowNodeInstance: Runtime.Types.FlowNodeInstance): ActiveToken {

    const currentProcessToken: Runtime.Types.ProcessToken = flowNodeInstance.tokens[0];

    const activeTokenInfo: ActiveToken = new ActiveToken();
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
