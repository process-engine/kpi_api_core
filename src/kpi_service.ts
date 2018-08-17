import {ActiveToken, FlowNodeRuntimeInformation, IKpiApiService} from '@process-engine/kpi_api_contracts';
import {ILoggingRepository} from '@process-engine/logging_api_contracts';
import {IFlowNodeInstanceRepository} from '@process-engine/process_engine_contracts';

import {IIAMService, IIdentity} from '@essential-projects/iam_contracts';

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
    return Promise.resolve([]);
  }

  public async getRuntimeInformationForFlowNode(identity: IIdentity,
                                                processModelId: string,
                                                flowNodeId: string): Promise<FlowNodeRuntimeInformation> {
    return Promise.resolve({});

  }

  public async getActiveTokensForProcessModel(identity: IIdentity, processModelId: string): Promise<Array<ActiveToken>> {
    return Promise.resolve([]);

  }

  public async getActiveTokensForFlowNode(identity: IIdentity, flowNodeId: string): Promise<Array<ActiveToken>> {
    return Promise.resolve([]);

  }
}
