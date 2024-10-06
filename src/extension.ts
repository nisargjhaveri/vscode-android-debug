// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { logger } from './logger';
import * as targetPicker from './targetPicker';
import * as targetCommand from './targetCommand';
import * as debugConfigProvider from './debugConfigProvider';
import * as debugLifecycleManager from './debugLifecycleManager';
import * as debugAdapter from './debugAdapter';
import * as androidPaths from './androidPaths';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
    logger.log('Activating extension "android-debug"');

    targetPicker.activate(context);
    targetCommand.activate(context);
    debugLifecycleManager.activate(context);

    context.subscriptions.push(vscode.commands.registerCommand('android-debug.pickAndroidProcess', targetCommand.pickAndroidProcess));
    context.subscriptions.push(vscode.commands.registerCommand('android-debug.getBestAbi', targetCommand.getBestAbi));
    context.subscriptions.push(vscode.commands.registerCommand('android-debug.getBestMappedAbi', targetCommand.getBestMappedAbi));

    context.subscriptions.push(vscode.commands.registerCommand('android-debug.resumeWaitingProcess', targetCommand.resumeWaitingProcess));

    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('lldb', new debugConfigProvider.LLDBDebugConfigurationProvider()));
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('java', new debugConfigProvider.JavaDebugConfigurationProvider()));
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('android-debug', new debugConfigProvider.AndroidDebugConfigurationProvider()));

    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('android-debug', new debugAdapter.DebugAdapterDescriptorFactory(context)));

    await androidPaths.activate(context);
}

// this method is called when your extension is deactivated
export function deactivate() {}
