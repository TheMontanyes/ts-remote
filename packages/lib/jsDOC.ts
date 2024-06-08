import ts from 'typescript';

type JSDoc = { jsDoc: ts.JSDoc[] };

export const hasJsDOC = <N extends ts.Node>(node: N & Partial<JSDoc>): node is N & JSDoc =>
  Boolean(node.jsDoc && node.jsDoc.length > 0);

export const extractJSDocFromNode = <N extends ts.Node & JSDoc>(node: N) =>
  node.jsDoc[0].getFullText();

export const getJsDOC = <N extends ts.Node>(node: N) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    hasJsDOC(node.parent.parent)
  ) {
    // get jsDoc from variable statement
    return extractJSDocFromNode(node.parent.parent);
  }

  if (hasJsDOC(node)) {
    return extractJSDocFromNode(node);
  }

  return '';
};
