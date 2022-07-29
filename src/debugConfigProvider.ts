import * as vscode from 'vscode';
import * as logger from './logger';
import { Target } from './commonTypes';
import * as targetCommand from './targetCommand';
import * as targetPicker from './targetPicker';


export class DebugConfigurationProvider implements vscode.DebugConfigurationProvider
{
    private async getTarget(iosTarget: string): Promise<Target|undefined> {
        if (iosTarget === "select") {
            return await targetPicker.pickTarget();
        }
        // else if (iosTarget === "last-selected") {
        //     return await _getOrPickTarget();
        // }
        // else if (typeof iosTarget === "string") {
        //     return await getTargetFromUDID(iosTarget);
        // }
        
        return undefined;
    }

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder|undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("resolveDebugConfiguration", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        if (dbgConfig.request !== "attach") { return null; }

        let target: Target|undefined = await this.getTarget(dbgConfig.androidTarget);
        if (!target) { return null; }

        targetPicker.setCurrentTarget(target);

        dbgConfig.androidTarget = target;

        dbgConfig.androidRequest = dbgConfig.request;
        dbgConfig.request = "attach";

        return dbgConfig;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(folder: vscode.WorkspaceFolder|undefined, dbgConfig: vscode.DebugConfiguration, token: vscode.CancellationToken) {
        logger.log("resolveDebugConfigurationWithSubstitutedVariables", dbgConfig);

        if (!dbgConfig.androidTarget) { return dbgConfig; }

        // if (dbgConfig.sessionName) {
        //     dbgConfig.name = dbgConfig.sessionName;
        // }

        targetPicker.resetCurrentTarget();

        let target: Target = dbgConfig.androidTarget;

        let socket = await targetCommand.lldbServer({
            device: target, 
            packageName: dbgConfig.androidPackageName
        });
        if (!socket) { return null; }

        dbgConfig.androidLldbServerSocket = socket;

        // dbgConfig.pid = pid;
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
