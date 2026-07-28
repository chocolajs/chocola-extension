import * as vscode from 'vscode';
import { findComponents, getImportedComponents, getLibDir } from '../utils/project';

interface DirectiveDef {
  label: string;
  kind: vscode.CompletionItemKind;
  detail: string;
  snippet: string;
  filterText?: string;
}

const DIRECTIVE_DEFS: DirectiveDef[] = [
  {
    label: 'if={}',
    kind: vscode.CompletionItemKind.Property,
    detail: 'Conditionally hides element (display: none when false)',
    snippet: 'if={$1}',
    filterText: 'if',
  },
  {
    label: 'del:if={}',
    kind: vscode.CompletionItemKind.Property,
    detail: 'Conditionally removes element from DOM when false',
    snippet: 'del:if={$1}',
    filterText: 'del:if',
  },
  {
    label: 'elif={}',
    kind: vscode.CompletionItemKind.Property,
    detail: 'Alternative condition (must follow if/del:if)',
    snippet: 'elif={$1}',
    filterText: 'elif',
  },
  {
    label: 'else',
    kind: vscode.CompletionItemKind.Property,
    detail: 'Fallback in conditional chain',
    snippet: 'else',
  },
  {
    label: 'bind:self=""',
    kind: vscode.CompletionItemKind.Property,
    detail: 'Captures element reference into variable',
    snippet: 'bind:self="${1:variable}"',
    filterText: 'bind:self',
  },
  {
    label: 'bind:property=""',
    kind: vscode.CompletionItemKind.Property,
    detail: 'Captures element property into variable',
    snippet: 'bind:${1:property}="${2:variable}"',
    filterText: 'bind',
  },
];

export class ChocolaCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.CompletionItem[]> {
    const items: vscode.CompletionItem[] = [];
    const linePrefix = document.lineAt(position.line).text.substring(0, position.character);

    const inTemplate = this.isInsideTemplate(document, position);
    const inScript = this.isInsideScript(document, position);

    if (inScript) {
      items.push(...this.getScriptCompletions(linePrefix));
    }

    if (inTemplate || this.isTopLevel(document, position)) {
      items.push(...this.getTemplateCompletions(document, linePrefix));
      items.push(...this.getComponentCompletions(document));
    }

    return items;
  }

  private isInsideTemplate(document: vscode.TextDocument, position: vscode.Position): boolean {
    return this.isInsideSection(document, position, '<template>', '</template>');
  }

  private isInsideScript(document: vscode.TextDocument, position: vscode.Position): boolean {
    return this.isInsideSection(document, position, '<script>', '</script>');
  }

  private isTopLevel(document: vscode.TextDocument, position: vscode.Position): boolean {
    const text = document.getText();
    const offset = document.offsetAt(position);
    const beforeText = text.substring(0, offset);
    const lastTemplateOpen = beforeText.lastIndexOf('<template>');
    const lastTemplateClose = beforeText.lastIndexOf('</template>');
    return lastTemplateOpen > lastTemplateClose;
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

  private getScriptCompletions(linePrefix: string): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    if (this.isWordStart(linePrefix, 'export')) {
      const item = new vscode.CompletionItem('export let', vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString('export let ${1:name}${2: = ${3:value}};');
      item.detail = 'Declare a component prop';
      items.push(item);
    }

    if (this.isWordStart(linePrefix, '\\$runtime')) {
      const item = new vscode.CompletionItem('$runtime', vscode.CompletionItemKind.Function);
      item.insertText = new vscode.SnippetString('function \\$runtime(self, ctx) {\n\t$0\n}');
      item.detail = 'Runs once after component is mounted';
      items.push(item);
    }

    if (this.isWordStart(linePrefix, 'self')) {
      const item = new vscode.CompletionItem('let self = new HTMLElement', vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString('let self = new HTMLElement;');
      item.detail = 'Root DOM element of this component instance';
      items.push(item);
    }

    return items;
  }

  private getTemplateCompletions(document: vscode.TextDocument, linePrefix: string): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    if (linePrefix.endsWith('<')) {
      const voidItem = new vscode.CompletionItem('void', vscode.CompletionItemKind.Constructor);
      voidItem.detail = 'Transparent wrapper (not rendered in DOM)';
      voidItem.insertText = new vscode.SnippetString('<void>$0</void>');
      items.push(voidItem);

      const slotItem = new vscode.CompletionItem('slot', vscode.CompletionItemKind.Constructor);
      slotItem.detail = 'Content projection placeholder';
      slotItem.insertText = new vscode.SnippetString('<slot></slot>');
      items.push(slotItem);
    }

    if (linePrefix.match(/<[^>]*\s\w*$/)) {
      for (const def of DIRECTIVE_DEFS) {
        const item = new vscode.CompletionItem(def.label, def.kind);
        item.detail = def.detail;
        item.insertText = new vscode.SnippetString(def.snippet);
        if (def.filterText) item.filterText = def.filterText;
        items.push(item);
      }
    }

    return items;
  }

  private getComponentCompletions(document: vscode.TextDocument): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];
    const libDir = getLibDir();
    if (!libDir) return items;

    const components = findComponents(libDir);
    if (components.length === 0) return items;

    const importedNames = new Set(getImportedComponents(document));
    if (importedNames.size === 0) return items;

    for (const comp of components) {
      if (!importedNames.has(comp.name)) continue;
      const item = new vscode.CompletionItem(comp.name, vscode.CompletionItemKind.Class);
      item.detail = `Chocola component (${comp.props.length} props)`;

      if (comp.props.length > 0) {
        const propParts = comp.props.map((p, i) =>
          `${p.name}="{${p.defaultValue ? p.defaultValue : '${' + (i + 1) + ':' + p.name + '}'}}"`
        );
        item.insertText = new vscode.SnippetString(
          `<${comp.name} ${propParts.join(' ')}$0></${comp.name}>`
        );
      } else {
        item.insertText = new vscode.SnippetString(`<${comp.name}></${comp.name}>`);
      }

      items.push(item);
    }

    return items;
  }

  private isWordStart(linePrefix: string, word: string): boolean {
    return new RegExp(`\\b${word}$`).test(linePrefix);
  }
}
