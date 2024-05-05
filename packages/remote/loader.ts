import https from 'node:https';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

type LoaderOptions = {
  filename: string;
  requestOptions: https.RequestOptions;
};

const downloadFile = async ({ filename, requestOptions }: LoaderOptions) => {
  const adapter = requestOptions.protocol === 'http:' ? http : https;

  let resolve: () => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<void>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });

  try {
    const request = adapter
      .request(requestOptions, (response) => {
        if (response.statusCode !== 200) {
          request.emit('error', new Error(`File ${filename} not found`));
          return;
        }

        const writeStream = fs
          .createWriteStream(filename)
          .on('finish', () => {
            resolve();
          })
          .on('error', (error) => {
            request.emit('error', error);
          });

        response.pipe(writeStream);
      })
      .on('error', (error) => {
        if (fs.existsSync(filename)) {
          fs.unlinkSync(filename);
        }

        reject(error);
      });

    request.end();
    await promise;
  } catch (error) {
    console.log(`ts-federation:`, error);
  }
};

type DestinationPath = string;
type ModuleRemotePath = string;

type ModuleList = Record<ModuleRemotePath, DestinationPath>;

type RemoteOptions = {
  moduleList: ModuleList;
  /**
   * @default @types-remote
   * */
  destinationFolder?: string;
  requestOptions: https.RequestOptions;
};

const isTSFilename = (moduleRemotePath: string) => /\.ts$/.test(moduleRemotePath);

export const remote = async ({
  moduleList,
  requestOptions,
  destinationFolder = '@types-remote',
}: RemoteOptions) => {
  const moduleEntries = Object.entries(moduleList);

  if (!moduleEntries.length) return;

  if (!fs.existsSync(destinationFolder)) {
    fs.mkdirSync(destinationFolder, { recursive: true });
  }

  await Promise.allSettled(
    moduleEntries.map(([moduleRemotePath, destinationPath]) => {
      try {
        if (!isTSFilename(moduleRemotePath)) {
          throw new Error(`The file extension must be ".ts" - ${moduleRemotePath}`);
        }

        if (!isTSFilename(destinationPath)) {
          throw new Error(`The file extension must be ".ts" - ${destinationPath}`);
        }

        const url = new URL(moduleRemotePath);

        return downloadFile({
          filename: path.join(destinationFolder, destinationPath),
          requestOptions: {
            method: 'GET',
            ...url,
            path: url.pathname,
            ...requestOptions,
          },
        });
      } catch (error) {
        console.error(`ts-federation: [ERROR] ${error}`);
        return Promise.reject();
      }
    }),
  );
};
