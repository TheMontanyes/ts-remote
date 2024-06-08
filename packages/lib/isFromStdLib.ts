import ts from 'typescript';

export const isFromStdLib = (node: ts.Node) => {
  const sourceFile = node.getSourceFile();

  if (sourceFile) {
    const libFolderName = '/typescript/lib'; // путь к стандартной библиотеке TypeScript
    return sourceFile.fileName.includes(libFolderName);
  }

  return false;
};
