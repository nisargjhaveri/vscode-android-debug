import * as vscode from 'vscode';
import * as logger from './logger';
import { TargetType, Target } from './commonTypes';
import { getAdb, getDeviceAdb } from './adb';

let context: vscode.ExtensionContext;

interface TargetQuickPickItem extends vscode.QuickPickItem {
    target: Target;
}

var currentTarget: Target|undefined;

async function listTargets(): Promise<Target[]> {
    let adb = await getAdb();

    let devices = await Promise.all((await adb.getConnectedDevices({verbose: true})).map(async d => {
        let deviceAdb = await getDeviceAdb(d);

        let type : TargetType = d.udid.startsWith("emulator-") ? "Emulator" : "Device";
        let name = type === "Emulator" ? (await deviceAdb.sendTelnetCommand("avd name")).replace(/_/g, " ") : await deviceAdb.getModel();

        return {
            ...d,
            type,
            name,
        };
    }));

    console.log(devices);
    return devices;
}

export async function pickTarget()
{
    let getQuickPickItems = async (): Promise<TargetQuickPickItem[]> => {
        let targets = await listTargets();
        return targets
            .sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type.localeCompare(b.type);
                }

                return a.name.localeCompare(b.name);
            })
            .map((t): TargetQuickPickItem => ({
                label: t.name,
                detail: `${t.type}`,
                target: t,
            }));
    };

    let quickPickOptions: vscode.QuickPickOptions = {
        title: "Select Android Target",
        matchOnDescription: true,
    };

    let target = (await vscode.window.showQuickPick(getQuickPickItems(), quickPickOptions))?.target;

    logger.log("Picked target", target);

    return target;
}

export async function getOrPickTarget() {
    if (currentTarget) { return currentTarget; }

    return await pickTarget();
}

export function setCurrentTarget(target: Target) {
    currentTarget = target;
}

export function resetCurrentTarget() {
    currentTarget = undefined;
}

export function getCurrentTarget() {
    return currentTarget;
}

// Activation
export function activate(c: vscode.ExtensionContext)
{
    context = c;
}
