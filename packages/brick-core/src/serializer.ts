import type { RunbookStep } from "./compiler";

// Converts an array of RunbookStep back to .brick source code
export function serialize(steps: RunbookStep[], fnName = "main"): string {
  const lines: string[] = [`fn ${fnName}() {`];

  for (const step of steps) {
    lines.push("  " + stepToLine(step));
  }

  lines.push("}");
  return lines.join("\n");
}

function q(value: string): string {
  // Quote a value: if it looks like a @variable leave it, else wrap in double quotes
  if (value.startsWith("@")) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function stepToLine(step: RunbookStep): string {
  switch (step.type) {
    case "navigate":
      return `go to ${q(step.url)}`;

    case "click":
      return step.label
        ? `click ${q(step.selector)} as "${step.label}"`
        : `click ${q(step.selector)}`;

    case "set_input": {
      const base = `fill ${q(step.field)} with ${q(step.value)}`;
      return step.variable ? `${base} -> @${step.variable}` : base;
    }

    case "type":
      return `type ${q(step.selector)} with ${q(step.text)}`;

    case "set_dropdown":
      return `select ${q(step.selector)} to ${q(step.value)}`;

    case "press_key":
      return `press ${step.key}`;

    case "wait": {
      const ms = step.ms;
      if (ms % 60000 === 0) return `wait ${ms / 60000}m`;
      if (ms % 1000 === 0)  return `wait ${ms / 1000}s`;
      return `wait ${ms}ms`;
    }

    case "scroll":
      return `scroll ${q(step.selector)} by ${step.deltaY}`;

    case "screenshot":
      return step.variable ? `screenshot -> @${step.variable}` : `screenshot`;

    case "action": {
      const base = `ai "${step.instruction.replace(/"/g, '\\"')}"`;
      return step.variable ? `${base} -> @${step.variable}` : base;
    }

    case "extract_table":
      return `extract table "${step.description.replace(/"/g, '\\"')}" -> @${step.variable}`;

    case "set_variable": {
      // Try to pretty-print as a literal if it's JSON-parseable
      let val: string;
      try {
        const parsed = JSON.parse(step.value);
        val = JSON.stringify(parsed, null, 2);
      } catch {
        val = q(step.value);
      }
      return `${val} -> @${step.variable}`;
    }

    case "extract":
      return `extract from @${step.source} "${step.query.replace(/"/g, '\\"')}" -> @${step.variable}`;

    case "js_block": {
      const body = step.code.split("\n").map(l => "    " + l).join("\n");
      const base = `js {\n${body}\n  }`;
      return step.variable ? `${base} -> @${step.variable}` : base;
    }

    case "py_block": {
      const body = step.code.split("\n").map(l => "    " + l).join("\n");
      const base = `python {\n${body}\n  }`;
      return step.variable ? `${base} -> @${step.variable}` : base;
    }

    case "excel_to_csv":
      return `load excel ${q(step.file)} sheet "${step.sheet}" -> @${step.variable}`;

    case "upload_file": {
      const base = `upload ${q(step.file)} to ${q(step.selector)}`;
      return step.variable ? `${base} -> @${step.variable}` : base;
    }

    case "write_docx": {
      const body = step.content.split("\n").map(l => "  " + l).join("\n");
      return `report title: "${step.title.replace(/"/g, '\\"')}" {\n${body}\n  }`;
    }

    case "gen_primitive": {
      const model = step.model ? ` using "${step.model}"` : "";
      const base = `gen "${step.prompt?.replace(/"/g, '\\"')}"${model}`;
      return step.variable ? `${base} -> @${step.variable}` : base;
    }

    case "gen_with_code": {
      const model = step.model ? ` using "${step.model}"` : "";
      const base = `gen_code "${step.prompt?.replace(/"/g, '\\"')}"${model}`;
      return step.variable ? `${base} -> @${step.variable}` : base;
    }

    case "set_cookies":
      return `set_cookies ${q(step.cookies)}`;

    case "excel_to_csvs":
      return `load_excel_all ${q(step.source)} -> @${step.variable}`;

    case "read_pdf":
      return `read_pdf ${q(step.source)} -> @${step.variable}`;

    case "ocr_image":
      return `ocr ${q(step.source)} -> @${step.variable}`;

    case "open_file": {
      const fname = step.filename ? ` as "${step.filename}"` : "";
      return `open_file ${q(step.source)}${fname} -> @${step.variable}`;
    }

    case "read_gdoc":
      return `read_gdoc ${q(step.url)} -> @${step.variable}`;
    case "load_sheet":
      return `load_sheet ${q(step.name)} -> @${step.variable}`;

    case "compound_assign":
      return `@${step.variable} ${step.op} ${step.value}`;

    case "log":
      return `log ${q(step.value)}`;

    case "fail":
      return `fail "${step.message.replace(/"/g, '\\"')}"`;

    case "break":    return "break";
    case "continue": return "continue";

    case "if": {
      const cond = serializeCondition(step.condition);
      const thenLines = step.then.map(s => "  " + stepToLine(s)).join("\n");
      const base = `if ${cond} {\n${thenLines}\n}`;
      if (!step.else || step.else.length === 0) return base;
      const elseLines = step.else.map(s => "  " + stepToLine(s)).join("\n");
      return `${base} else {\n${elseLines}\n}`;
    }

    case "for_each": {
      const body = step.body.map(s => "  " + stepToLine(s)).join("\n");
      return `for @${step.variable} in ${q(step.collection)} {\n${body}\n}`;
    }

    case "repeat": {
      const body = step.body.map(s => "  " + stepToLine(s)).join("\n");
      return `repeat ${step.count} {\n${body}\n}`;
    }

    case "while": {
      const cond = serializeCondition(step.condition);
      const body = step.body.map(s => "  " + stepToLine(s)).join("\n");
      return `while ${cond} {\n${body}\n}`;
    }

    default:
      return `// unknown step: ${(step as { type: string }).type}`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeCondition(cond: Record<string, any>): string {
  if (cond.op && cond.left && cond.right) {
    return `${serializeCondAtom(cond.left)} ${cond.op} ${serializeCondAtom(cond.right)}`;
  }
  if (cond.op === "not") return `not ${serializeCondAtom(cond.expr)}`;
  return serializeCondAtom(cond);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeCondAtom(atom: Record<string, any>): string {
  if (atom.type === "var")     return `@${atom.name}`;
  if (atom.type === "prop")    return `@${atom.var}.${atom.prop}`;
  if (atom.type === "literal") return typeof atom.value === "string" ? `"${atom.value}"` : String(atom.value);
  return String(atom);
}
