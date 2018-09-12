import * as moment from 'moment';

import {ActiveToken, FlowNodeRuntimeInformation, IKpiApiService} from '@process-engine/kpi_api_contracts';
import {IFlowNodeInstanceRepository, Runtime} from '@process-engine/process_engine_contracts';

import {IIAMService, IIdentity} from '@essential-projects/iam_contracts';

type GroupedFlowNodeInstances = {
  [flowNodeId: string]: Array<Runtime.Types.FlowNodeInstance>,
};

export class KpiApiService implements IKpiApiService {

  private _iamService: IIAMService;
  private _flowNodeInstanceRepository: IFlowNodeInstanceRepository;

  constructor(flowNodeInstanceRepository: IFlowNodeInstanceRepository, iamService: IIAMService) {
    this._flowNodeInstanceRepository = flowNodeInstanceRepository;
    this._iamService = iamService;
  }

  private get flowNodeInstanceRepository(): IFlowNodeInstanceRepository {
    return this._flowNodeInstanceRepository;
  }

  private get iamService(): IIAMService {
    return this._iamService;
  }

  public async getRuntimeInformationForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<FlowNodeRuntimeInformation>> {

    const flowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository.queryByProcessModel(processModelId);

    // Do not include FlowNode instances which are still being executed,
    // since they do net yet have a final runtime.
    const filteredFlowNodeInstances: Array<Runtime.Types.FlowNodeInstance> =
      flowNodeInstances.filter((flowNodeInstance: Runtime.Types.FlowNodeInstance) => {
        return !this._isFlowNodeInstanceActive(flowNodeInstance);
      });

    const groupedFlowNodeInstances: GroupedFlowNodeInstances = this._groupFlowNodeInstancesByFlowNodeId(filteredFlowNodeInstances);

    const groupKeys: Array<string> = Object.keys(groupedFlowNodeInstances);

    const runtimeInformations: Array<FlowNodeRuntimeInformation> =
      groupKeys.map((flowNodeId: string): FlowNodeRuntimeInformation => {
        return this._createFlowNodeRuntimeInformation(flowNodeId, groupedFlowNodeInstances[flowNodeId]);
      });

    return Promise.resolve(runtimeInformations);
  }

  public async getRuntimeInformationForFlowNode(identity: IIdentity,
                                                processModelId: string,
                                                flowNodeId: string): Promise<FlowNodeRuntimeInformation> {

    const flowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository.queryByFlowNodeId(flowNodeId);

    // Do not include FlowNode instances which are still being executed,
    // since they do net yet have a final runtime.
    const filteredFlowNodeInstances: Array<Runtime.Types.FlowNodeInstance> =
      flowNodeInstances.filter((flowNodeInstance: Runtime.Types.FlowNodeInstance) => {
        return !this._isFlowNodeInstanceActive(flowNodeInstance);
      });

    const flowNodeRuntimeInformation: FlowNodeRuntimeInformation = this._createFlowNodeRuntimeInformation(flowNodeId, filteredFlowNodeInstances);

    return flowNodeRuntimeInformation;
  }

  public async getActiveTokensForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<ActiveToken>> {

    const flowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository.queryByProcessModel(processModelId);

    const activeFlowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = flowNodeInstances.filter(this._isFlowNodeInstanceActive);

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
   * Takes a list of FlowNodeInstances and groups them by their FlowNodeId.
   *
   * @param   flowNodeInstances The FlowNodeInstances to group.
   * @returns                   The grouped FlowNodeInstances.
   */
  private _groupFlowNodeInstancesByFlowNodeId(flowNodeInstances: Array<Runtime.Types.FlowNodeInstance>): GroupedFlowNodeInstances {

    const groupedFlowNodeInstances: GroupedFlowNodeInstances = {};

    for (const flowNodeInstance of flowNodeInstances) {

      const groupHasNoMatchingEntry: boolean = !groupedFlowNodeInstances[flowNodeInstance.flowNodeId];

      if (!groupHasNoMatchingEntry) {
        groupedFlowNodeInstances[flowNodeInstance.flowNodeId] = [];
      }

      groupedFlowNodeInstances[flowNodeInstance.flowNodeId].push(flowNodeInstance);
    }

    return groupedFlowNodeInstances;
  }

  /**
   * Takes an Array of FlowNodeInstances and evaluates their runtimes.
   * The results will be placed in a FlowNodeRuntimeInformation object.
   *
   * @param   flowNodeId        The ID of the FlowNode to evaluate.
   * @param   flowNodeInstances The list of instances to evaluate.
   * @returns                   The FlowNodeRuntimeInformation for the FlowNode.
   */
  private _createFlowNodeRuntimeInformation(flowNodeId: string,
                                            flowNodeInstances: Array<Runtime.Types.FlowNodeInstance>,
                                           ): FlowNodeRuntimeInformation {

    const runtimes: Array<number> = flowNodeInstances.map(this._calculateRuntimeForFlowNodeInstance);

    const runtimeInformation: FlowNodeRuntimeInformation = new FlowNodeRuntimeInformation();
    runtimeInformation.flowNodeId = flowNodeId;
    runtimeInformation.processModelId = flowNodeInstances[0].tokens[0].processModelId;
    runtimeInformation.minRuntimeInMs = Math.min(...runtimes);
    runtimeInformation.maxRuntimeInMs = Math.max(...runtimes);
    runtimeInformation.arithmeticMeanRuntimeInMs = this._calculateFlowNodeArithmeticMeanRuntime(runtimes);
    runtimeInformation.firstQuartileRuntimeInMs = 0;
    runtimeInformation.medianRuntimeInMs = 0;
    runtimeInformation.thirdQuartileRuntimeInMs = 0;

    return runtimeInformation;
  }

  /**
   * Calculates the total runtime of a FlowNodeInstance by comparing the
   * TimeStamp on the onEnter-Token with the one on the onExit-Token.
   *
   * @param   flowNodeInstance The FlowNodeInstance for which to calculate the
   *                           runtime
   * @returns                  The calculated runtime.
   */
  private _calculateRuntimeForFlowNodeInstance(flowNodeInstance: Runtime.Types.FlowNodeInstance): number {

    const onEnterToken: Runtime.Types.ProcessToken =
      flowNodeInstance.tokens.find((token: Runtime.Types.ProcessToken): boolean => {
        return token.type === Runtime.Types.ProcessTokenType.onEnter ;
      });

    const onExitToken: Runtime.Types.ProcessToken =
      flowNodeInstance.tokens.find((token: Runtime.Types.ProcessToken): boolean => {
        return token.type === Runtime.Types.ProcessTokenType.onExit ;
      });

    const startTime: moment.Moment = moment(onEnterToken.createdAt);
    const endTime: moment.Moment = moment(onExitToken.createdAt);

    const runtimeDiff: number = endTime.diff(startTime);
    const runtimeTotal: number = moment
      .duration(runtimeDiff)
      .asMilliseconds();

    return runtimeTotal;
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
