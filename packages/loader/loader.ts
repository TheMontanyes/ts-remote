import path from 'node:path';
import fs from 'node:fs';
import { LoaderOptions } from './types';
import { downloadFile } from './downloadFile';
import * as process from 'process';

const isTSFilename = (moduleRemotePath: string) => /\.ts$/.test(moduleRemotePath);

const baseDestinationFolder = path.resolve(process.cwd(), '@types-remote');

export const loader = async ({
  moduleList,
  requestOptions,
  destinationFolder = baseDestinationFolder,
}: LoaderOptions) => {
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
        console.error(`ts-remote: [ERROR] ${error}`);
        return Promise.reject();
      }
    }),
  );
};
