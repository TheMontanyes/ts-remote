# ts-remote v1.0.0

[![npm version](https://badge.fury.io/js/ts-remote.svg)](https://www.npmjs.com/package/ts-remote)

This library is designed to solve the problem of transferring [TypeScript](https://www.typescriptlang.org/) type declarations between third-party javascript modules and improve the quality of [TypeScript](https://www.typescriptlang.org/) development.

For example, you can easily apply this solution for microfronted architecture built in any way.

## Installing

For the latest stable version:

```bash
npm install -D ts-remote
```

## Usage

### DTS module compiler

```ts
import { compiler, type ModuleList } from 'ts-remote/compiler';
import path from 'path';

const moduleList: ModuleList = {
  'moduleName': `./app/index.ts`,
  // ...others
};

compiler({
  output: {
    filename: path.resolve(process.cwd(), '@types-remote-dist', 'moduleName.d.ts'),
    format: (result) => {
      const prettier = require('prettier');
      return prettier.format(result);
    },
  },
  moduleList,
  additionalDeclarations: [`./app/global.d.ts`,],
});
```

### Remote type loader

```ts
import { loader } from 'ts-remote/loader';

loader({
  moduleList: { 'https://example.com/types/modeuleName.d.ts': '@types-remote-loaded/remote.d.ts' },
  requestOptions: {
    rejectUnauthorized: false,
  },
});
```

### Roadmap

In the near future, it is planned to expand the functionality and use more [TypeScript](https://www.typescriptlang.org/) features.
