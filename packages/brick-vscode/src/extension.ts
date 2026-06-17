import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { buildFromSource } from "@brick/core";

// grammar.js is excluded from the bundle (see esbuild.js external[]) and
// copied to out/grammar.js at build time so brick-core's parse() can find it.
// We patch the require path here before any parse call happens.
const grammarPath = path.join(__dirname, "grammar.js");
if (fs.existsSync(grammarPath)) {
  // Prime the module cache so brick-core's require("./grammar.js") resolves correctly
  require(grammarPath);
}

let diagnosticCollection: vscode.DiagnosticCollection;

function lintDocument(doc: vscode.TextDocument): void {
  if (doc.languageId !== "brick") return;

  const source = doc.getText();
  let diagnostics: vscode.Diagnostic[] = [];

  try {
    const { diagnostics: diags } = buildFromSource(source);

    diagnostics = diags.map(d => {
      const line = Math.max((d.line ?? 1) - 1, 0);
      const col  = Math.max((d.column ?? 1) - 1, 0);
      const range = new vscode.Range(line, col, line, col + 80);

      const severity =
        d.severity === "error"   ? vscode.DiagnosticSeverity.Error :
        d.severity === "warning" ? vscode.DiagnosticSeverity.Warning :
                                   vscode.DiagnosticSeverity.Information;

      return new vscode.Diagnostic(range, d.message, severity);
    });
  } catch {
    // silently skip parse errors during live typing
  }

  diagnosticCollection.set(doc.uri, diagnostics);
}

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection("brick");
  context.subscriptions.push(diagnosticCollection);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lintDocument),
    vscode.workspace.onDidChangeTextDocument(e => lintDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument(d => diagnosticCollection.delete(d.uri)),
  );

  vscode.workspace.textDocuments.forEach(lintDocument);

  // brick.build command
  context.subscriptions.push(
    vscode.commands.registerCommand("brick.build", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "brick") {
        vscode.window.showWarningMessage("Open a .brick file first");
        return;
      }

      const source = editor.document.getText();
      const filePath = editor.document.uri.fsPath;

      try {
        const { steps, diagnostics } = buildFromSource(source);
        const errors = diagnostics.filter(d => d.severity === "error");

        if (errors.length > 0) {
          vscode.window.showErrorMessage(`Brick build failed: ${errors[0].message}`);
          return;
        }

        const outPath = filePath.replace(/\.brick$/, ".json");
        fs.writeFileSync(outPath, JSON.stringify(steps, null, 2), "utf8");
        vscode.window.showInformationMessage(
          `✅ Built ${steps.length} steps → ${path.basename(outPath)}`
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Brick build error: ${(e as Error).message}`);
      }
    }),
  );

  // brick.lint command
  context.subscriptions.push(
    vscode.commands.registerCommand("brick.lint", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "brick") {
        vscode.window.showWarningMessage("Open a .brick file first");
        return;
      }
      lintDocument(editor.document);
      vscode.window.showInformationMessage("Brick: lint complete — check Problems panel");
    }),
  );
}

export function deactivate(): void {
  diagnosticCollection?.dispose();
}
