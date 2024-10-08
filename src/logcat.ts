import * as vscode from 'vscode';
import { logger } from './logger';
import * as android from './android';
import { getCurrentOrPickTarget } from './targetPicker';
import { Device, ADB } from 'appium-adb';
import { SubProcess } from 'teen_process';


let context: vscode.ExtensionContext;

const logcatInstances: Map<string, Logcat> = new Map();
const logcatOutputChannels: Map<string, vscode.OutputChannel> = new Map();

class Logcat {
    readonly name: string;

    private adb: ADB;
    private proc: SubProcess|undefined;

    constructor(name: string, adb: ADB) {
        this.name = name;
        this.adb = adb;
    }

    async startCapture(format: string, outputCallback: (line: string) => void, exitCallback: () => void) {
        return new Promise<void>(async (_resolve, _reject) => {
            let resolved = false;
            const resolve = () => {
                if (!resolved) {
                    resolved = true;
                    _resolve();
                }
            };
            const reject = (reason?: any) => {
                if (!resolved) {
                    resolved = true;
                    _reject(reason);
                }
            };

            this.proc = new SubProcess(
                this.adb.executable.path,
                [
                    ...this.adb.executable.defaultArgs,
                    "logcat",
                    "-v",
                    format
                ]);
            
            this.proc.on("exit", (code, signal) => {
                this.proc = undefined;

                logger.log(`Logcat terminated with code ${code}, signal ${signal}`);

                if (resolved) {
                    outputCallback(`--- End logcat ---`);
                } else {
                    reject(new Error("Failed to start logcat"));
                }

                exitCallback();
            });

            this.proc.on("lines-stderr", (lines: string[]) => {
                for (const line of lines) {
                    logger.log(`Logcat stderr: ${line}`);
                }
            });

            this.proc.on("lines-stdout", (lines: string[]) => {
                resolve();

                for (const line of lines) {
                    outputCallback(line);
                }
            });

            await this.proc.start();

            // Resolve anyway after some time even if no output
            setTimeout(resolve, 10_000);
        });
    }

    async stopCapture() {
        if (this.proc) {
            await this.proc.stop();
            this.proc = undefined;
        }
    }
}

export async function startLogcat(args: {device: Device}) {
    const device = args?.device ?? await getCurrentOrPickTarget();

    if (!device) {
        return;
    }

    const deviceAdb = await android.getDeviceAdb(device);

    const uniqueName = device.udid;

    const outputChannel = logcatOutputChannels.get(uniqueName) ?? vscode.window.createOutputChannel(`Logcat - ${uniqueName}`);
    logcatOutputChannels.set(uniqueName, outputChannel);

    if (logcatInstances.has(uniqueName)) {
        outputChannel.show();
        return;
    }

    const logcat = new Logcat(uniqueName, deviceAdb);
    logcatInstances.set(uniqueName, logcat);

    try {
        await logcat.startCapture(
            "threadtime,year",
            outputChannel.appendLine,
            () => {
                logcatInstances.delete(uniqueName);
            }
        );

        logger.log(`Logcat started for ${device.udid}`);

        outputChannel.show();
    }
    catch (e: any) {
        logcatInstances.delete(uniqueName);

        logger.error(`Error starting logcat: ${e.message}`);
        vscode.window.showErrorMessage(`Error starting logcat: ${e.message}`);
    }
}

export async function stopLogcat() {
    const activeLogcatNames = Array.from(logcatInstances.keys());

    if (activeLogcatNames.length === 0) {
        // Nothing to do
        return;
    }

    const stopCapture = async (name?: string) => {
        if (name) {
            await logcatInstances.get(name)?.stopCapture();
        }
    };
    
    if (activeLogcatNames.length === 1) {
        await stopCapture(activeLogcatNames[0]);
    } else {
        vscode.window.showQuickPick(activeLogcatNames, {
            title: "Select logcat instance to stop",
        }).then(stopCapture);
    }
}

export function activate(c: vscode.ExtensionContext) {
    context = c;

    // Clean all open lldb-server processes
    context.subscriptions.push({
        async dispose() {
            logcatInstances.forEach((logcat) => {
                logcat.stopCapture();
            });
        }
    });
}
