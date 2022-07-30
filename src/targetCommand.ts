import * as vscode from 'vscode';
import * as logger from './logger';
import * as android from './android';
import { Device } from './commonTypes';
import { getOrPickTarget } from './targetPicker';

let context: vscode.ExtensionContext;
let lldbProcessKillers: {[socket: string]: () => void} = {};

let currentDebugConfiguration: vscode.DebugConfiguration|undefined;

async function resolveArgs(args: any)
{
    if (!args.device)
    {
        args.device = await getOrPickTarget();
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

export async function lldbServer(args: {device: Device, packageName: string, appAbiList?: string[]})
{
    let {device, packageName, appAbiList} = args;

    return vscode.window.withProgress({
        "location": vscode.ProgressLocation.Notification,
        "title": "Starting LLDB server",
        "cancellable": true
    }, (progress, token) => {
        let cancellationToken = {cancel: () => {}};

        token.onCancellationRequested((e) => cancellationToken.cancel());

        return Promise.resolve()
            .then(() => android.startLldbServer(device, packageName, appAbiList))
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

export async function getBestAbi(args: {device: Device}) {
    let {device} = await resolveArgs(args);

    let appAbiList = currentDebugConfiguration && currentDebugConfiguration.androidAppSupportedAbis ? currentDebugConfiguration.androidAppSupportedAbis : undefined;

    return await android.getBestAbi(device, appAbiList);
}

export function setCurrentDebugConfiguration(dbgConfig: vscode.DebugConfiguration) {
    currentDebugConfiguration = dbgConfig;
}

export function resetCurrentDebugConfiguration() {
    currentDebugConfiguration = undefined;
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