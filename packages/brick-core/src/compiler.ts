import type { BrickFile, Stmt, Expr, FunctionDef, TopLevelVar } from "./ast";

// Mirrors the RunbookStep type from the app
export type RunbookStep =
  | { type: "action";       instruction: string; variable: string }
  | { type: "navigate";     url: string }
  | { type: "click";        selector: string; label: string }
  | { type: "set_input";    field: string; value: string; variable: string }
  | { type: "type";         selector: string; text: string }
  | { type: "set_dropdown"; selector: string; value: string }
  | { type: "press_key";    key: string }
  | { type: "wait";         ms: number }
  | { type: "scroll";       selector: string; deltaY: number }
  | { type: "screenshot";   variable: string }
  | { type: "extract_table"; description: string; variable: string }
  | { type: "set_variable"; variable: string; value: string }
  | { type: "store_table";  variable: string; name: string }
  | { type: "extract";      source: string; query: string; variable: string }
  | { type: "write_docx";   title: string; content: string }
  | { type: "js_block";     code: string; variable: string }
  | { type: "py_block";     code: string; variable: string }
  | { type: "excel_to_csv"; file: string; sheet: string; variable: string }
  | { type: "upload_file";  file: string; selector: string; variable: string };

export type CompileResult = {
  steps: RunbookStep[];
  errors: CompileError[];
  topLevelVars: Record<string, unknown>;
  entryFunction?: FunctionDef;
};

export type CompileError = {
  message: string;
  line?: number;
  column?: number;
};

function resolveExpr(expr: Expr): string {
  switch (expr.kind) {
    case "string": return expr.value;
    case "number": return String(expr.value);
    case "bool":   return String(expr.value);
    case "null":   return "null";
    case "var":    return `@${expr.name}`;
    case "array":  return JSON.stringify(resolveExprValue(expr));
    case "object": return JSON.stringify(resolveExprValue(expr));
  }
}

function resolveExprValue(expr: Expr): unknown {
  switch (expr.kind) {
    case "string": return expr.value;
    case "number": return expr.value;
    case "bool":   return expr.value;
    case "null":   return null;
    case "var":    return `@${expr.name}`;
    case "array":  return expr.elements.map(resolveExprValue);
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const { key, value } of expr.pairs) obj[key] = resolveExprValue(value);
      return obj;
    }
  }
}

function compileStmt(stmt: Stmt, errors: CompileError[]): RunbookStep | null {
  switch (stmt.kind) {
    case "navigate":
      return { type: "navigate", url: resolveExpr(stmt.url) };

    case "click":
      return { type: "click", selector: resolveExpr(stmt.selector), label: stmt.label ?? "" };

    case "fill":
      return {
        type: "set_input",
        field: resolveExpr(stmt.field),
        value: resolveExpr(stmt.value),
        variable: stmt.variable ?? "",
      };

    case "type_input":
      return { type: "type", selector: resolveExpr(stmt.selector), text: resolveExpr(stmt.text) };

    case "select":
      return { type: "set_dropdown", selector: resolveExpr(stmt.selector), value: resolveExpr(stmt.value) };

    case "press":
      return { type: "press_key", key: stmt.key };

    case "wait":
      return { type: "wait", ms: stmt.ms };

    case "scroll":
      return { type: "scroll", selector: resolveExpr(stmt.selector), deltaY: stmt.deltaY };

    case "screenshot":
      return { type: "screenshot", variable: stmt.variable ?? "" };

    case "ai":
      return { type: "action", instruction: stmt.instruction, variable: stmt.variable ?? "" };

    case "extract_table":
      return { type: "extract_table", description: stmt.description, variable: stmt.variable };

    case "set_var": {
      const raw = resolveExprValue(stmt.value);
      return {
        type: "set_variable",
        variable: stmt.variable,
        value: typeof raw === "string" ? raw : JSON.stringify(raw),
      };
    }

    case "save_table":
      return { type: "store_table", variable: stmt.variable, name: stmt.name };

    case "extract":
      return { type: "extract", source: stmt.source, query: stmt.query, variable: stmt.variable };

    case "js_block":
      return { type: "js_block", code: stmt.code, variable: stmt.variable ?? "" };

    case "py_block":
      return { type: "py_block", code: stmt.code, variable: stmt.variable ?? "" };

    case "load_excel":
      return {
        type: "excel_to_csv",
        file: resolveExpr(stmt.file),
        sheet: stmt.sheet,
        variable: stmt.variable,
      };

    case "upload_file":
      return {
        type: "upload_file",
        file: resolveExpr(stmt.file),
        selector: resolveExpr(stmt.selector),
        variable: stmt.variable ?? "",
      };

    case "report":
      return { type: "write_docx", title: resolveExpr(stmt.title), content: stmt.content };

    case "return":
      // return is metadata — not a runbook step
      return null;
  }
}

export function compile(ast: BrickFile): CompileResult {
  const errors: CompileError[] = [];
  const topLevelVars: Record<string, unknown> = {};
  let entryFunction: FunctionDef | undefined;

  // Collect top-level vars
  for (const decl of ast.declarations) {
    if (decl.kind === "top_level_var") {
      topLevelVars[decl.variable] = resolveExprValue(decl.value);
    }
    if (decl.kind === "function_def") {
      // The first function_def (usually "main") is the entry point
      if (!entryFunction) entryFunction = decl;
    }
  }

  if (!entryFunction) {
    errors.push({ message: "No function found in brick file. Define at least one function." });
    return { steps: [], errors, topLevelVars };
  }

  const steps: RunbookStep[] = [];
  for (const stmt of entryFunction.body) {
    const step = compileStmt(stmt, errors);
    if (step) steps.push(step);
  }

  return { steps, errors, topLevelVars, entryFunction };
}
