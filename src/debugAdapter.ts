import * as vscode from 'vscode';
import * as debugadapter from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';

export class DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory  {
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
    private childSessions: vscode.DebugSession[] = [];

    constructor(context: vscode.ExtensionContext, session: vscode.DebugSession) {
        super();

        this.session = session;
        context.subscriptions.push(vscode.debug.onDidStartDebugSession(this.onDidStartDebugSession));
    }

    private onDidStartDebugSession = (debugSession: vscode.DebugSession) => {
        if (debugSession.parentSession?.id === this.session.id) {
            this.childSessions.push(debugSession);
        }
    };

    private prepareNativeDebugConfiguration(config: vscode.DebugConfiguration) {
        let lldbConfig: vscode.DebugConfiguration = {
            "type": "lldb",
            "name": "Native",
            "request": "attach",
            "pid": config.pid,
            "androidTarget": config.target.udid,
            "androidAbi": config.native.abi,
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

    private prepareJavaDebugConfiguration(config: vscode.DebugConfiguration) {
        let javaConfig: vscode.DebugConfiguration = {
            "type": "java",
            "name": "Java",
            "request": "attach",
            "processId": config.pid,
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

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
        let config = this.session.configuration;

        config.mode = (config.mode === "auto" ? "dual" : config.mode);

        let lldbEnabled = config.mode === "dual" || config.mode === "native";
        let javaEnabled = config.mode === "dual" || config.mode === "java";

        let lldbSuccess = !lldbEnabled;
        if (lldbEnabled) {
            let lldbConfig = this.prepareNativeDebugConfiguration(config);

            lldbSuccess = await vscode.debug.startDebugging(this.session.workspaceFolder, lldbConfig, {
                lifecycleManagedByParent: false,
                parentSession: this.session
            });
        }

        let javaSuccess = !javaEnabled;
        if (javaEnabled && lldbSuccess) {
            let javaConfig = this.prepareJavaDebugConfiguration(config);

            javaSuccess = await vscode.debug.startDebugging(this.session.workspaceFolder, javaConfig, {
                parentSession: this.session
            });
        }

        response.success = lldbSuccess && javaSuccess;
        
        if (!response.success) {
            response.message = !lldbSuccess ? "Could not start native debugger" : !javaSuccess ? "Could not start java debugger" : "Could not start android debugger";
        }

        this.sendResponse(response);
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request | undefined): Promise<void> {
        await Promise.all(this.childSessions.map(async (s) => await vscode.debug.stopDebugging(s)));

        this.sendResponse(response);
    }
}
