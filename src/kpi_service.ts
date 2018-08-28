import {ActiveToken, FlowNodeRuntimeInformation, IKpiApiService} from '@process-engine/kpi_api_contracts';
import {ILoggingRepository} from '@process-engine/logging_api_contracts';
import {IFlowNodeInstanceRepository, Runtime} from '@process-engine/process_engine_contracts';

import {IIAMService, IIdentity} from '@essential-projects/iam_contracts';

type GroupedFlowNodeInstances = {
  [flowNodeId: string]: Array<Runtime.Types.FlowNodeInstance>,
};

export class KpiApiService implements IKpiApiService {

  private _loggingRepository: ILoggingRepository;
  private _iamService: IIAMService;
  private _flowNodeInstanceRepository: IFlowNodeInstanceRepository;

  constructor(flowNodeInstanceRepository: IFlowNodeInstanceRepository, iamService: IIAMService, loggingRepository: ILoggingRepository) {
    this._flowNodeInstanceRepository = flowNodeInstanceRepository;
    this._iamService = iamService;
    this._loggingRepository = loggingRepository;
  }

  private get flowNodeInstanceRepository(): IFlowNodeInstanceRepository {
    return this._flowNodeInstanceRepository;
  }

  private get iamService(): IIAMService {
    return this._iamService;
  }

  private get loggingRepository(): ILoggingRepository {
    return this._loggingRepository;
  }

  public async getRuntimeInformationForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<FlowNodeRuntimeInformation>> {

    // TODO: Use logging repository
    const flowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository.queryByProcessModel(processModelId);

    const groupedFlowNodeInstances: GroupedFlowNodeInstances = this._groupFlowNodeInstancesByFlowNodeId(flowNodeInstances);

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

    // TODO: Use logging repository
    const flowNodeInstances: Array<Runtime.Types.FlowNodeInstance> = await this.flowNodeInstanceRepository.queryByProcessModel(processModelId);

    const matchingFlowNodeInstances: Array<Runtime.Types.FlowNodeInstance> =
      flowNodeInstances.filter((flowNodeInstance: Runtime.Types.FlowNodeInstance): boolean => {

        return flowNodeInstance.flowNodeId === flowNodeId;
      });

    const flowNodeRuntimeInformation: FlowNodeRuntimeInformation = this._createFlowNodeRuntimeInformation(flowNodeId, matchingFlowNodeInstances);

    return flowNodeRuntimeInformation;
  }

  public async getActiveTokensForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<ActiveToken>> {

    // TODO: Add flowNodeInstanceRepository.queryActiveTokensByProcessModelId
    return Promise.resolve([]);

  }

  public async getActiveTokensForFlowNode(identity: IIdentity, flowNodeId: string): Promise<Array<ActiveToken>> {
    // TODO: Add flowNodeInstanceRepository.queryActiveTokensByFlowNodeId
    return Promise.resolve([]);

  }

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

  private _createFlowNodeRuntimeInformation(flowNodeId: string,
                                            flowNodeInstances: Array<Runtime.Types.FlowNodeInstance>,
                                           ): FlowNodeRuntimeInformation {

    // WIP
    const runtimeInformation: FlowNodeRuntimeInformation = new FlowNodeRuntimeInformation();
    runtimeInformation.flowNodeId = flowNodeId;
    runtimeInformation.processModelId = flowNodeInstances[0].tokens[0].processModelId;

    return runtimeInformation;
  }
}
