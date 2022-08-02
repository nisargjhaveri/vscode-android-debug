import * as vscode from 'vscode';
import * as logger from './logger';
import * as android from './android';
import { Device } from './commonTypes';
import { getCurrentOrPickTarget } from './targetPicker';

let context: vscode.ExtensionContext;
let lldbProcessKillers: {[socket: string]: () => void} = {};

let currentDebugConfiguration: vscode.DebugConfiguration|undefined;

let lastPickedAbi: string|undefined;
let currentBestAbi: string|undefined;
let didResolveCurrentBestAbi = false;

const allSupportedAbis = ["armeabi", "armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

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

async function pickAppAbi(appSupportedAbiList?: string[]) {
    appSupportedAbiList = appSupportedAbiList ?? allSupportedAbis;

    let abiOptions = appSupportedAbiList.sort((a, b) => {
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

async function getBestAbiInternal(device: Device) {
    let appSupportedAbiList: string[]|undefined = currentDebugConfiguration?.androidAppSupportedAbis ?? undefined;
    let appAbi: string = currentDebugConfiguration?.androidAppAbi ?? undefined;

    if (appAbi && appAbi === "select") {
        return await pickAppAbi(appSupportedAbiList);
    }
    else if (appAbi) {
        return appAbi;
    }
    else {
        return await android.getBestAbi(device, appSupportedAbiList);
    }
}

export async function getBestAbi(args: {device: Device}) {
    let {device} = await resolveArgs(args);

    if (!currentDebugConfiguration) {
        return await getBestAbiInternal(device);
    }

    if (!didResolveCurrentBestAbi) {
        currentBestAbi = await getBestAbiInternal(device);
    }

    didResolveCurrentBestAbi = true;

    return currentBestAbi;
}

function getMappedAbi(abi?: string): string|undefined {
    let abiMap = currentDebugConfiguration?.androidAbiMap ?? {};

    if (abi && (abi in abiMap)) {
        return abiMap[abi];
    }

    return undefined;
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

export function setCurrentDebugConfiguration(dbgConfig: vscode.DebugConfiguration) {
    currentDebugConfiguration = dbgConfig;
    currentBestAbi = undefined;
    didResolveCurrentBestAbi = false;
}

export function resetCurrentDebugConfiguration() {
    currentDebugConfiguration = undefined;
    currentBestAbi = undefined;
    didResolveCurrentBestAbi = false;
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