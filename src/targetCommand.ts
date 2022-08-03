import * as vscode from 'vscode';
import * as logger from './logger';
import * as android from './android';
import { Device } from './commonTypes';
import { getCurrentOrPickTarget } from './targetPicker';

let context: vscode.ExtensionContext;
let lldbProcessKillers: {[socket: string]: () => void} = {};

let currentDebugConfiguration: vscode.DebugConfiguration|undefined;

let lastPickedAbi: string|undefined;

let currentAbiSupportedList: string[]|undefined;
let currentAbiMap: {[abi: string]: string}|undefined;
let currentAbi: string|undefined;

const defaultAbiSupportedList = ["armeabi", "armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

async function resolveArgs<T extends {device?: Device}>(args: T): Promise<T>
{
    if (!args.device)
    {
        args.device = await getCurrentOrPickTarget();
    }

    return args;
}

export async function pickAndroidProcess(args: {device: Device}) {
    let {device} = await resolveArgs(args);

    let processList = android.getProcessList(device);

    let quickPickProcesses = processList.then((processList): (vscode.QuickPickItem & {pid:string})[] => {
        return processList.map(p => ({
            label: p.name,
            description: p.pid,
            pid: p.pid
        }));
    });

    return (await vscode.window.showQuickPick(quickPickProcesses, {title: "Pick Android Process", matchOnDescription: true}))?.pid;
}

async function pickAppAbi(abiSupportedList: string[]) {
    let abiOptions = abiSupportedList.sort((a, b) => {
        if (a === lastPickedAbi) { return -1; }
        if (b === lastPickedAbi) { return 1; }
        return a.localeCompare(b);
    }).map((abi): vscode.QuickPickItem => ({
        label: abi,
        detail: getMappedAbi(abi)
    }));

    let abi = (await vscode.window.showQuickPick(abiOptions, {title: "Pick Android ABI", matchOnDescription: true}))?.label;

    if (abi) { lastPickedAbi = abi; }

    return abi;
}

export async function lldbServer(args: {device: Device, packageName: string, abi: string})
{
    let {device, packageName, abi} = args;

    return vscode.window.withProgress({
        "location": vscode.ProgressLocation.Notification,
        "title": "Starting LLDB server",
        "cancellable": true
    }, (progress, token) => {
        let cancellationToken = {cancel: () => {}};

        token.onCancellationRequested((e) => cancellationToken.cancel());

        return Promise.resolve()
            .then(() => android.startLldbServer(device, packageName, abi))
            .then(({socket, stop}) => {

                lldbProcessKillers[socket] = stop;

                return socket;
            })
            .catch((e) => {
                vscode.window.showErrorMessage("Failed to start lldb server");
            });
    });
}

export function lldbServerCleanup(socket: string) {
    logger.log(`Cleaning up lldb server at socket ${socket}`);

    if (!(socket in lldbProcessKillers)) {
        return;
    }

    lldbProcessKillers[socket]();

    delete lldbProcessKillers[socket];
}

export function setAbiResolutionInfo(abi: string, abiSupportedList: string[], abiMap: {[abi: string]: string}) {
    currentAbi = abi;
    currentAbiSupportedList = abiSupportedList;
    currentAbiMap = abiMap;
}

export function resetAbiResolutionInfo() {
    currentAbi = undefined;
    currentAbiSupportedList = undefined;
    currentAbiMap = undefined;
}

function getMappedAbi(abi?: string): string|undefined {
    let abiMap = currentAbiMap ?? {};

    if (abi && (abi in abiMap)) {
        return abiMap[abi];
    }

    return undefined;
}

export async function getBestAbi(args: {device: Device}) {
    let {device} = await resolveArgs(args);

    let abiSupportedList = currentAbiSupportedList ?? defaultAbiSupportedList;

    if (currentAbi) {
        if (currentAbi === "select") {
            let pickedAbi = await pickAppAbi(abiSupportedList);

            if (pickedAbi) {
                currentAbi = pickedAbi;
            }
            else {
                return undefined;
            }
        }

        return currentAbi;
    }
    else {
        return await android.getBestAbi(device, abiSupportedList);
    }
}

export async function getBestMappedAbi(args: {device: Device}) {
    let {device} = await resolveArgs(args);

    let abi = await getBestAbi({device});

    return getMappedAbi(abi) ?? abi;
}

export async function forwardJdwpPort(args: {device: Device, pid: string}) {
    let {device, pid} = await resolveArgs(args);

    return await android.forwardJdwpPort(device, pid);
}

export async function removeTcpForward(device: Device, port: string) {
    return await android.removeTcpForward(device, port);
}

export function activate(c: vscode.ExtensionContext) {
    context = c;

    // Clean all open lldb-server processes
    context.subscriptions.push({
        dispose() {
            for(const socket in lldbProcessKillers) {
                lldbProcessKillers[socket]();
            }
        }
    });
}