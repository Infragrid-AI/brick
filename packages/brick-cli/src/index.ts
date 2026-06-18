#!/usr/bin/env node
import { program } from "commander";
import * as fs from "fs";
import * as path from "path";
import { parse, buildFromAst, buildFromSource, serialize } from "@brick/core";
import type { BrickFile, TopLevel } from "@brick/core";

// ANSI helpers
const c = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  gray:   (s: string) => `\x1b[90m${s}\x1b[0m`,
};

// Known renamed / removed keywords with hints
const KEYWORD_HINTS: Record<string, string> = {
  read_file:  'open_file — the primitive was renamed (open_file "path" -> @var)',
  save:       'removed — variables are automatically saved, no explicit save needed',
  save_table: 'removed — variables are automatically saved, no explicit save needed',
};

// Detect the word at a given column in a source line
function wordAt(line: string, col: number): string {
  const start = Math.max(0, col - 1);
  const match = line.slice(start).match(/^[A-Za-z_][A-Za-z0-9_]*/);
  return match ? match[0] : "";
}

// Format a parse error with source context and a helpful hint
function formatParseError(
  source: string,
  relPath: string,
  rawMessage: string,
  line?: number,
  column?: number,
): void {
  const lines = source.split("\n");
  const lineNum = line ?? 1;
  const colNum = column ?? 1;
  const srcLine = lines[lineNum - 1] ?? "";

  // Detect the unknown word at the error position
  const word = wordAt(srcLine, colNum);
  const hint = word ? KEYWORD_HINTS[word] : undefined;

  // Summarise the raw Peggy message into something human-readable
  let summary: string;
  if (hint) {
    summary = `Unknown keyword "${word}"`;
  } else if (rawMessage.includes("but") && rawMessage.startsWith("Expected")) {
    // "Expected X, Y but 'z' found." → just show what was found
    const foundMatch = rawMessage.match(/but\s+"?(.+?)"?\s+found/);
    const found = foundMatch ? foundMatch[1] : word || "unexpected token";
    summary = `Unexpected ${found === "\n" ? "end of line" : `"${found}"`} — check syntax around here`;
  } else {
    summary = rawMessage.length > 120 ? rawMessage.slice(0, 120) + "…" : rawMessage;
  }

  const lineLabel = String(lineNum).padStart(3);
  const prevLine  = lineNum > 1 ? lines[lineNum - 2] : null;
  const nextLine  = lines[lineNum] ?? null;
  const gutter    = " ".repeat(lineLabel.length);
  const caret     = " ".repeat(Math.max(0, colNum - 1)) + (word ? "^".repeat(word.length) : "^");

  console.log();
  console.log(c.red(c.bold("  Parse error")) + c.dim(`  ${relPath}  line ${lineNum}`));
  console.log();
  if (prevLine !== null)
    console.log(`  ${c.gray(String(lineNum - 1).padStart(lineLabel.length))} │  ${c.dim(prevLine)}`);
  console.log(`  ${c.bold(lineLabel)} │  ${c.red(srcLine)}`);
  console.log(`  ${gutter} │  ${c.red(caret)}`);
  if (nextLine !== null)
    console.log(`  ${c.gray(String(lineNum + 1).padStart(lineLabel.length))} │  ${c.dim(nextLine)}`);
  console.log();
  console.log(`  ${c.red("✕")}  ${summary}`);
  if (hint) console.log(`  ${c.yellow("→")}  Did you mean: ${hint}`);
  console.log();
}

interface BrickJson {
  name: string;
  module: string;
  version: string;
  description: string;
  entry: string;
  author: string;
  types?: string;
  compiler?: { strict?: boolean; target?: string };
  env?: Record<string, string>;
}

// Read brick.json from dir (or cwd). Returns null if not found.
function readBrickJson(dir = process.cwd()): BrickJson | null {
  const p = path.join(dir, "brick.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as BrickJson; }
  catch { return null; }
}

// Resolve file argument: explicit path, or auto-discover from brick.json
function resolveFile(file?: string): string {
  if (file) return file;
  const meta = readBrickJson();
  if (meta?.entry) {
    const resolved = path.resolve(meta.entry);
    if (fs.existsSync(resolved)) return meta.entry;
  }
  console.error("❌  No file specified and no brick.json found. Run: brick build src/main.brick");
  process.exit(1);
}

function loadAndParse(file: string) {
  const absPath = path.resolve(file);
  if (!fs.existsSync(absPath)) {
    console.error(`❌  File not found: ${absPath}`);
    process.exit(1);
  }
  if (!absPath.endsWith(".brick")) {
    console.error(`❌  Expected a .brick file, got: ${absPath}`);
    process.exit(1);
  }
  const source = fs.readFileSync(absPath, "utf8");
  return { source, absPath };
}

// ── Import resolution ─────────────────────────────────────────────────────────

function resolveImports(entryPath: string): BrickFile {
  const visited = new Set<string>();

  function loadFile(absPath: string): TopLevel[] {
    if (visited.has(absPath)) return [];
    visited.add(absPath);

    if (!fs.existsSync(absPath)) {
      console.error(c.red(`  ✕  Import not found: ${absPath}`));
      return [];
    }

    const src = fs.readFileSync(absPath, "utf8");
    const result = parse(src);
    if (!result.ok) {
      const rel = path.relative(process.cwd(), absPath);
      formatParseError(src, rel, result.error, result.line, result.column);
      return [];
    }

    const decls: TopLevel[] = [];
    const dir = path.dirname(absPath);

    for (const decl of result.ast.declarations) {
      if (decl.kind === "import") {
        const importedPath = path.resolve(dir, decl.path);
        decls.push(...loadFile(importedPath));
      } else {
        decls.push(decl);
      }
    }
    return decls;
  }

  const declarations = loadFile(path.resolve(entryPath));
  return { kind: "brick_file", declarations };
}

// ── brick build ───────────────────────────────────────────────────────────────

program
  .command("build [file]")
  .description("Compile a .brick file to runbook JSON (uses brick.json entry if no file given)")
  .option("-o, --out <path>", "Output path for the JSON file")
  .option("--pretty", "Pretty-print the JSON output", true)
  .action((file: string | undefined, opts: { out?: string; pretty: boolean }) => {
    const { absPath } = loadAndParse(resolveFile(file));
    const meta = readBrickJson();
    const relSrc = path.relative(process.cwd(), absPath);
    const mergedAst = resolveImports(absPath);
    const { steps, diagnostics } = buildFromAst(mergedAst);

    const errors = diagnostics.filter(d => d.severity === "error");
    const warnings = diagnostics.filter(d => d.severity === "warning");

    if (warnings.length > 0) {
      console.log();
      warnings.forEach(w => {
        const loc = w.line ? `:${w.line}` : "";
        console.warn(c.yellow(`  ⚠  ${relSrc}${loc}  ${w.message}`));
      });
    }

    if (errors.length > 0) {
      const src = fs.readFileSync(absPath, "utf8");
      const srcLines = src.split("\n");
      console.log();
      console.log(c.red(c.bold("  Build failed")));
      errors.forEach(e => {
        const lineNum = e.line ?? 0;
        const colNum  = e.column ?? 1;
        const srcLine = lineNum > 0 ? (srcLines[lineNum - 1] ?? "") : "";
        const gutter  = String(lineNum).padStart(3);
        const blank   = " ".repeat(gutter.length);
        console.log();
        console.log(`  ${c.red("✕")}  ${relSrc}${lineNum ? `:${lineNum}` : ""}  ${e.message}`);
        if (srcLine) {
          console.log(`  ${c.gray(gutter)} │  ${c.dim(srcLine)}`);
          const caret = " ".repeat(Math.max(0, colNum - 1)) + "^";
          console.log(`  ${blank} │  ${c.red(caret)}`);
        }
      });
      console.log();
      process.exit(1);
    }

    const json = opts.pretty
      ? JSON.stringify(steps, null, 2)
      : JSON.stringify(steps);

    const outPath = opts.out ?? absPath.replace(/\.brick$/, ".json");
    fs.writeFileSync(outPath, json, "utf8");

    const relOut = path.relative(process.cwd(), outPath);
    console.log();
    console.log(c.green(c.bold("  Build complete")));
    console.log();
    if (meta) console.log(`  ${c.dim("module")}   ${c.bold(meta.module)}  ${c.dim("v" + meta.version)}`);
    console.log(`  ${c.dim("source")}   ${relSrc}`);
    console.log(`  ${c.dim("output")}   ${relOut}`);
    console.log(`  ${c.dim("steps")}    ${c.cyan(String(steps.length))}`);
    console.log();
  });

// ── brick lint ────────────────────────────────────────────────────────────────

program
  .command("lint [file]")
  .description("Lint a .brick file (uses brick.json entry if no file given)")
  .option("--json", "Output diagnostics as JSON")
  .action((file: string | undefined, opts: { json: boolean }) => {
    const { source } = loadAndParse(resolveFile(file));
    const { diagnostics } = buildFromSource(source);

    if (opts.json) {
      console.log(JSON.stringify(diagnostics, null, 2));
      process.exit(diagnostics.some(d => d.severity === "error") ? 1 : 0);
    }

    if (diagnostics.length === 0) {
      console.log("✅  No issues found");
      return;
    }

    let hasErrors = false;
    for (const d of diagnostics) {
      const icon = d.severity === "error" ? "❌" : d.severity === "warning" ? "⚠️ " : "ℹ️ ";
      const loc = d.line ? `:${d.line}${d.column ? `:${d.column}` : ""}` : "";
      console.log(`${icon}  ${loc}  ${d.message}`);
      if (d.severity === "error") hasErrors = true;
    }

    if (hasErrors) process.exit(1);
  });

// ── brick print ───────────────────────────────────────────────────────────────

program
  .command("print [file]")
  .description("Parse and re-serialize a .brick file")
  .action((file: string | undefined) => {
    const { source } = loadAndParse(resolveFile(file));
    const { steps, diagnostics } = buildFromSource(source);

    const errors = diagnostics.filter(d => d.severity === "error");
    if (errors.length > 0) {
      errors.forEach(e => console.error(`❌  ${e.message}`));
      process.exit(1);
    }

    console.log(serialize(steps));
  });

// ── brick new ────────────────────────────────────────────────────────────────

program
  .command("new [name]")
  .description("Scaffold a new brick project: brick.json + src/main.brick")
  .action((name = "project") => {
    const projectDir = path.resolve(name);
    const srcDir = path.join(projectDir, "src");

    if (fs.existsSync(projectDir)) {
      console.error(`❌  Directory already exists: ${projectDir}`);
      process.exit(1);
    }

    fs.mkdirSync(srcDir, { recursive: true });

    const moduleName = name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]([a-z])/g, (_m: string, c: string) => c.toUpperCase());

    const meta: BrickJson = {
      name,
      module: moduleName,
      version: "0.1.0",
      description: "",
      entry: "src/main.brick",
      author: "",
      types: "src/types.brick",
      compiler: { strict: true, target: "playwright" },
      env: {},
    };
    fs.writeFileSync(path.join(projectDir, "brick.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

    const template = `module ${moduleName}\n\nfn main() {\n  // Start writing your automation here\n  navigate "https://example.com"\n  screenshot -> @snap\n  ai "Describe what you see on the page" -> @description\n}\n`;
    fs.writeFileSync(path.join(srcDir, "main.brick"), template, "utf8");
    fs.writeFileSync(path.join(srcDir, "types.brick"), `// Shared types for ${moduleName}\n// type MyType = { field: String }\n`, "utf8");

    console.log(`✅  Created ${name}/`);
    console.log(`    brick.json`);
    console.log(`    src/main.brick`);
    console.log(`\n  Run: cd ${name} && brick build`);
  });

// ── CLI entry ─────────────────────────────────────────────────────────────────

program
  .name("brick")
  .description("The Brick DSL toolchain")
  .version("0.2.0");

program.parse(process.argv);
