import https from 'node:https';

export type DestinationPath = string;
export type ModuleRemotePath = string;

export type ModuleList = Record<ModuleRemotePath, DestinationPath>;

export type LoaderOptions = {
  moduleList: ModuleList;
  /**
   * @default @types-remote
   * */
  destinationFolder?: string;
  requestOptions: https.RequestOptions;
};
