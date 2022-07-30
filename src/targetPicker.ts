import * as vscode from 'vscode';
import * as logger from './logger';
import { TargetType, Target, VerboseDevice } from './commonTypes';
import { getAdb, getDeviceAdb, getDeviceFromUDID, isDeviceConnected } from './android';

let context: vscode.ExtensionContext;

interface TargetQuickPickItem extends vscode.QuickPickItem {
    target: Target;
}

// Last successfully picked target
var lastPickedTarget: Target|undefined;

// Current target for the debug session being started
var currentTarget: Target|undefined;


async function createTargetFromDevice(device: VerboseDevice): Promise<Target> {
    let deviceAdb = await getDeviceAdb(device);

    let type : TargetType = device.udid.startsWith("emulator-") ? "Emulator" : "Device";
    let name = type === "Emulator" ? (await deviceAdb.sendTelnetCommand("avd name")).replace(/_/g, " ") : await deviceAdb.getModel();

    return {
        ...device,
        type,
        name,
    };
}

async function listTargets(): Promise<Target[]> {
    let adb = await getAdb();

    let devices = await Promise.all((await adb.getConnectedDevices({verbose: true})).map(createTargetFromDevice));

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

    if (target) { lastPickedTarget = target; }

    return target;
}

// Get the last picked target if still available or pick target.
export async function getLastOrPickTarget() {
    if (lastPickedTarget && await isDeviceConnected(lastPickedTarget.udid)) {
        return lastPickedTarget;
    }

    return await pickTarget();
}

export async function getTargetFromUDID(udid: string) {
    return await createTargetFromDevice(await getDeviceFromUDID(udid));
}

// Current target is only available when a new debug session is being started
// between resolveDebugConfiguration and resolveDebugConfigurationWithSubstitutedVariables calls.
export async function getCurrentOrPickTarget() {
    if (currentTarget) { return currentTarget; }

    return await pickTarget();
}

export function getCurrentTarget() {
    return currentTarget;
}

export function setCurrentTarget(target: Target) {
    currentTarget = target;
}

export function resetCurrentTarget() {
    currentTarget = undefined;
}


// Activation
export function activate(c: vscode.ExtensionContext)
{
    context = c;
}
