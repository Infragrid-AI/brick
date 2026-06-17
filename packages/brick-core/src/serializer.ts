import type { RunbookStep } from "./compiler";

// Converts an array of RunbookStep back to .brick source code
export function serialize(steps: RunbookStep[], fnName = "main"): string {
  const lines: string[] = [`${fnName}() {`];

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

    case "store_table":
      return `save @${step.variable} as "${step.name}"`;

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
  }
}
