import ts from 'typescript';

export interface CallSite {
  id: string;
  server: string;
  tool: string;
  line: number;
  args: Record<string, string[]>;
}
export interface Analysis {
  sites: CallSite[];
  deps: Record<string, string[]>;
  errors: { line: number; message: string }[];
}

/** Conservative, static data flow over the generated TypeScript; no code is executed. */
export function analyze(code: string): Analysis {
  const file = ts.createSourceFile('script.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: Analysis = { sites: [], deps: {}, errors: [] };
  const line = (n: ts.Node) => file.getLineAndCharacterOfPosition(n.getStart(file)).line + 1;
  const error = (n: ts.Node, message: string) => result.errors.push({ line: line(n), message });
  for (const d of (file as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics) {
    result.errors.push({ line: file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') });
  }
  const unique = (xs: string[]) => [...new Set(xs)];
  const toolName = (n: ts.Expression): [string, string] | undefined => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) &&
        ['payroll', 'tracker', 'hr'].includes(n.expression.text)) {
      return [n.expression.text, n.name.text];
    }
    if (ts.isPropertyAccessExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'tools') {
      return [n.expression.name.text, n.name.text];
    }
  };
  const declared = new Set<string>();
  function collect(n: ts.Node): void {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name)) declared.add(n.name.text);
    ts.forEachChild(n, collect);
  }
  collect(file);
  const globals = new Set(['JSON', 'Math', 'String', 'Number', 'Boolean', 'Array', 'Object', 'undefined', 'NaN', 'Infinity']);
  const containsTools = (n: ts.Node): boolean => /\b(?:tools|payroll|tracker|hr)\b/.test(n.getText(file));
  function refs(n: ts.Node, locals = new Set<string>()): string[] {
    if (ts.isIdentifier(n)) {
      if (locals.has(n.text) || globals.has(n.text)) return [];
      if (declared.has(n.text)) return result.deps[n.text]?.includes('unknown') ? [n.text, 'unknown'] : [n.text];
      error(n, `Unknown identifier ${n.text}; lineage is unknown`);
      return ['unknown'];
    }
    if (ts.isPropertyAccessExpression(n)) return refs(n.expression, locals);
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      const inner = new Set(locals);
      for (const p of n.parameters) {
        if (ts.isIdentifier(p.name)) inner.add(p.name.text);
        else { error(p, 'Unsupported destructured parameter; lineage is unknown'); return ['unknown']; }
      }
      if (ts.isBlock(n.body)) { error(n, 'Function body lineage is unknown'); return ['unknown']; }
      return refs(n.body, inner);
    }
    if (ts.isCallExpression(n)) {
      const name = toolName(n.expression);
      if (name) {
        const args: Record<string, string[]> = {};
        const arg = n.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const p of arg.properties) {
            if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) args[p.name.text] = unique(refs(p.initializer, locals));
            else if (ts.isShorthandPropertyAssignment(p)) args[p.name.text] = refs(p.name, locals);
            else { error(p, 'Unsupported argument; lineage is unknown'); args.unknown = ['unknown']; }
          }
        } else if (arg) { error(arg, 'Dynamic arguments; lineage is unknown'); args.unknown = ['unknown']; }
        if (n.arguments.length > 1) { error(n, 'Extra arguments; lineage is unknown'); args.unknown = ['unknown']; }
        const site: CallSite = { id: `site:${result.sites.length + 1}`, server: name[0], tool: name[1], line: line(n), args };
        result.sites.push(site);
        return [site.id];
      }
      if (containsTools(n.expression)) { error(n, 'Dynamic tool call; lineage is unknown'); return ['unknown']; }
      const args = n.arguments.flatMap(a => refs(a, locals));
      if (ts.isPropertyAccessExpression(n.expression)) {
        const receiver = n.expression.expression;
        const receiverRefs = refs(receiver, locals);
        if (n.expression.name.text === 'push' && ts.isIdentifier(receiver)) {
          result.deps[receiver.text] = unique([...(result.deps[receiver.text] ?? []), ...args]);
        }
        return unique([...receiverRefs, ...args]);
      }
      if (ts.isIdentifier(n.expression) && ['String', 'Number', 'Boolean'].includes(n.expression.text)) return unique(args);
      error(n, 'Unsupported function call; lineage is unknown');
      return unique(['unknown', ...args]);
    }
    if (ts.isPropertyAssignment(n)) return refs(n.initializer, locals);
    if (ts.isShorthandPropertyAssignment(n)) return refs(n.name, locals);
    if (ts.isElementAccessExpression(n)) return unique([...refs(n.expression, locals), ...(n.argumentExpression ? refs(n.argumentExpression, locals) : [])]);
    const out: string[] = [];
    ts.forEachChild(n, child => { out.push(...refs(child, locals)); });
    return unique(out);
  }
  function walk(n: ts.Node): void {
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
      if (ts.isBlock(n.body)) {
        ts.forEachChild(n.body, walk);
        return;
      }
    }
    if (ts.isVariableDeclaration(n)) {
      if (!ts.isIdentifier(n.name)) { error(n, 'Destructuring lineage is unknown'); if (n.initializer) refs(n.initializer); return; }
      result.deps[n.name.text] = n.initializer ? refs(n.initializer) : ['unknown'];
      return;
    }
    if (ts.isForOfStatement(n) || ts.isForInStatement(n)) {
      const dependencies = refs(n.expression);
      if (ts.isVariableDeclarationList(n.initializer)) {
        for (const declaration of n.initializer.declarations) {
          if (ts.isIdentifier(declaration.name)) result.deps[declaration.name.text] = dependencies;
          else error(declaration, 'Destructuring lineage is unknown');
        }
      } else if (ts.isIdentifier(n.initializer)) {
        result.deps[n.initializer.text] = unique([...(result.deps[n.initializer.text] ?? []), ...dependencies]);
      }
      walk(n.statement);
      return;
    }
    if (ts.isCatchClause(n)) {
      if (n.variableDeclaration && ts.isIdentifier(n.variableDeclaration.name)) result.deps[n.variableDeclaration.name.text] = ['unknown'];
      walk(n.block);
      return;
    }
    if (ts.isReturnStatement(n)) {
      if (n.expression) refs(n.expression);
      return;
    }
    if (ts.isExpressionStatement(n)) {
      const expr = n.expression;
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        if (ts.isBlock(expr.body)) {
          ts.forEachChild(expr.body, walk);
          return;
        }
      }
      if (ts.isCallExpression(expr)) {
        let fn: ts.Expression = expr.expression;
        if (ts.isParenthesizedExpression(fn)) fn = fn.expression;
        if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
          if (ts.isBlock(fn.body)) {
            ts.forEachChild(fn.body, walk);
            return;
          }
        }
      }
      if (ts.isBinaryExpression(expr) && expr.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && expr.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
        const dependencies = refs(expr.right);
        if (ts.isIdentifier(expr.left)) {
          result.deps[expr.left.text] = unique([...(result.deps[expr.left.text] ?? []), ...dependencies]);
        } else {
          let target: ts.Expression = expr.left;
          while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target = target.expression;
          if (ts.isIdentifier(target)) result.deps[target.text] = unique([...(result.deps[target.text] ?? []), ...dependencies]);
        }
      } else refs(expr);
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(file);
  return result;
}
