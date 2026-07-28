import * as vscode from 'vscode';
import { findComponents, getLibDir } from '../utils/project';
import * as path from 'path';
import * as fs from 'fs';

const ELIF_RE = /\w+\s+elif\s*=\s*\{/;
const ELSE_RE = /\w+\s+else\s*(?:>|\/)/;
const IF_RE = /\w+\s+if\s*=\s*\{/;
const DELIF_RE = /\w+\s+del:if\s*=\s*\{/;
const COMPONENT_TAG_RE = /<([A-Z][a-zA-Z0-9]*)\b/g;
const BIND_VAR_RE = /bind:(?:self|\w+)\s*=\s*"(\w+)"/g;
const COMPONENT_IMPORT_RE = /import\s+\w+\s+from\s+["']([^"']+\.html)["']/g;

export class ChocolaDiagnosticsProvider {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private timeoutHandle: NodeJS.Timeout | undefined;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('chocola');
  }

  dispose() {
    this.diagnosticCollection.clear();
    this.diagnosticCollection.dispose();
  }

  activate() {
    if (vscode.window.activeTextEditor) {
      this.runDiagnostics(vscode.window.activeTextEditor.document);
    }
  }

  deactivate() {
    this.dispose();
  }

  refreshDiagnostics(document: vscode.TextDocument) {
    if (document.languageId !== 'chocola') return;

    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = setTimeout(() => {
      this.runDiagnostics(document);
    }, 500);
  }

  private runDiagnostics(document: vscode.TextDocument) {
    if (document.languageId !== 'chocola') return;

    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    this.checkConditionalChain(lines, diagnostics);
    this.checkComponentTags(document, lines, text, diagnostics);
    this.checkBindVariables(text, diagnostics);
    this.checkScriptSection(document, text, diagnostics);

    this.diagnosticCollection.set(document.uri, diagnostics);
  }

  private checkConditionalChain(lines: string[], diagnostics: vscode.Diagnostic[]) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (ELIF_RE.test(line) || ELSE_RE.test(line)) {
        let foundIf = false;
        for (let j = i - 1; j >= 0; j--) {
          const prevLine = lines[j];
          if (IF_RE.test(prevLine) || DELIF_RE.test(prevLine) || ELIF_RE.test(prevLine)) {
            foundIf = true;
            break;
          }
          if (!prevLine.trim() || prevLine.trim().startsWith('<!--') || prevLine.includes('<')) {
            continue;
          }
          break;
        }

        if (!foundIf) {
          const diag = new vscode.Diagnostic(
            new vscode.Range(i, 0, i, line.length),
            '`elif`/`else` without a preceding `if`/`del:if`/`elif` sibling',
            vscode.DiagnosticSeverity.Error
          );
          diagnostics.push(diag);
        }
      }
    }
  }

  private checkComponentTags(
    document: vscode.TextDocument,
    lines: string[],
    text: string,
    diagnostics: vscode.Diagnostic[]
  ) {
    const libDir = getLibDir();
    if (!libDir) return;

    const components = findComponents(libDir);
    const componentNames = new Set(components.map(c => c.name));

    const re = new RegExp(COMPONENT_TAG_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const tagName = match[1];
      if (!componentNames.has(tagName)) continue;

      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);

      const line = lines[startPos.line].trim();
      const isSelfClosing = />\s*$/.test(line) || /\/\s*>/.test(line);

      if (!isSelfClosing) {
        const closeTag = `</${tagName}>`;
        const afterText = text.substring(match.index + match[0].length);
        if (!afterText.includes(closeTag)) {
          const diag = new vscode.Diagnostic(
            new vscode.Range(startPos, endPos),
            `Missing closing tag </${tagName}> for component`,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostics.push(diag);
        }
      }
    }
  }

  private checkBindVariables(text: string, diagnostics: vscode.Diagnostic[]) {
    const scriptMatch = text.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return;

    const declaredVars = new Set<string>();
    const letRe = /let\s+(\w+)(?:\s*[=;])/g;
    let m: RegExpExecArray | null;
    while ((m = letRe.exec(scriptMatch[1])) !== null) {
      declaredVars.add(m[1]);
    }

    const bindRe = new RegExp(BIND_VAR_RE.source, 'g');
    while ((m = bindRe.exec(text)) !== null) {
      const varName = m[1];
      if (!declaredVars.has(varName)) {
        const idx = m.index + m[0].indexOf('"' + varName);
        const pos = this.offsetToPosition(text, idx + 1);
        const diag = new vscode.Diagnostic(
          new vscode.Range(pos, pos.translate(0, varName.length)),
          `Variable "${varName}" used in bind:* but not declared in <script>`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostics.push(diag);
      }
    }
  }

  private checkScriptSection(document: vscode.TextDocument, text: string, diagnostics: vscode.Diagnostic[]) {
    const scriptMatch = text.match(/<script>([\s\S]*?)<\/script>/);
    if (!scriptMatch) return;

    const importRe = new RegExp(COMPONENT_IMPORT_RE.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = importRe.exec(scriptMatch[1])) !== null) {
      const importPath = match[2];
      const resolvedPath = path.resolve(path.dirname(document.fileName), importPath);
      if (!fs.existsSync(resolvedPath)) {
        const importStart = match.index;
        const idx = importStart + match[0].indexOf(importPath);
        const globalIdx = (scriptMatch.index ?? 0) + idx;
        const pos = this.offsetToPosition(text, globalIdx);
        const diag = new vscode.Diagnostic(
          new vscode.Range(pos, pos.translate(0, importPath.length)),
          `Cannot resolve import "${importPath}"`,
          vscode.DiagnosticSeverity.Error
        );
        diagnostics.push(diag);
      }
    }
  }

  private offsetToPosition(text: string, offset: number): vscode.Position {
    const lines = text.substring(0, Math.max(0, offset)).split('\n');
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
  }
}
