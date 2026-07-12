import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Generate a throwaway CA, server cert and client cert (all signed by that CA)
 * into `dir`, using the system `openssl` binary. Used to exercise mTLS / custom
 * CA support in tests without shipping a cert-generation library.
 */
export function generateTestCerts(dir: string): void {
  const run = (args: string[]): void => {
    execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  };

  run(['genrsa', '-out', 'ca-key.pem', '2048']);
  run([
    'req',
    '-new',
    '-x509',
    '-key',
    'ca-key.pem',
    '-out',
    'ca-cert.pem',
    '-days',
    '1',
    '-subj',
    '/CN=ts-remote Test CA',
  ]);

  const sanFile = path.join(dir, 'server-ext.cnf');
  fs.writeFileSync(sanFile, 'subjectAltName=IP:127.0.0.1\n');

  run(['genrsa', '-out', 'server-key.pem', '2048']);
  run([
    'req',
    '-new',
    '-key',
    'server-key.pem',
    '-out',
    'server-csr.pem',
    '-subj',
    '/CN=127.0.0.1',
  ]);
  run([
    'x509',
    '-req',
    '-in',
    'server-csr.pem',
    '-CA',
    'ca-cert.pem',
    '-CAkey',
    'ca-key.pem',
    '-CAcreateserial',
    '-out',
    'server-cert.pem',
    '-days',
    '1',
    '-extfile',
    sanFile,
  ]);

  run(['genrsa', '-out', 'client-key.pem', '2048']);
  run([
    'req',
    '-new',
    '-key',
    'client-key.pem',
    '-out',
    'client-csr.pem',
    '-subj',
    '/CN=ts-remote-test-client',
  ]);
  run([
    'x509',
    '-req',
    '-in',
    'client-csr.pem',
    '-CA',
    'ca-cert.pem',
    '-CAkey',
    'ca-key.pem',
    '-CAcreateserial',
    '-out',
    'client-cert.pem',
    '-days',
    '1',
  ]);
}
