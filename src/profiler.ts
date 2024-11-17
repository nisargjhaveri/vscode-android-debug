import * as vscode from 'vscode';
import { logger } from './logger';
import * as debugadapter from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

import { ADB, Device,  } from 'appium-adb';
import * as teen_process from 'teen_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

import * as android from './android';
import * as utils from './utils';
import { SimpleperfReportCustomEditor } from './profile-viewer/profileCustomEditor';

export class ProfilerDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory  {
    private context: vscode.ExtensionContext;
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return new vscode.DebugAdapterInlineImplementation(new ProfilerDebugAdapter(this.context, session));
    }
}

class ProfilerDebugAdapter extends debugadapter.LoggingDebugSession {
    private session: vscode.DebugSession;
    private simpleperfOutputFileBaseName: string;
    private simpleperfOutputDevicePath: string;

    private simpleperfProcess: teen_process.SubProcess | undefined;
    private simpleperfPid: number | undefined;

    constructor(context: vscode.ExtensionContext, session: vscode.DebugSession) {
        super();

        this.session = session;

        this.simpleperfOutputFileBaseName = `simpleperf-${utils.randomString(8)}`;
        this.simpleperfOutputDevicePath = `/data/local/tmp/${this.simpleperfOutputFileBaseName}.data`;
    }

    private consoleLog(message: string, category: "console" | "stdout" | "stderr" = "console", logPrefix: string = "") {
        this.sendEvent(new debugadapter.OutputEvent(`${message}\n`, category));

        if (logPrefix) {
            logger.log(logPrefix, message);
        }
        else {
            logger.log(message);
        }
    }

    private async getSimpleperfCommand(deviceAdb: ADB, simpleperfDevicePath: string): Promise<string> {
        const supportedFeatures = await deviceAdb.shell(`${simpleperfDevicePath} list --show-features`);

        const config = this.session.configuration;
        const frequency = config.frequency ?? 4000;
        const event = config.event ?? "cpu-clock";

        const command = [simpleperfDevicePath, "record", "-o", this.simpleperfOutputDevicePath, "-f", frequency.toString(), "-e", event];

        command.push("--call-graph");
        if (supportedFeatures.indexOf("dwarf") >= 0) {
            command.push("dwarf");
        } else {
            command.push("fp");
        }

        if (supportedFeatures.indexOf("trace-offcpu") >= 0) {
            command.push("--trace-offcpu");
        }

        if (config.packageName) {
            command.push("--app", config.packageName);
        }

        if (config.pid) {
            command.push("-p", config.pid);
        }

        return command.join(" ");
    }

    private async processSimpleperfOutput(progress: vscode.Progress<{message: string|undefined}> , deviceAdb: ADB): Promise<void> {
        try {
            progress.report({message: "Copy simpleperf output from device"});

            const localOutputPath = path.join(os.tmpdir(), `${this.simpleperfOutputFileBaseName}.data`);
            await deviceAdb.pull(this.simpleperfOutputDevicePath, localOutputPath);
            logger.log(`Pulled simpleperf output to ${localOutputPath}`);

            progress.report({message: "Processing simpleperf output"});
            const localTracePath = path.join(os.tmpdir(), `${this.simpleperfOutputFileBaseName}.trace`);
            logger.log(`Converting simpleperf output to ${localTracePath}`);

            const simpleperfHostPath = await android.getHostSimpleperf();

            const simpleperfArgs = ["report-sample", "--protobuf", "--show-callchain", "-i", localOutputPath, "-o", localTracePath];

            const config = this.session.configuration;
            const symbolSearchPaths: string[] = config?.native?.symbolSearchPaths ?? [];
            for (const symbolSearchPath of symbolSearchPaths) {
                const normalizedPath = path.normalize(symbolSearchPath);
                try {
                    await fsPromises.access(normalizedPath, fs.constants.R_OK);

                    simpleperfArgs.push("--symdir", symbolSearchPath);
                } catch (e) {
                    logger.warn(`Ignoring symbol search path "${normalizedPath}": ${e}`);
                }
            }

            logger.log(`Running simpleperf: ${simpleperfHostPath} ${simpleperfArgs.join(" ")}`);

            const { code } = await teen_process.exec(
                simpleperfHostPath,
                simpleperfArgs,
                {
                    logger: {
                        debug(...args) {
                            logger.log("simpleperf:", ...args);
                        },
                    }
                }
            );

            logger.log(`simpleperf report-sample exited with code ${code}`);

            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(localTracePath).with({scheme: 'untitled'}), SimpleperfReportCustomEditor.viewType);
        } catch (e) {
            logger.error(`Error processing simpleperf output: ${e}`);
            vscode.window.showErrorMessage(`Error processing simpleperf output: ${e}`);
        }
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
        let config = this.session.configuration;

        let target: Device = config.target;

        try {
            this.consoleLog("Setup simpleperf on device");
            const deviceAdb = await android.getDeviceAdb(target);
            const simpleperfDevicePath = await android.pushSimpleperf(deviceAdb);

            const simpleperfCommand = await this.getSimpleperfCommand(deviceAdb, simpleperfDevicePath);

            this.consoleLog(`Start simpleperf: ${simpleperfCommand}`);
            this.simpleperfProcess = deviceAdb.createSubProcess(['shell', `echo PID:$$; exec ${simpleperfCommand}`]);

            this.simpleperfProcess.on('lines-stdout', (lines: string[]) => {
                lines.forEach((line) => {
                    if (!this.simpleperfPid && line.startsWith("PID:")) {
                        const matches = line.match(/^PID:(\d+)$/);

                        if (matches && matches.length > 1) {
                            this.simpleperfPid = parseInt(matches[1]);
                            this.consoleLog(`Simpleperf started with PID: ${this.simpleperfPid}`);
                            return;
                        }
                    }

                    this.consoleLog(line, "stdout", "simpleperf stdout:");
                });
            });

            this.simpleperfProcess.on('lines-stderr', (lines: string[]) => {
                lines.forEach((line) => {
                    this.consoleLog(line, "stderr", "simpleperf stderr:");
                });
            });

            this.simpleperfProcess.on('exit', (code) => {
                this.consoleLog(`simpleperf exited with code ${code}`);
                this.simpleperfPid = undefined;
                this.simpleperfProcess = undefined;
                this.sendEvent(new debugadapter.TerminatedEvent());
            });

            this.simpleperfProcess.start();
        }
        catch (e: any) {
            response.success = false;
            response.message = `Error starting profiler: ${e.message}`;
            logger.error(`Error starting profiler: ${e.message}`);
        }

        this.sendResponse(response);
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
        this.consoleLog(`Stopping profiler (pid: ${this.simpleperfPid})`);

        try {
            if (this.simpleperfPid) {
                const config = this.session.configuration;

                const deviceAdb = await android.getDeviceAdb(config.target);
                deviceAdb.shell(['kill', this.simpleperfPid.toString()]);

                await vscode.window.withProgress({location: vscode.ProgressLocation.Notification, title: "Android Profiler"}, async (progress, token) => {
                    progress.report({message: "Waiting for simpleperf to exit"});
                    await this.simpleperfProcess?.join();

                    await this.processSimpleperfOutput(progress, deviceAdb);
                });
            }
        } catch (e) {
            logger.error(`Error stopping profiler: ${e}`);
            vscode.window.showErrorMessage(`Error stopping profiler: ${e}`);
        }

        this.sendResponse(response);
    }
}
