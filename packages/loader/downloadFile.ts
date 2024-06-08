import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';

type DownloadOptions = {
  filename: string;
  requestOptions: https.RequestOptions;
};

export const downloadFile = async ({ filename, requestOptions }: DownloadOptions) => {
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
    console.log(`ts-remote:`, error);
  }
};
