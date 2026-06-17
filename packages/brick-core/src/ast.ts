// AST node types for the Brick DSL

export type Location = {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
};

// ── Literals ────────────────────────────────────────────────────────────────

export type StringLiteral = { kind: "string"; value: string; location?: Location };
export type NumberLiteral = { kind: "number"; value: number; location?: Location };
export type BoolLiteral   = { kind: "bool"; value: boolean; location?: Location };
export type NullLiteral   = { kind: "null"; location?: Location };
export type ArrayLiteral  = { kind: "array"; elements: Expr[]; location?: Location };
export type ObjectLiteral = { kind: "object"; pairs: { key: string; value: Expr }[]; location?: Location };

export type Literal = StringLiteral | NumberLiteral | BoolLiteral | NullLiteral | ArrayLiteral | ObjectLiteral;

// ── Variable reference: @name ────────────────────────────────────────────────

export type VarRef = { kind: "var"; name: string; location?: Location };

export type Expr = Literal | VarRef;

// ── Type annotations ─────────────────────────────────────────────────────────

export type PrimitiveType = "String" | "Number" | "Boolean" | "Table" | "Any" | "Void";
export type TypeRef = { kind: "type_ref"; name: string };
export type ArrayType = { kind: "array_type"; element: TypeAnnotation };
export type TypeAnnotation = TypeRef | ArrayType;

// ── Type definitions: type Foo = { field: Type } ─────────────────────────────

export type TypeField = { name: string; type: TypeAnnotation };
export type TypeDef = {
  kind: "type_def";
  name: string;
  fields: TypeField[];
  location?: Location;
};

// ── Function parameter ───────────────────────────────────────────────────────

export type Param = { name: string; type: TypeAnnotation };

// ── Statements ───────────────────────────────────────────────────────────────

// go to "url" | @var
export type NavigateStmt = { kind: "navigate"; url: Expr; location?: Location };

// click "#selector" [as "Label"]
export type ClickStmt = { kind: "click"; selector: Expr; label?: string; location?: Location };

// fill "Field" with value
export type FillStmt = { kind: "fill"; field: Expr; value: Expr; variable?: string; location?: Location };

// type "#selector" with "text"
export type TypeStmt = { kind: "type_input"; selector: Expr; text: Expr; location?: Location };

// select "#selector" to "value"
export type SelectStmt = { kind: "select"; selector: Expr; value: Expr; location?: Location };

// press Enter | "ArrowDown"
export type PressStmt = { kind: "press"; key: string; location?: Location };

// wait 500ms | 2s
export type WaitStmt = { kind: "wait"; ms: number; location?: Location };

// scroll "#selector" by 300
export type ScrollStmt = { kind: "scroll"; selector: Expr; deltaY: number; location?: Location };

// screenshot [-> @var]
export type ScreenshotStmt = { kind: "screenshot"; variable?: string; location?: Location };

// ai "instruction" [-> @var]
export type AiStmt = { kind: "ai"; instruction: string; variable?: string; location?: Location };

// extract table "description" -> @var
export type ExtractTableStmt = { kind: "extract_table"; description: string; variable: string; location?: Location };

// @var = value  |  value -> @var
export type SetVarStmt = { kind: "set_var"; variable: string; value: Expr; location?: Location };

// save @var as "name"
export type SaveTableStmt = { kind: "save_table"; variable: string; name: string; location?: Location };

// extract from @var "query" -> @result
export type ExtractStmt = { kind: "extract"; source: string; query: string; variable: string; location?: Location };

// js { code } [-> @var]
export type JsBlockStmt = { kind: "js_block"; code: string; variable?: string; location?: Location };

// python { code } [-> @var]
export type PyBlockStmt = { kind: "py_block"; code: string; variable?: string; location?: Location };

// load excel @file sheet "Sheet1" -> @var
export type LoadExcelStmt = { kind: "load_excel"; file: Expr; sheet: string; variable: string; location?: Location };

// upload @file to "#selector" [-> @var]
export type UploadFileStmt = { kind: "upload_file"; file: Expr; selector: Expr; variable?: string; location?: Location };

// report title: "name" { jsx }
export type ReportStmt = { kind: "report"; title: Expr; content: string; location?: Location };

// return @var | value
export type ReturnStmt = { kind: "return"; value: Expr; location?: Location };

export type Stmt =
  | NavigateStmt
  | ClickStmt
  | FillStmt
  | TypeStmt
  | SelectStmt
  | PressStmt
  | WaitStmt
  | ScrollStmt
  | ScreenshotStmt
  | AiStmt
  | ExtractTableStmt
  | SetVarStmt
  | SaveTableStmt
  | ExtractStmt
  | JsBlockStmt
  | PyBlockStmt
  | LoadExcelStmt
  | UploadFileStmt
  | ReportStmt
  | ReturnStmt;

// ── Top-level declarations ───────────────────────────────────────────────────

// value -> @variable  (module-level)
export type TopLevelVar = { kind: "top_level_var"; variable: string; value: Expr; location?: Location };

// main(params) [-> ReturnType] { stmts }
export type FunctionDef = {
  kind: "function_def";
  name: string;
  params: Param[];
  returnType?: TypeAnnotation;
  body: Stmt[];
  location?: Location;
};

export type TopLevel = TypeDef | TopLevelVar | FunctionDef;

// ── Root ─────────────────────────────────────────────────────────────────────

export type BrickFile = {
  kind: "brick_file";
  declarations: TopLevel[];
};
