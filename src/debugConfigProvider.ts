import * as vscode from 'vscode';
import { logger } from './logger';
import { Device } from './commonTypes';
import * as targetCommand from './targetCommand';
import * as targetPicker from './targetPicker';

async function getTarget(androidTarget: string): Promise<Device | undefined> {
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

export class LLDBDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("lldb resolveDebugConfiguration", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        if (dbgConfig.request !== "attach") { return null; }

        let target: Device | undefined = await getTarget(dbgConfig.androidTarget);
        if (!target) { return null; }

        dbgConfig.androidTarget = target;

        let config = vscode.workspace.getConfiguration("android-debug");
        dbgConfig.androidAbiSupported = dbgConfig.androidAbiSupported ?? config.get("abiSupported");
        dbgConfig.androidAbiMap = dbgConfig.androidAbiMap ?? config.get("abiMap");

        targetPicker.setCurrentTarget(target);
        targetCommand.setAbiResolutionInfo(dbgConfig.androidAbi, dbgConfig.androidAbiSupported, dbgConfig.androidAbiMap);
        targetCommand.setProcessPickerInfo(dbgConfig.androidPackageName);

        return dbgConfig;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("lldb resolveDebugConfigurationWithSubstitutedVariables", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        let target: Device = dbgConfig.androidTarget;

        dbgConfig.androidAbi = await targetCommand.getBestAbi({ device: target });

        targetPicker.resetCurrentTarget();
        targetCommand.resetAbiResolutionInfo();
        targetCommand.resetProcessPickerInfo();

        let socket = await targetCommand.lldbServer({
            device: target,
            packageName: dbgConfig.androidPackageName ?? await targetCommand.getPackageNameForPid({ device: target, pid: dbgConfig.pid }),
            abi: dbgConfig.androidAbi
        });
        if (!socket) { return null; }

        dbgConfig.androidLldbServerSocket = socket;

        dbgConfig.initCommands = (dbgConfig.initCommands instanceof Array) ? dbgConfig.initCommands : [];
        if (dbgConfig.signals !== undefined) {
            for (const signal of dbgConfig.signals) {
                dbgConfig.initCommands.unshift(`process handle ${signal.name} --pass ${!!signal.pass} --stop ${!!signal.stop} --notify ${!!signal.notify}`);
            }
        } else {
            // Improve Android debugging by ignoring SIGBUS and SIGSEGV signal, see https://issuetracker.google.com/issues/240007217#comment17
            dbgConfig.initCommands.unshift(`process handle SIGBUS SIGSEGV --pass true --stop false --notify false`);
        }
        dbgConfig.initCommands.unshift(`platform connect unix-abstract-connect://[${target.udid}]${socket}`);
        dbgConfig.initCommands.unshift(`platform select remote-android`);

        dbgConfig.initCommands.push(`settings set plugin.jit-loader.gdb.enable off`);
        if (dbgConfig.symbolSearchPaths) {
            for (let symbolSeachPath of dbgConfig.symbolSearchPaths) {
                dbgConfig.initCommands.push(`settings append target.exec-search-paths '${symbolSeachPath}'`);
            }
        }

        logger.log("lldb resolved debug configuration", dbgConfig);
        return dbgConfig;
    }
}

export class JavaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("java resolveDebugConfiguration", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        if (dbgConfig.request !== "attach") { return null; }

        let target: Device | undefined = await getTarget(dbgConfig.androidTarget);
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

    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("java resolveDebugConfigurationWithSubstitutedVariables", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        let target: Device = dbgConfig.androidTarget;

        targetPicker.resetCurrentTarget();

        let port = await targetCommand.forwardJdwpPort({
            device: target,
            pid: dbgConfig.androidPid,
        });
        if (!port) { return null; }

        dbgConfig.androidJdwpPort = port;

        dbgConfig.hostName = "localhost";
        dbgConfig.port = port;

        logger.log("java resolved debug configuration", dbgConfig);
        return dbgConfig;
    }
}

export class AndroidDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("android resolveDebugConfiguration", dbgConfig);

        if (dbgConfig.request !== "attach" && dbgConfig.request !== "launch") { return null; }

        let target: Device | undefined = await getTarget(dbgConfig.target ?? "select");
        if (!target) { return null; }

        dbgConfig.target = target;

        dbgConfig.native = dbgConfig.native ?? {};

        let config = vscode.workspace.getConfiguration("android-debug");
        dbgConfig.native.abiSupported = dbgConfig.native.abiSupported ?? config.get("abiSupported");
        dbgConfig.native.abiMap = dbgConfig.native.abiMap ?? config.get("abiMap");
        dbgConfig.native.signals = dbgConfig.native.signals ?? config.get("signals");

        targetPicker.setCurrentTarget(target);
        targetCommand.setAbiResolutionInfo(dbgConfig.native?.abi, dbgConfig.native.abiSupported, dbgConfig.native.abiMap);
        targetCommand.setProcessPickerInfo(dbgConfig.packageName);

        return dbgConfig;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder | undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("android resolveDebugConfigurationWithSubstitutedVariables", dbgConfig);

        if (!dbgConfig.target) { return dbgConfig; }

        let target: Device = dbgConfig.target;

        dbgConfig.mode = dbgConfig.mode ?? "java";

        if (dbgConfig.request === "attach") {
            // Resolve for attach
            dbgConfig.packageName = dbgConfig.packageName ?? await targetCommand.getPackageNameForPid({ device: target, pid: dbgConfig.pid });
            dbgConfig.resumeProcess = dbgConfig.mode === "native" ? (dbgConfig.resumeProcess ?? false) : false;
        }
        else {
            // Resolve for launch
            dbgConfig.packageName = dbgConfig.packageName ?? await targetCommand.getPackageNameFromApk(dbgConfig.apkPath);
            dbgConfig.resumeProcess = dbgConfig.mode === "native" ? (dbgConfig.resumeProcess ?? true) : false;
        }

        if (dbgConfig.mode === "native" || dbgConfig.mode === "dual") {
            dbgConfig.native.abi = await targetCommand.getBestAbi({ device: target });
        }

        targetPicker.resetCurrentTarget();
        targetCommand.resetAbiResolutionInfo();
        targetCommand.resetProcessPickerInfo();

        logger.log("android resolved debug configuration", dbgConfig);
        return dbgConfig;
    }
}
