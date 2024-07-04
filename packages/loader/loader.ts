import path from 'path';
import fs from 'fs';
import { LoaderOptions } from './types';
import { downloadFile } from './downloadFile';

const isTSFilename = (moduleRemotePath: string) => /\.ts$/.test(moduleRemotePath);

const baseDestinationFolder = path.resolve(process.cwd(), '@types-remote');

export const loader = async (options: LoaderOptions) => {
  const { moduleList, requestOptions, destinationFolder = baseDestinationFolder } = options;

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
            rejectUnauthorized: false,
            method: 'GET',
            host: url.host,
            protocol: url.protocol,
            port: url.port,
            hostname: url.hostname,
            path: url.pathname,
            ...requestOptions,
          },
        });
      } catch (error) {
        return Promise.reject(`ts-remote: [ERROR] ${error}`);
      }
    }),
  );
};
