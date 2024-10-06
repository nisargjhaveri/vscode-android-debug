import * as vscode from 'vscode';
import { logger } from './logger';
import * as android from './android';
import { Device } from './commonTypes';
import { getCurrentOrPickTarget } from './targetPicker';

let context: vscode.ExtensionContext;
let lldbProcessKillers: {[socket: string]: () => void} = {};

let lastPickedAbi: string|undefined;

let currentAbiSupportedList: string[]|undefined;
let currentAbiMap: {[abi: string]: string}|undefined;
let currentAbi: string|undefined;

let currentPackageName: string|undefined;

const defaultAbiSupportedList = ["armeabi", "armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

async function resolveArgs<T extends {device?: Device}>(args: T = {} as T): Promise<T>
{
    if (!args.device)
    {
        args.device = await getCurrentOrPickTarget();
    }

    return args;
}

export function setProcessPickerInfo(packageName: string) {
    currentPackageName = packageName;
}

export function resetProcessPickerInfo() {
    currentPackageName = undefined;
}

export async function pickAndroidProcess(args: {device: Device}) {
    let {device} = await resolveArgs(args);

    let quickPickProcesses: Promise<(vscode.QuickPickItem & {pid:string})[]> = new Promise(async (resolve, reject) => {
        let processList = await android.getProcessList(device, Boolean(currentPackageName));

        let quickPickItems = processList
            .sort((a, b) => {
                if (currentPackageName) {
                    let result = Number(b.packages.includes(currentPackageName)) - Number(a.packages.includes(currentPackageName));
                    if (result !== 0) { return result; }
                }
                return a.name.localeCompare(b.name);
            })
            .map(p => ({
                label: p.name,
                description: p.pid,
                pid: p.pid
            }));

        resolve(quickPickItems);
    });

    return (await vscode.window.showQuickPick(quickPickProcesses, {title: "Pick Android Process", matchOnDescription: true}))?.pid;
}

export async function getPackageNameForPid(args: {device: Device, pid: string}) {
    let {device, pid} = await resolveArgs(args);

    let processInfo = await android.getProcessInfo(device, pid, true);

    if (processInfo.packages?.length) {
        return processInfo.packages[0];
    }

    return undefined;
}

export async function getPackageNameFromApk(apkPath: string) {
    return await android.getPackageNameFromApk(apkPath);
}

async function pickAppAbi(abiSupportedList: string[], deviceAbiList: string[]) {
    let abiOptions = abiSupportedList.sort((a, b) => {
        // Sort by last picked
        if (a === lastPickedAbi) { return -1; }
        if (b === lastPickedAbi) { return 1; }

        // Sort by device ABIs
        let indexA = deviceAbiList.indexOf(a);
        if (indexA < 0) { indexA = Number.MAX_SAFE_INTEGER; }

        let indexB = deviceAbiList.indexOf(b);
        if (indexB < 0) { indexB = Number.MAX_SAFE_INTEGER; }

        let result = indexA - indexB;

        if (result !== 0) { return result; }

        // Sort alphabatically
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
                vscode.window.showErrorMessage(`Failed to start lldb server: ${e.message}`);
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
            let deviceAbiList = await android.getDeviceAbiList(device);
            let pickedAbi = await pickAppAbi(abiSupportedList, deviceAbiList);

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

export async function resumeWaitingProcess(args: {device: Device, pid?: string}) {
    let {device, pid} = await resolveArgs(args);

    if (device && !pid) {
        pid = await pickAndroidProcess({device});
    }

    if (!pid) {
        return;
    }

    logger.log(`Resuming process ${pid}`);

    const jdwpCleanup = await android.resumeJavaDebugger(device, pid);

    setTimeout(async () => await jdwpCleanup(), 500);
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