import * as vscode from 'vscode';
import * as logger from './logger';
import { Target } from './commonTypes';
import * as targetCommand from './targetCommand';
import * as targetPicker from './targetPicker';

async function getTarget(androidTarget: string): Promise<Target|undefined> {
    if (androidTarget === "select") {
        return await targetPicker.pickTarget();
    }
    else if (androidTarget === "last-selected") {
        return await targetPicker.getLastOrPickTarget();
    }
    else if (typeof androidTarget === "string") {
        return await targetPicker.getTargetFromUDID(androidTarget);
    }

    return undefined;
}

export class LLDBDebugConfigurationProvider implements vscode.DebugConfigurationProvider
{
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder|undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("resolveDebugConfiguration", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        if (dbgConfig.request !== "attach") { return null; }

        let target: Target|undefined = await getTarget(dbgConfig.androidTarget);
        if (!target) { return null; }

        dbgConfig.androidTarget = target;

        targetPicker.setCurrentTarget(target);
        targetCommand.setCurrentDebugConfiguration(dbgConfig);

        return dbgConfig;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder|undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("resolveDebugConfigurationWithSubstitutedVariables", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        let target: Target = dbgConfig.androidTarget;

        dbgConfig.androidAppAbi = await targetCommand.getBestAbi({device: target});

        targetPicker.resetCurrentTarget();
        targetCommand.resetCurrentDebugConfiguration();

        let socket = await targetCommand.lldbServer({
            device: target, 
            packageName: dbgConfig.androidPackageName,
            abi: dbgConfig.androidAppAbi
        });
        if (!socket) { return null; }

        dbgConfig.androidLldbServerSocket = socket;

        dbgConfig.initCommands = (dbgConfig.initCommands instanceof Array) ? dbgConfig.initCommands : [];
        dbgConfig.initCommands.unshift(`platform connect unix-abstract-connect://[${target.udid}]${socket}`);
        dbgConfig.initCommands.unshift(`platform select remote-android`);

        dbgConfig.initCommands.push(`settings set target.inherit-env false`);
        for (let symbolSeachPath of dbgConfig.symbolSearchPaths) {
            dbgConfig.initCommands.push(`settings append target.exec-search-paths '${symbolSeachPath}'`);
        }

        logger.log("resolved debug configuration", dbgConfig);
        return dbgConfig;
    }
}

export class JavaDebugConfigurationProvider implements vscode.DebugConfigurationProvider
{
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder|undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("resolveDebugConfiguration", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        if (dbgConfig.request !== "attach") { return null; }

        let target: Target|undefined = await getTarget(dbgConfig.androidTarget);
        if (!target) { return null; }

        dbgConfig.androidTarget = target;

        // We need to specify hostname and port to prevent java extension to mark the config invalid.
        // This will be updated later resolveDebugConfigurationWithSubstitutedVariables.
        dbgConfig.hostName = dbgConfig.hostName || "localhost";
        dbgConfig.port = dbgConfig.port || 8000;

        dbgConfig.androidPid = dbgConfig.processId;
        dbgConfig.processId = undefined;

        targetPicker.setCurrentTarget(target);

        return dbgConfig;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder|undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("resolveDebugConfigurationWithSubstitutedVariables", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        let target: Target = dbgConfig.androidTarget;

        targetPicker.resetCurrentTarget();

        let port = await targetCommand.forwardJdwpPort({
            device: target,
            pid: dbgConfig.androidPid,
        });
        if (!port) { return null; }

        dbgConfig.androidJdwpPort = port;

        dbgConfig.hostName = "localhost";
        dbgConfig.port = port;

        logger.log("resolved debug configuration", dbgConfig);
        return dbgConfig;
    }
}
