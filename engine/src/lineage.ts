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
  const containsTools = (n: ts.Node): boolean => n.getText(file).includes('tools');
  function refs(n: ts.Node, locals = new Set<string>()): string[] {
    if (ts.isIdentifier(n)) return locals.has(n.text) || n.text === 'undefined' ? [] : [n.text];
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
      // Arbitrary function calls can hide data flow. Recognize common array transformations only.
      if (!ts.isPropertyAccessExpression(n.expression) || !['reduce', 'map', 'filter', 'slice', 'join'].includes(n.expression.name.text)) {
        error(n, 'Unsupported function call; lineage is unknown');
        return unique(['unknown', ...n.arguments.flatMap(a => refs(a, locals))]);
      }
      return unique([...refs(n.expression.expression, locals), ...n.arguments.flatMap(a => refs(a, locals))]);
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
    if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isIfStatement(n) || ts.isSwitchStatement(n) || ts.isTryStatement(n)) {
      error(n, 'Control flow lineage is unknown');
      // Any assignment in unsupported control flow is conservatively unknown.
      function mark(child: ts.Node): void {
        if (ts.isBinaryExpression(child) && child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && child.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(child.left)) result.deps[child.left.text] = unique([...(result.deps[child.left.text] ?? []), 'unknown']);
        ts.forEachChild(child, mark);
      }
      mark(n);
      ts.forEachChild(n, walk);
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
          error(expr, 'Mutation lineage is unknown');
          let target: ts.Expression = expr.left;
          while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) target = target.expression;
          if (ts.isIdentifier(target)) result.deps[target.text] = unique([...(result.deps[target.text] ?? []), ...dependencies, 'unknown']);
        }
      } else refs(expr);
      return;
    }
    ts.forEachChild(n, walk);
  }
  walk(file);
  return result;
}
