import type { BrickFile, Stmt, FunctionDef, TopLevel } from "./ast";

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
};

export function lint(ast: BrickFile): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const definedVars = new Set<string>();
  const definedFunctions = new Set<string>();

  // Collect top-level vars
  for (const decl of ast.declarations) {
    if (decl.kind === "top_level_var") {
      definedVars.add(decl.variable);
    }
  }

  // Check for entry function
  const functions = ast.declarations.filter((d): d is FunctionDef => d.kind === "function_def");
  if (functions.length === 0) {
    diags.push({ severity: "error", message: "No function defined. Add a function like: main() { ... }" });
    return diags;
  }

  for (const fn of functions) {
    if (definedFunctions.has(fn.name)) {
      diags.push({
        severity: "error",
        message: `Duplicate function name: "${fn.name}"`,
        line: fn.location?.start.line,
        column: fn.location?.start.column,
      });
    }
    definedFunctions.add(fn.name);

    // Seed scope with function params
    const scope = new Set<string>(definedVars);
    for (const param of fn.params) scope.add(param.name);

    lintBody(fn.body, scope, diags);
  }

  return diags;
}

function lintBody(stmts: Stmt[], scope: Set<string>, diags: Diagnostic[]): void {
  for (const stmt of stmts) {
    lintStmt(stmt, scope, diags);
  }
}

function lintStmt(stmt: Stmt, scope: Set<string>, diags: Diagnostic[]): void {
  const loc = stmt.location;

  switch (stmt.kind) {
    case "navigate":
      checkVarUsed(stmt.url, scope, diags, loc);
      break;

    case "click":
      checkVarUsed(stmt.selector, scope, diags, loc);
      break;

    case "fill":
      checkVarUsed(stmt.field, scope, diags, loc);
      checkVarUsed(stmt.value, scope, diags, loc);
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "type_input":
      checkVarUsed(stmt.selector, scope, diags, loc);
      checkVarUsed(stmt.text, scope, diags, loc);
      break;

    case "select":
      checkVarUsed(stmt.selector, scope, diags, loc);
      checkVarUsed(stmt.value, scope, diags, loc);
      break;

    case "scroll":
      checkVarUsed(stmt.selector, scope, diags, loc);
      break;

    case "ai":
      if (!stmt.instruction.trim()) {
        diags.push({ severity: "error", message: "ai step requires a non-empty instruction", line: loc?.start.line });
      }
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "screenshot":
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "extract_table":
      if (!stmt.description.trim()) {
        diags.push({ severity: "error", message: "extract table requires a non-empty description", line: loc?.start.line });
      }
      scope.add(stmt.variable);
      break;

    case "set_var":
      checkVarUsed(stmt.value, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "save_table":
      if (!scope.has(stmt.variable)) {
        diags.push({
          severity: "error",
          message: `Variable @${stmt.variable} is not defined before save`,
          line: loc?.start.line,
        });
      }
      if (!stmt.name.trim()) {
        diags.push({ severity: "error", message: "save requires a non-empty name", line: loc?.start.line });
      }
      break;

    case "extract":
      if (!scope.has(stmt.source)) {
        diags.push({
          severity: "error",
          message: `Variable @${stmt.source} is not defined before extract`,
          line: loc?.start.line,
        });
      }
      scope.add(stmt.variable);
      break;

    case "js_block":
      if (!stmt.code.trim()) {
        diags.push({ severity: "warning", message: "js block is empty", line: loc?.start.line });
      }
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "py_block":
      if (!stmt.code.trim()) {
        diags.push({ severity: "warning", message: "python block is empty", line: loc?.start.line });
      }
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "load_excel":
      checkVarUsed(stmt.file, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "upload_file":
      checkVarUsed(stmt.file, scope, diags, loc);
      checkVarUsed(stmt.selector, scope, diags, loc);
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "report":
      checkVarUsed(stmt.title, scope, diags, loc);
      break;

    case "return":
      checkVarUsed(stmt.value, scope, diags, loc);
      break;

    case "press":
    case "wait":
      // no variable refs
      break;
  }
}

function checkVarUsed(
  expr: import("./ast").Expr,
  scope: Set<string>,
  diags: Diagnostic[],
  loc: import("./ast").Location | undefined,
): void {
  if (expr.kind === "var" && !scope.has(expr.name)) {
    diags.push({
      severity: "error",
      message: `Variable @${expr.name} is used before it is defined`,
      line: loc?.start.line,
      column: loc?.start.column,
    });
  }
  if (expr.kind === "array") {
    for (const el of expr.elements) checkVarUsed(el, scope, diags, loc);
  }
  if (expr.kind === "object") {
    for (const { value } of expr.pairs) checkVarUsed(value, scope, diags, loc);
  }
}
