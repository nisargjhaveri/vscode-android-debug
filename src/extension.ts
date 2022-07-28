// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import * as logger from './logger';
import * as targetPicker from './targetPicker';
import * as targetCommand from './targetCommand';
import * as debugConfigProvider from './debugConfigProvider';
import * as adb from './adb';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	logger.activate();
	logger.log('Activating extension "android-debug"');

	targetPicker.activate(context);
	targetCommand.activate(context);

	let sdkRoot: string|undefined = vscode.workspace.getConfiguration().get("android-debug.sdkRoot");
	let lldbServerRoot: string|undefined = vscode.workspace.getConfiguration().get("android-debug.lldbServerRoot");
	adb.activate(sdkRoot, lldbServerRoot);

	context.subscriptions.push(vscode.commands.registerCommand('android-debug.pickTarget', targetPicker.pickTarget));

	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lldb', new debugConfigProvider.DebugConfigurationProvider()));
}

// this method is called when your extension is deactivated
export function deactivate() {}
