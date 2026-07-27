import * as vscode from 'vscode';
import { findComponents, getLibDir } from '../utils/project';
import * as path from 'path';

const DIRECTIVE_HOVERS: Record<string, string> = {
  'if': 'Conditionally hides element via `display: none` when the expression is falsy. Element stays in the DOM.',
  'del:if': 'Conditionally **removes** the element from the DOM when the expression is falsy.',
  'elif': 'Alternative condition in a conditional chain. Must follow an `if` or `del:if` sibling.',
  'else': 'Fallback in a conditional chain. Must follow an `if`/`del:if`/`elif` sibling.',
  'bind:self': 'Captures the DOM element reference into a script variable. Evaluated at mount time, before `$runtime()`.',
  'bind': 'Captures a DOM element property (e.g. `value`, `innerText`, `type`) into a script variable. Evaluated at mount time, before `$runtime()`.',
};

const SPECIAL_ELEMENT_HOVERS: Record<string, string> = {
  'slot': 'Content projection placeholder. Replaced by children passed from the parent component.',
  'void': 'Transparent wrapper element that never renders in the final DOM. Useful for conditional logic without extra wrapper nodes.',
};

const SCRIPT_HOVERS: Record<string, string> = {
  '$runtime': 'Lifecycle function that runs **once** after the component is mounted in the DOM.\n\n**Parameters:**\n- `self` — root DOM element of this component instance\n- `ctx` — object containing props and other dynamic values',
  'self': 'Root DOM element of this component instance. Available inside `$runtime()` and after `bind:*` evaluation.',
  'ctx': 'Object containing props and dynamic values for this component. Available inside `$runtime()`.',
};

export class ChocolaHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) return undefined;

    const word = document.getText(wordRange);
    const line = document.lineAt(position.line).text;

    const directiveHover = this.getDirectiveHover(line, position);
    if (directiveHover) return directiveHover;

    const elementHover = this.getElementHover(word, line);
    if (elementHover) return elementHover;

    const scriptHover = this.getScriptHover(document, word, position);
    if (scriptHover) return scriptHover;

    const cssHover = this.getCssHover(document, word, position);
    if (cssHover) return cssHover;

    const componentHover = this.getComponentHover(word);
    if (componentHover) return componentHover;

    return undefined;
  }

  private getDirectiveHover(line: string, position: vscode.Position): vscode.Hover | undefined {
    for (const [name, detail] of Object.entries(DIRECTIVE_HOVERS)) {
      const escaped = name.replace(':', '\\:');
      const re = new RegExp(`\\b(${escaped})\\b`);
      const match = line.match(re);
      if (match) {
        const idx = line.indexOf(match[1]);
        if (idx <= position.character && position.character <= idx + match[1].length) {
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`**${name}** — Chocola directive\n\n${detail}`);
          return new vscode.Hover(md);
        }
      }
    }
    return undefined;
  }

  private getElementHover(word: string, line: string): vscode.Hover | undefined {
    for (const [name, detail] of Object.entries(SPECIAL_ELEMENT_HOVERS)) {
      if (word === name || line.includes(`<${name}`) || line.includes(`</${name}>`)) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**\`<${name}>\`** — Chocola special element\n\n${detail}`);
        return new vscode.Hover(md);
      }
    }
    return undefined;
  }

  private getScriptHover(document: vscode.TextDocument, word: string, position: vscode.Position): vscode.Hover | undefined {
    if (!this.isInsideScript(document, position)) return undefined;

    for (const [name, detail] of Object.entries(SCRIPT_HOVERS)) {
      if (word === name) {
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${name}** — Chocola ${name === '$runtime' ? 'lifecycle' : 'injected'} variable\n\n${detail}`);
        return new vscode.Hover(md);
      }
    }
    return undefined;
  }

  private getCssHover(document: vscode.TextDocument, word: string, position: vscode.Position): vscode.Hover | undefined {
    if (!this.isInsideStyle(document, position)) return undefined;

    if (word === ':root') {
      const md = new vscode.MarkdownString();
      md.appendMarkdown('**:root** — Chocola CSS scoping\n\nPlaceholder for the component\'s root element in scoped styles. Maps to the component\'s root DOM element.');
      return new vscode.Hover(md);
    }
    return undefined;
  }

  private getComponentHover(word: string): vscode.Hover | undefined {
    if (!/^[A-Z]/.test(word)) return undefined;

    const libDir = getLibDir();
    if (!libDir) return undefined;

    const components = findComponents(libDir);
    const comp = components.find(c => c.name === word);
    if (!comp) return undefined;

    const propsList = comp.props.length > 0
      ? comp.props.map(p => `- \`${p.name}\`${p.defaultValue ? ` = \`${p.defaultValue}\`` : ''}`).join('\n')
      : '_(no props)_';

    const relPath = path.relative(
      vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || '',
      comp.filePath
    );

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**\`<${word}>\`** — Chocola component\n\n**Props:**\n${propsList}\n\n📄 \`${relPath}\``);
    return new vscode.Hover(md);
  }

  private isInsideScript(document: vscode.TextDocument, position: vscode.Position): boolean {
    return this.isInsideSection(document, position, '<script>', '</script>');
  }

  private isInsideStyle(document: vscode.TextDocument, position: vscode.Position): boolean {
    return this.isInsideSection(document, position, '<style>', '</style>');
  }

  private isInsideSection(document: vscode.TextDocument, position: vscode.Position, openTag: string, closeTag: string): boolean {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const beforeText = text.substring(0, offset);
    const lastOpen = beforeText.lastIndexOf(openTag);
    const lastClose = beforeText.lastIndexOf(closeTag);
    if (lastOpen === -1) return false;
    return lastOpen > lastClose;
  }
}
