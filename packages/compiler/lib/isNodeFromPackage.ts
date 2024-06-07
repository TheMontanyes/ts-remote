import ts from 'typescript';

export const isNodeFromPackage = (node: ts.Node) => {
  return node.getSourceFile().fileName.includes('node_modules');
};
