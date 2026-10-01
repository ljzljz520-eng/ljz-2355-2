import ts from 'typescript';
import path from 'node:path';
import {
  compileEntry,
  evalLiteral,
  findJSDocTag,
  jsDocText,
  propName,
  tagComment,
} from './typescript-compile.js';
import { expandType, type ExpandedType } from './type-expand.js';
import type {
  ComponentContract,
  DeprecationInfo,
  PropDoc,
  EventDoc,
  TypeShape,
} from '../types.js';

export interface StaticExtraction {
  component: ComponentContract;
  /** Slot-like references found by source scanning (low confidence). */
  slotCandidates: string[];
  /** Event names present in the runtime `emits` declaration. */
  declaredEmits: string[];
  deprecations: { path: string; info: DeprecationInfo }[];
}

interface ParseContext {
  checker: ts.TypeChecker;
}

function typeShape(t: ts.Type, checker: ts.TypeChecker): TypeShape {
  const expanded = expandType(checker, t);
  return {
    text: checker.typeToString(
      t,
      undefined,
      ts.TypeFormatFlags.NoTruncation |
        ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    ),
    expanded: expanded as unknown,
    source: 'static',
  };
}

/** Parse `@deprecated since=1.0 removeIn=2.0 replacement=old-name 说明文字`. */
function parseDeprecated(
  decl: ts.Node,
): DeprecationInfo | undefined {
  const tag = findJSDocTag(decl, 'deprecated');
  if (!tag) return undefined;
  const raw = tagComment(tag) ?? '';
  const info: DeprecationInfo = { since: '0.0.0', removeIn: '' };
  const rest = raw.replace(/(\w+)=(\S+)/g, (_m, k: string, v: string) => {
    if (k === 'since' || k === 'removeIn' || k === 'replacement')
      info[k] = v;
    return '';
  });
  const note = rest.trim();
  if (note) info.note = note;
  return info;
}

function extractOne(
  ctx: ParseContext,
  call: ts.CallExpression,
): StaticExtraction | undefined {
  const { checker } = ctx;
  const obj = call.arguments[0];
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  // defineComponent<Props, Events>: events are the second type argument.
  const eventsTypeNode = call.typeArguments?.[1];

  const getProp = (n: string) =>
    obj.properties.find(
      (p): p is ts.PropertyAssignment =>
        ts.isPropertyAssignment(p) && propName(p.name) === n,
    );

  const nameLit = evalLiteral(getProp('name')?.initializer);
  if (typeof nameLit !== 'string') return undefined;

  // Description: explicit field wins, else JSDoc on the exporting variable.
  let description = evalLiteral(getProp('description')?.initializer) as
    | string
    | undefined;
  const varDecl = call.parent;
  if (!description && ts.isVariableDeclaration(varDecl)) {
    description = jsDocText(checker, varDecl);
  }

  const props: PropDoc[] = [];
  const deprecations: StaticExtraction['deprecations'] = [];
  let defaultMap = new Map<string, ts.Expression>();
  let propsTypeNode: ts.TypeNode | undefined;

  const propsProp = getProp('props');
  if (propsProp) {
    const init = propsProp.initializer;
    if (ts.isCallExpression(init) && propsTypeFromCall(init)) {
      const parsed = propsTypeFromCall(init)!;
      propsTypeNode = parsed.typeNode;
      const config = parsed.config;
      if (config && ts.isObjectLiteralExpression(config)) {
        for (const p of config.properties) {
          if (ts.isPropertyAssignment(p))
            defaultMap.set(
              propName(p.name),
              ts.isObjectLiteralExpression(p.initializer)
                ? (p.initializer.properties.find(
                    (x) =>
                      ts.isPropertyAssignment(x) && propName(x.name) === 'default',
                  ) as ts.PropertyAssignment | undefined)?.initializer ??
                    p.initializer
                : p.initializer,
            );
        }
      }
    }
  }

  if (propsTypeNode) {
    const propsType = checker.getTypeFromTypeNode(propsTypeNode);
    for (const sym of checker.getPropertiesOfType(propsType)) {
      const decl = sym.valueDeclaration ?? sym.declarations?.[0];
      if (!decl) continue;
      const pType = checker.getTypeOfSymbolAtLocation(sym, decl);
      const prop: PropDoc = {
        name: checker.symbolToString(sym),
        description: jsDocText(checker, decl)
          ? { value: jsDocText(checker, decl)!, source: 'static' }
          : undefined,
        type: typeShape(pType, checker),
        required: {
          value: !isOptional(decl),
          source: 'static',
        },
        default: defaultMap.has(checker.symbolToString(sym))
          ? {
              value: evalLiteral(defaultMap.get(checker.symbolToString(sym)!)),
              source: 'static',
            }
          : undefined,
      };
      const dep = parseDeprecated(decl);
      if (dep) {
        prop.deprecated = dep;
        deprecations.push({ path: `props.${prop.name}`, info: dep });
      }
      props.push(prop);
    }
  }

  // Events from the generic type parameter (payload types + JSDoc).
  const events: EventDoc[] = [];
  if (eventsTypeNode) {
    const eventsType = checker.getTypeFromTypeNode(eventsTypeNode);
    for (const sym of checker.getPropertiesOfType(eventsType)) {
      const decl = sym.valueDeclaration ?? sym.declarations?.[0];
      const ev: EventDoc = {
        name: checker.symbolToString(sym),
        description:
          decl && jsDocText(checker, decl)
            ? { value: jsDocText(checker, decl)!, source: 'static' }
            : undefined,
      };
      if (decl) {
        ev.payloadType = typeShape(
          checker.getTypeOfSymbolAtLocation(sym, decl),
          checker,
        );
      }
      events.push(ev);
    }
  }

  // Runtime-declared event names (for static/runtime cross-checking).
  const declaredEmits: string[] = [];
  const emitsProp = getProp('emits');
  if (emitsProp && ts.isArrayLiteralExpression(emitsProp.initializer)) {
    for (const el of emitsProp.initializer.elements) {
      const v = evalLiteral(el);
      if (typeof v === 'string') declaredEmits.push(v);
    }
  }

  // Best-effort slot scan over a render function body. Slots cannot be
  // inferred reliably (no slot type system here), hence manual evidence.
  const slotCandidates = new Set<string>();
  const renderProp = obj.properties.find(
    (p) => p.name && propName(p.name as ts.PropertyName) === 'render',
  );
  if (renderProp) {
    const text = renderProp.getText();
    const re = /slots\.([A-Za-z_][\w-]*)|slot(?:Name)?\s*[:=]\s*["']([\w-]+)["']/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) slotCandidates.add(m[1] ?? m[2]);
  }

  return {
    component: {
      name: nameLit,
      description,
      props,
      events,
      slots: [], // filled from manual evidence during merge
    },
    slotCandidates: [...slotCandidates],
    declaredEmits,
    deprecations,
  };
}

function propsTypeFromCall(
  init: ts.CallExpression,
): { typeNode: ts.TypeNode; config?: ts.Expression } | undefined {
  let target = init;
  // defineProps<T>(config)
  if (ts.isIdentifier(target.expression) && target.typeArguments?.length) {
    return { typeNode: target.typeArguments[0], config: target.arguments[0] };
  }
  return undefined;
}

function isOptional(decl: ts.Declaration): boolean {
  const sig = decl as ts.PropertySignature | ts.ParameterDeclaration;
  return Boolean(sig.questionToken);
}

/** Walk every TS file under rootDir and extract all defineComponent calls. */
export function staticExtractPackage(
  rootDir: string,
  entryFile = path.join(rootDir, 'index.ts'),
): StaticExtraction[] {
  const { program, checker, sourceFile: entry } = compileEntry(
    entryFile,
    rootDir,
  );
  void entry;
  const out: StaticExtraction[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = path.relative(rootDir, sf.fileName);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const ctx: ParseContext = { checker };
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'defineComponent'
      ) {
        const ex = extractOne(ctx, node);
        if (ex) out.push(ex);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}
