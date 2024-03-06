import * as vscode from 'vscode';
import * as debugadapter from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

import * as extensionDependencies from './extensionDependencies';
import * as android from './android';
import { Device } from './commonTypes';
import { showLogcat, clearLogcat } from './extension';
import Logcat from 'appium-adb/lib/logcat';
import { config } from 'process';

export class DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  private context: vscode.ExtensionContext;
  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    return new vscode.DebugAdapterInlineImplementation(new DebugAdapter(this.context, session));
  }
}

class DebugAdapter extends debugadapter.LoggingDebugSession {
  private session: vscode.DebugSession;
  private childSessions: { [key: string]: vscode.DebugSession } = {};
  private jdwpCleanup: (() => Promise<void>) | undefined;
  private logCat: Logcat | null = null;

  constructor(context: vscode.ExtensionContext, session: vscode.DebugSession) {
    super();

    this.session = session;
    context.subscriptions.push(vscode.debug.onDidStartDebugSession(this.onDidStartDebugSession));
    context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(this.onDidTerminateDebugSession));
  }

  private onDidStartDebugSession = (debugSession: vscode.DebugSession) => {
    if (debugSession.parentSession?.id === this.session.id) {
      this.childSessions[debugSession.id] = debugSession;
    }
  };

  private onDidTerminateDebugSession = (debugSession: vscode.DebugSession) => {
    if (debugSession.id in this.childSessions) {
      delete this.childSessions[debugSession.id];
    }

    // Terminate debug session if no child sessions are active
    if (!Object.keys(this.childSessions).length) {
      this.sendEvent(new debugadapter.TerminatedEvent());
    }
  };

  private consoleLog(message: string) {
    this.sendEvent(new debugadapter.OutputEvent(`${message}\n`, "console"));
  }

  private prepareNativeDebugConfiguration(config: vscode.DebugConfiguration, pid: string) {
    let lldbConfig: vscode.DebugConfiguration = {
      "type": "lldb",
      "name": "Native",
      "request": "attach",
      "pid": pid,
      "androidTarget": config.target.udid,
      "androidAbi": config.native.abi,
      "androidPackageName": config.packageName,
    };

    let excludeProperties = ["abi", "abiSupported", "abiMap"];

    if (config.native) {
      for (let key in config.native) {
        if (!excludeProperties.includes(key)) {
          lldbConfig[key] = config.native[key];
        }
      }
    }

    return lldbConfig;
  }

  private prepareJavaDebugConfiguration(config: vscode.DebugConfiguration, pid: string) {
    let javaConfig: vscode.DebugConfiguration = {
      "type": "java",
      "name": "Java",
      "request": "attach",
      "processId": pid,
      "androidTarget": config.target.udid,
    };

    let excludeProperties: string[] = [];

    if (config.java) {
      for (let key in config.java) {
        if (!excludeProperties.includes(key)) {
          javaConfig[key] = config.java[key];
        }
      }
    }

    return javaConfig;
  }

  private async attachToProcess(pid: string, response: DebugProtocol.Response) {
    let config = this.session.configuration;

    // Start capture of logcat, if enabled
    if (config.captureLogcat) {
      if (config.clearLogcat) {
        clearLogcat();
      }

      this.consoleLog("Starting logcat capture");
      this.logCat = await android.captureLogCat(config.target, pid);
    }

    let lldbEnabled = config.mode === "dual" || config.mode === "native";
    let javaEnabled = config.mode === "dual" || config.mode === "java";

    extensionDependencies.ensureExtensions(lldbEnabled, javaEnabled);

    let lldbSuccess = !lldbEnabled;
    if (lldbEnabled) {
      this.consoleLog("Starting Native debugger");
      let lldbConfig = this.prepareNativeDebugConfiguration(config, pid);

      lldbSuccess = await vscode.debug.startDebugging(this.session.workspaceFolder, lldbConfig, {
        parentSession: this.session
      });
    }

    let javaSuccess = !javaEnabled;
    if (javaEnabled && lldbSuccess) {
      this.consoleLog("Starting Java debugger");
      let javaConfig = this.prepareJavaDebugConfiguration(config, pid);

      javaSuccess = await vscode.debug.startDebugging(this.session.workspaceFolder, javaConfig, {
        parentSession: this.session
      });
    }

    response.success = lldbSuccess && javaSuccess;

    if (!response.success) {
      response.message = !lldbSuccess ? "Could not start native debugger" : !javaSuccess ? "Could not start java debugger" : "Could not start android debugger";
    }

    if (response.success) {
      this.consoleLog(`Attached to process ${pid}`);
    }
    else {
      this.consoleLog(`Error: ${response.message}`);
    }

    // Bring the logcat window to front
    if (config.captureLogcat) {
      showLogcat();
    }
  }

  private async resumeProcess(pid: string) {
    let config = this.session.configuration;

    if (config.resumeProcess) {
      try {
        this.consoleLog(`Resuming process by attaching Java debugger`);
        this.jdwpCleanup = await android.resumeJavaDebugger(config.target, pid);
      }
      catch (e: any) {
        this.consoleLog(`Error resuming process: ${e.message}`);
      }
    }
  }

  protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
    let pid = this.session.configuration.pid;

    // Attach to process
    await this.attachToProcess(pid, response);

    // Resume process if applicable
    await this.resumeProcess(pid);

    this.sendResponse(response);
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: DebugProtocol.LaunchRequestArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
    let config = this.session.configuration;
    let target: Device = config.target;

    try {
      // Install the app if required
      if (config.apkPath) {
        this.consoleLog(`Installing ${config.apkPath}`);
        await android.installApp(target, config.apkPath);
      }

      // Try launching the app
      if (!config.packageName) {
        throw new Error("A valid package name is required.");
      }

      this.consoleLog(`Launching the app activity ${config.packageName}/${config.launchActivity}`);

      let extra = {};
      if ("extra" in config) {
        extra = config.extra;
      }

      if ("sync" in config) {
        for(var i = 0; i < config.sync.length; ++i) {
          let values = config.sync[i].split(':');

          if (values.length < 2) {
            throw new Error(`Invalid syntax in sync directory ${config.sync[i]}. (Expected <local>:<remote>)`);
          }

          let remote = values.pop();
          let local = values.join(':');

          this.consoleLog(`Syncing directory '${local}' to '${remote}'`);
          await android.syncDirectory(target, local, remote);
        }
      }

      await android.launchApp(target, config.packageName, config.launchActivity, extra);

      this.consoleLog(`Getting pid for the launched app`);

      // Wait for some time before trying to get pid
      await new Promise((resolve, reject) => setTimeout(resolve, 1000));

      // Get last pid from jdwp
      let processList = await android.getProcessList(target, false);
      let process = processList.length ? processList[processList.length - 1] : undefined;

      if (!process?.pid) {
        throw new Error("Could not get pid for the app. Please ensure that the app is launched correctly.");
      }
      else {
        this.consoleLog(`Attaching to process ${process.pid} (${process.name})`);
      }

      // Attach to the process
      await this.attachToProcess(process.pid, response);

      // Resume process if applicable
      await this.resumeProcess(process.pid);
    }
    catch (e: any) {
      response.success = false;
      response.message = `Error launching: ${e.message}`;
    }

    this.sendResponse(response);
  }

  protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
    let config = this.session.configuration;

    await Promise.all(Object.values(this.childSessions).map(async (s) => await vscode.debug.stopDebugging(s)));

    if (this.jdwpCleanup) {
      await this.jdwpCleanup();
      this.jdwpCleanup = undefined;
    }

    if (this.logCat !== null) {
      this.consoleLog(`Stopping logcat capture`);
      this.logCat.stopCapture();
      this.logCat = null;
    }

    this.consoleLog(`Killing app ${config.packageName}`);
    await android.killApp(config.target, config.packageName);

    this.consoleLog("Debugger detached");
    this.sendResponse(response);
  }
}
