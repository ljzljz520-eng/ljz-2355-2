import ts from 'typescript';
import path from 'node:path';

export interface Program {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFile: ts.SourceFile;
}

export function compileEntry(entryFile: string, rootDir: string): Program {
  const program = ts.createProgram({
    rootNames: [entryFile],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      baseUrl: rootDir,
    },
  });
  const checker = program.getTypeChecker();
  const sourceFile =
    program.getSourceFile(entryFile) ??
    ((): never => {
      throw new Error(`entry not found in program: ${entryFile}`);
    })();
  return { program, checker, sourceFile };
}

/** Evaluate a literal AST node to a plain JS value (no code execution). */
export function evalLiteral(node: ts.Node | undefined): unknown {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((e) => evalLiteral(e));
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const p of node.properties) {
      if (ts.isPropertyAssignment(p))
        out[propName(p.name)] = evalLiteral(p.initializer);
    }
    return out;
  }
  // Non-literal expressions (calls, identifiers) cannot be evaluated statically.
  return undefined;
}

export function propName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText();
}

export function jsDocText(
  checker: ts.TypeChecker,
  decl: ts.Node,
): string | undefined {
  const tags = ts.getJSDocTags(decl);
  // Prefer the leading free-text comment.
  void tags;
  const sf = decl.getSourceFile();
  const doc = ts.getJSDocCommentsAndTags(decl);
  for (const d of doc) {
    if (ts.isJSDoc(d) && d.comment) {
      return typeof d.comment === 'string'
        ? d.comment
        : d.comment.map((c) => c.text).join('');
    }
  }
  void sf;
  void checker;
  return undefined;
}

export function findJSDocTag(
  decl: ts.Node,
  tagName: string,
): ts.JSDocTag | undefined {
  return ts.getJSDocTags(decl).find((t) => t.tagName.text === tagName);
}

export function tagComment(tag: ts.JSDocTag | undefined): string | undefined {
  if (!tag || !tag.comment) return undefined;
  return typeof tag.comment === 'string'
    ? tag.comment
    : tag.comment.map((c) => c.text).join('');
}
