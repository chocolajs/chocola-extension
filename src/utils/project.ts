import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const PROPS_RE = /export\s+let\s+(\w+)\s*(?:=\s*([^;]+))?;/g;
const COMPONENT_IMPORT_RE = /import\s+(\w+)\s+from\s+["']([^"']+\.html)["']/g;

export interface ComponentInfo {
  name: string;
  filePath: string;
  props: PropInfo[];
}

export interface PropInfo {
  name: string;
  defaultValue?: string;
}

export function getLibDir(uri?: vscode.Uri): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return undefined;

  const root = workspaceFolders[0].uri.fsPath;
  const configPath = path.join(root, 'chocola.config.json');
  let libDir = 'lib';

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.bundle?.libDir) {
        libDir = config.bundle.libDir;
      }
    }
  } catch {}

  const srcDir = path.join(root, 'src', libDir);
  if (fs.existsSync(srcDir)) return srcDir;
  return undefined;
}

export function findComponents(libDir: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];
  try {
    const files = fs.readdirSync(libDir);
    for (const file of files) {
      if (file.endsWith('.html')) {
        const name = path.basename(file, '.html');
        const filePath = path.join(libDir, file);
        const props = extractProps(filePath);
        components.push({ name, filePath, props });
      }
    }
  } catch {}
  return components;
}

export function extractProps(filePath: string): PropInfo[] {
  const props: PropInfo[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>/);
    if (scriptMatch) {
      const scriptContent = scriptMatch[1];
      let match: RegExpExecArray | null;
      const re = new RegExp(PROPS_RE.source, 'g');
      while ((match = re.exec(scriptContent)) !== null) {
        props.push({
          name: match[1],
          defaultValue: match[2]?.trim() || undefined,
        });
      }
    }
  } catch {}
  return props;
}

export function getImportedComponents(document: vscode.TextDocument): string[] {
  const text = document.getText();
  const scriptMatch = text.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) return [];

  const docDir = path.dirname(document.fileName);
  const names: string[] = [];
  const re = new RegExp(COMPONENT_IMPORT_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(scriptMatch[1])) !== null) {
    const resolvedPath = path.resolve(docDir, match[2]);
    const name = path.basename(resolvedPath, '.html');
    names.push(name);
  }
  return names;
}

export function getComponentNameFromTag(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const line = document.lineAt(position.line).text;
  const tagMatch = line.match(/<(\/?)([A-Z][a-zA-Z0-9]*)\b/);
  return tagMatch ? tagMatch[2] : undefined;
}

export function getConfigSchema(): any {
  return {
    type: 'object',
    properties: {
      bundle: {
        type: 'object',
        properties: {
          srcDir: { type: 'string', default: 'src' },
          outDir: { type: 'string', default: 'dist' },
          libDir: { type: 'string', default: 'lib' },
          emptyOutDir: { type: 'boolean', default: true }
        }
      },
      dev: {
        type: 'object',
        properties: {
          hostname: { type: 'string', default: 'localhost' },
          port: { type: 'number', default: 3000 }
        }
      }
    }
  };
}
