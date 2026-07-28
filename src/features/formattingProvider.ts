import * as vscode from 'vscode';
import { getLanguageService, TextDocument } from 'vscode-html-languageservice';

const htmlLS = getLanguageService();

export class ChocolaFormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] {
    const htmlDoc = TextDocument.create(
      document.uri.toString(),
      'html',
      0,
      document.getText()
    );

    const edits = htmlLS.format(htmlDoc, undefined, {
      tabSize: options.tabSize,
      insertSpaces: options.insertSpaces,
    });

    return edits.map(e => {
      const start = new vscode.Position(e.range.start.line, e.range.start.character);
      const end = new vscode.Position(e.range.end.line, e.range.end.character);
      return new vscode.TextEdit(new vscode.Range(start, end), e.newText);
    });
  }
}