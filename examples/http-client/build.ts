/**
 * Build script for generating type declarations for the HTTP client example.
 *
 * Mirrors a real-world `src/infrastructure/http` module (HttpClient + adapter +
 * interceptors) and emits a single ambient `.d.ts` consumable by other apps.
 */
import build from '../../packages/builder/build';
import path from 'path';
import prettier from 'prettier';

async function main() {
  await build({
    entries: [{ name: '@infra/http', filename: path.resolve(__dirname, 'src/index.ts') }],
    output: {
      filename: path.resolve(__dirname, 'dist/http-client.d.ts'),
      format: (result) => prettier.format(result, { parser: 'typescript' }),
    },
    tsconfig: path.resolve(__dirname, '../../tsconfig.json'),
  });

  console.log('✅ Type declarations generated successfully!');
  console.log('📄 Output: examples/http-client/dist/http-client.d.ts');
}

main().catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
