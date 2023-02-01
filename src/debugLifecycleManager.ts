import * as vscode from 'vscode';
import { logger } from './logger';
import * as targetCommand from './targetCommand';

function onDidStartDebugSession(debugSession: vscode.DebugSession) {
    logger.log("Debug session started", `(type: ${debugSession.type}, id: ${debugSession.id})`);
}

function onDidTerminateDebugSession(debugSession: vscode.DebugSession) {
    logger.log("Debug session terminated", `(type: ${debugSession.type}, id: ${debugSession.id})`);

    if (debugSession.type === 'lldb' && debugSession.configuration?.androidLldbServerSocket) {
        targetCommand.lldbServerCleanup(debugSession.configuration.androidLldbServerSocket);
    }

    if (debugSession.type === "java" && debugSession.configuration?.androidTarget && debugSession.configuration?.androidJdwpPort) {
        targetCommand.removeTcpForward(debugSession.configuration.androidTarget, debugSession.configuration.androidJdwpPort);
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.debug.onDidStartDebugSession(onDidStartDebugSession));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(onDidTerminateDebugSession));
}