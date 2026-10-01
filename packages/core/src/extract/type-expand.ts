import ts from 'typescript';

const MAX_DEPTH = 12;

export interface ExpandedType {
  kind: string;
  text: string;
  ref?: string;
  props?: Record<string, ExpandedType>;
  members?: ExpandedType[];
  element?: ExpandedType;
  $ref?: string;
  recursive?: boolean;
}

/**
 * Expand a TS type to JSON, collapsing recursive references into {$ref}.
 * Only explicitly declared properties are expanded (no Array.prototype
 * noise); recursion through a named type terminates with a $ref marker.
 */
export function expandType(
  checker: ts.TypeChecker,
  type: ts.Type,
): ExpandedType {
  const seen = new Set<string>();

  function walk(t: ts.Type, depth: number): ExpandedType {
    const text = checker.typeToString(
      t,
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );
    const named = typeName(checker, t);
    const flags = t.flags;

    if (
      flags & ts.TypeFlags.String ||
      flags & ts.TypeFlags.Number ||
      flags & ts.TypeFlags.Boolean ||
      flags & ts.TypeFlags.StringLiteral ||
      flags & ts.TypeFlags.NumberLiteral ||
      flags & ts.TypeFlags.BooleanLiteral ||
      flags & ts.TypeFlags.Null ||
      flags & ts.TypeFlags.Undefined ||
      flags & ts.TypeFlags.Any ||
      flags & ts.TypeFlags.Never ||
      flags & ts.TypeFlags.Unknown ||
      flags & ts.TypeFlags.Void
    ) {
      return { kind: 'primitive', text };
    }

    if (t.isUnion()) {
      return { kind: 'union', text, members: each(t.types, depth) };
    }
    if (t.isIntersection()) {
      return { kind: 'intersection', text, members: each(t.types, depth) };
    }

    const ref = t as ts.TypeReference;
    if (ref.typeArguments && isArrayTarget(ref)) {
      return {
        kind: 'array',
        text,
        element:
          depth + 1 >= MAX_DEPTH
            ? { kind: 'unknown', text: '...' }
            : walk(ref.typeArguments[0], depth + 1),
      };
    }

    const props = declaredProps(t);
    if (props.length > 0 || (named && isObjectShape(t))) {
      if (named && seen.has(named)) {
        return { kind: 'reference', text, ref: named, $ref: named, recursive: true };
      }
      if (named) seen.add(named);
      const out: Record<string, ExpandedType> = {};
      for (const p of props) {
        const decl = p.valueDeclaration ?? p.declarations?.[0];
        if (!decl) continue;
        out[checker.symbolToString(p)] =
          depth + 1 >= MAX_DEPTH
            ? { kind: 'unknown', text: '...' }
            : walk(checker.getTypeOfSymbolAtLocation(p, decl), depth + 1);
      }
      const result: ExpandedType = { kind: 'object', text: named ?? text, props: out };
      if (ref.typeArguments && named) {
        result.ref = named;
        result.members = ref.typeArguments.map((a) =>
          depth + 1 >= MAX_DEPTH
            ? { kind: 'unknown', text: '...' }
            : walk(a, depth + 1),
        );
      }
      if (named) seen.delete(named);
      return result;
    }

    return { kind: 'unknown', text };
  }

  function each(types: readonly ts.Type[], depth: number): ExpandedType[] {
    return types.map((u) =>
      depth + 1 >= MAX_DEPTH
        ? { kind: 'unknown', text: '...' }
        : walk(u, depth + 1),
    );
  }

  function declaredProps(t: ts.Type): ts.Symbol[] {
    // getPropertiesOfType includes inherited built-ins; filter to props whose
    // declarations are type literal members / interface members in user files.
    return checker.getPropertiesOfType(t).filter((s) => {
      const decls = s.getDeclarations();
      return Boolean(
        decls?.some(
          (d) =>
            (ts.isPropertySignature(d) ||
              ts.isPropertyDeclaration(d) ||
              ts.isMethodSignature(d)) &&
            isUserFile(d.getSourceFile()),
        ),
      );
    });
  }

  function isObjectShape(t: ts.Type): boolean {
    const sym = t.getSymbol() ?? t.aliasSymbol;
    const decls = sym?.getDeclarations();
    return Boolean(
      decls?.some(
        (d) =>
          ts.isInterfaceDeclaration(d) ||
          ts.isClassDeclaration(d) ||
          (ts.isTypeAliasDeclaration(d) &&
            (ts.isTypeLiteralNode(d.type) ||
              ts.isTypeReferenceNode(d.type))),
      ),
    );
  }

  function isArrayTarget(t: ts.TypeReference): boolean {
    const name = t.target?.getSymbol()
      ? checker.symbolToString(t.target.getSymbol()!)
      : '';
    return name === 'Array' || name === 'ReadonlyArray';
  }

  return walk(type, 0);
}

function typeName(checker: ts.TypeChecker, t: ts.Type): string | undefined {
  if (t.aliasSymbol) return checker.symbolToString(t.aliasSymbol);
  const sym = t.getSymbol();
  return sym ? checker.symbolToString(sym) : undefined;
}

function isUserFile(file: ts.SourceFile): boolean {
  return /\.(ts|tsx|mts)$/.test(file.fileName) && !file.isDeclarationFile;
}

export function flattenRefs(expanded: ExpandedType): Set<string> {
  const refs = new Set<string>();
  const visit = (e: ExpandedType): void => {
    if (e.$ref) refs.add(e.$ref);
    if (e.props) Object.values(e.props).forEach(visit);
    if (e.members) e.members.forEach(visit);
    if (e.element) visit(e.element);
  };
  visit(expanded);
  return refs;
}
