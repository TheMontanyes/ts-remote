import https from 'https';

export type DestinationPath = string;
export type ModuleRemotePath = string;

export type ModuleList = Record<ModuleRemotePath, DestinationPath>;

export type LoaderOptions = {
  /**
   * A list in key-value format, where the key is the path to download the typescript file, and the value is the path to the directory to save it relative to the destinationFolder.
   * */
  moduleList: ModuleList;
  /**
   * The path to the directory for saving typescript files.
   * @default path.resolve(process.cwd(), '@types-remote')
   * */
  destinationFolder?: string;
  requestOptions?: https.RequestOptions;
};
