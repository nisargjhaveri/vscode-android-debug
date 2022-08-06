import * as vscode from 'vscode';
import * as logger from './logger';
import { Device, VerboseDevice } from './commonTypes';
import * as android from './android';

let context: vscode.ExtensionContext;

export type TargetType = "Device" | "Emulator";

export interface Target extends VerboseDevice {
    name: string,
    type: TargetType,
    avdName?: string,
};

interface TargetQuickPickItem extends vscode.QuickPickItem {
    getTarget: () => Promise<Device>;
}

// Last successfully picked target
var lastPickedTarget: Device|undefined;

// Current target for the debug session being started
var currentTarget: Device|undefined;


async function createTargetFromDevice(device: VerboseDevice): Promise<Target> {
    let deviceAdb = await android.getDeviceAdb(device);

    let type : TargetType = device.udid.startsWith("emulator-") ? "Emulator" : "Device";

    let name = undefined;
    let avdName = undefined;
    if (type === "Emulator") {
        avdName = await deviceAdb.sendTelnetCommand("avd name");
        name = await android.getAvdDisplayName(avdName) || device.udid;
    }
    else {
        name = await deviceAdb.getModel();
    }

    return {
        ...device,
        type,
        name,
        avdName,
    };
}

async function getTargetPickerItems(): Promise<TargetQuickPickItem[]> {
    let adb = await android.getAdb();

    let avdList = await android.getAvdList();

    let targets = await Promise.all((await adb.getConnectedDevices({verbose: true})).map(createTargetFromDevice));

    targets = targets.sort((a, b) => {
        if (a.type !== b.type) {
            return a.type.localeCompare(b.type);
        }

        return a.name.localeCompare(b.name);
    });

    let targetPickerItems: TargetQuickPickItem[] = [];

    if (targets.length) {
        targetPickerItems.push({
            label: "Connected Devices",
            kind: vscode.QuickPickItemKind.Separator,
            getTarget: async () => { throw new Error(); }
        });
    }

    targets.forEach(target => {
        if (target.avdName) {
            let index = avdList.indexOf(target.avdName);
            avdList.splice(index, 1);
        }

        targetPickerItems.push({
            label: target.name,
            detail: target.type,
            getTarget: async () => target
        });
    });

    if (avdList.length) {
        targetPickerItems.push({
            label: "More Virtual Devices",
            kind: vscode.QuickPickItemKind.Separator,
            getTarget: async () => { throw new Error(); }
        });
    }

    targetPickerItems.push(
        ...
        await Promise.all(avdList.map(async (avdName): Promise<TargetQuickPickItem> => ({
            label: await android.getAvdDisplayName(avdName),
            detail: "Emulator",
            getTarget: async () => {
                return await android.launchAVD(avdName);
            }
        })))
    );

    return targetPickerItems;
}

export async function pickTarget()
{
    let quickPickOptions: vscode.QuickPickOptions = {
        title: "Select Android Target",
        matchOnDescription: true,
    };

    let target = await (await vscode.window.showQuickPick(getTargetPickerItems(), quickPickOptions))?.getTarget();

    logger.log("Picked target", target);

    if (target) { lastPickedTarget = target; }

    return target;
}

// Get the last picked target if still available or pick target.
export async function getLastOrPickTarget() {
    if (lastPickedTarget && await android.isDeviceConnected(lastPickedTarget.udid)) {
        return lastPickedTarget;
    }

    return await pickTarget();
}

export async function getTargetFromUDID(udid: string) {
    return await android.getDeviceFromUDID(udid);
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

export function setCurrentTarget(target: Device) {
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
