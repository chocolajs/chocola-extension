import * as vscode from 'vscode';
import { ChocolaCompletionProvider } from './features/completionProvider';
import { ChocolaHoverProvider } from './features/hoverProvider';
import { ChocolaDiagnosticsProvider } from './features/diagnosticsProvider';

let diagnosticsProvider: ChocolaDiagnosticsProvider;

export function activate(context: vscode.ExtensionContext) {
  const chocolaSelector: vscode.DocumentSelector = { language: 'chocola' };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      chocolaSelector,
      new ChocolaCompletionProvider(),
      '<',
      ' ',
      '.',
      ':',
      '=',
      '"'
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      chocolaSelector,
      new ChocolaHoverProvider()
    )
  );

  diagnosticsProvider = new ChocolaDiagnosticsProvider();
  diagnosticsProvider.activate();

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => diagnosticsProvider.refreshDiagnostics(doc)),
    vscode.workspace.onDidChangeTextDocument(e => diagnosticsProvider.refreshDiagnostics(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => diagnosticsProvider.refreshDiagnostics(doc)),
    { dispose: () => diagnosticsProvider.dispose() }
  );

  if (vscode.window.activeTextEditor) {
    diagnosticsProvider.refreshDiagnostics(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  if (diagnosticsProvider) {
    diagnosticsProvider.dispose();
  }
}
