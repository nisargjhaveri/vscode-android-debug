// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import * as logger from './logger';
import * as targetPicker from './targetPicker';
import * as targetCommand from './targetCommand';
import * as debugConfigProvider from './debugConfigProvider';
import * as debugLifecycleManager from './debugLifecycleManager';
import * as android from './android';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    logger.activate();
    logger.log('Activating extension "android-debug"');

    targetPicker.activate(context);
    targetCommand.activate(context);
    debugLifecycleManager.activate(context);

    let sdkRoot: string|undefined = vscode.workspace.getConfiguration().get("android-debug.sdkRoot");
    let ndkRoot: string|undefined = vscode.workspace.getConfiguration().get("android-debug.ndkRoot");
    android.activate(sdkRoot, ndkRoot);

    context.subscriptions.push(vscode.commands.registerCommand('android-debug.pickAndroidProcess', targetCommand.pickAndroidProcess));

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lldb', new debugConfigProvider.DebugConfigurationProvider()));
}

// this method is called when your extension is deactivated
export function deactivate() {}
