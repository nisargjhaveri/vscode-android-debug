import * as vscode from 'vscode';

import * as logger from './logger';

const LLDB_EXTENSION_ID = "vadimcn.vscode-lldb";
const JAVA_EXTENSION_ID = "redhat.java";
const JAVA_DEBUG_EXTENSION_ID = "vscjava.vscode-java-debug";

const extensionNames = {
    [LLDB_EXTENSION_ID]: "CodeLLDB",
    [JAVA_EXTENSION_ID]: "Language Support for Java",
    [JAVA_DEBUG_EXTENSION_ID]: "Debugger for Java",
};

type ExtensionId = keyof typeof extensionNames;

function getExtension(extensionId: string) {
    return vscode.extensions.getExtension(extensionId);
}

export function ensureExtensions(native: boolean, java: boolean) {
    let lldbExtension = getExtension(LLDB_EXTENSION_ID);
    let javaExtension = getExtension(JAVA_EXTENSION_ID);
    let javaDebugExtension = getExtension(JAVA_DEBUG_EXTENSION_ID);

    let missingExtensions: ExtensionId[] = [];

    if (native && !lldbExtension) { missingExtensions.push(LLDB_EXTENSION_ID); }
    if (java && !javaExtension) { missingExtensions.push(JAVA_EXTENSION_ID); }
    if (java && !javaDebugExtension) { missingExtensions.push(JAVA_DEBUG_EXTENSION_ID); }

    if (missingExtensions.length) {
        promptInstallExtensions(missingExtensions);

        let message = `Missing extensions: ${missingExtensions.map(id => `${extensionNames[id]} (${id})`).join(", ")}`;

        logger.log(message);
        throw new Error(message);
    }
}

async function promptInstallExtensions(extensionIds: ExtensionId[]) {
    const INSTALL = "Install";
    const choice = await vscode.window.showWarningMessage(getIntallationWarningMessage(extensionIds), INSTALL);

    if (choice === INSTALL) {
        await installExtensions(extensionIds);
    }
}

async function installExtensions(extensionIds: ExtensionId[]) {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (p) => {
        for (let extensionId of extensionIds) {
            logger.log(`Installing ${extensionNames[extensionId]} (${extensionId})`);
            p.report({message: `Installing ${extensionNames[extensionId]} (${extensionId}) ...`});
            await vscode.commands.executeCommand("workbench.extensions.installExtension", extensionId);
        }
    });

    const RELOAD = "Reload Window";
    const choice = await vscode.window.showInformationMessage("Please reload window to activate installed extensions.", RELOAD);
    if (choice === RELOAD) {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
}

function getIntallationWarningMessage(extensionIds: ExtensionId[]) {
    let extensions = extensionIds.map((id) => `[${extensionNames[id]}](https://marketplace.visualstudio.com/items?itemName=${id})`);

    if (extensions.length === 1) {
        return `Extension ${extensions[0]} is required. Please install and enable it.`;
    }
    else {
        return `Extensions ${extensions.slice(0, -1).join(", ")} and ${extensions[extensions.length - 1]} are required. Please install and enable them.`;
    }
}
