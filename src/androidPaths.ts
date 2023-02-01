import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

import { logger } from './logger';
import * as android from './android';

let sdkRoot: string|undefined;
let ndkRoot: string|undefined;

function getCommonSdkRoots(platform: NodeJS.Platform): string[] {
    if (platform === "win32") {
        return [
            path.resolve(process.env.LOCALAPPDATA ?? "", "Android", "sdk")
        ];
    }
    else if (platform === "darwin") {
        return [
            path.resolve(process.env.HOME ?? "/", "Library/Android/sdk")
        ];
    }
    else {
        return [
            path.resolve(process.env.HOME ?? "/", "Android/sdk")
        ];
    }
}

async function isValidSdkRoot(sdkRoot: string) {
    try {
        let stats = await fsPromises.stat(sdkRoot);
        if (!stats.isDirectory()) { return false; }

        await fsPromises.access(path.join(sdkRoot, "platform-tools", os.platform() === "win32" ? "adb.exe" : "adb"));

        return true;
    }
    catch {
        return false;
    }
}

async function getSdkRoot(customSdkRoot?: string): Promise<string> {
    if (customSdkRoot) {
        if (await isValidSdkRoot(customSdkRoot)) {
            return customSdkRoot;
        }

        logger.warn("Specified sdk root is not valid. Trying other options.");
    }

    let sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (sdkRoot && await isValidSdkRoot(sdkRoot)) {
        return sdkRoot;
    }

    for (let candidate of getCommonSdkRoots(os.platform())) {
        if (await isValidSdkRoot(candidate)) {
            return candidate;
        }
    }

    throw new Error("Cannot determine sdk root");
}

async function isValidNdkRoot(ndkRoot: string) {
    try {
        let stats = await fsPromises.stat(ndkRoot);
        if (!stats.isDirectory()) { return false; }

        await fsPromises.access(path.join(ndkRoot, "toolchains", "llvm"));

        return true;
    }
    catch {
        return false;
    }
}

async function getNdkRoot(sdkRoot: string, customNdkRoot?: string): Promise<string> {
    if (customNdkRoot) {
        if (await isValidNdkRoot(customNdkRoot)) {
            return customNdkRoot;
        }

        logger.warn("Specified ndk root is not valid. Trying other options.");
    }

    let ndkRoot = process.env.ANDROID_NDK_ROOT;
    if (ndkRoot && await isValidNdkRoot(ndkRoot)) {
        return ndkRoot;
    }

    let checkDirectoryAndContents = async (root: string) => {
        if (await isValidNdkRoot(root)) {
            return root;
        }

        try {
            let files = (await fsPromises.readdir(root)).map((f) => path.join(root, f));
            for (let file of files) {
                if (await isValidNdkRoot(file)) {
                    return file;
                }
            }
        }
        catch {
            return undefined;
        }
    };

    ndkRoot = await checkDirectoryAndContents(path.resolve(sdkRoot, "ndk")) || await checkDirectoryAndContents(path.resolve(sdkRoot, "ndk-bundle"));

    if (ndkRoot) {
        return ndkRoot;
    }

    throw new Error("Cannot determine ndk root");
}

async function updatePaths() {
    let config = vscode.workspace.getConfiguration("android-debug");

    try {
        sdkRoot = await getSdkRoot(config.get("sdkRoot"));
        logger.log(`Using sdkRoot: ${sdkRoot}`);

        ndkRoot = await getNdkRoot(sdkRoot, config.get("ndkRoot"));
        logger.log(`Using ndkRoot: ${ndkRoot}`);
    }
    catch (e: any) {
        logger.warn(`Error updating android paths: ${e.message}`);
        vscode.window.showErrorMessage(`Error updating android paths: ${e.message}`);
    }
}

export function requireSdkRoot() {
    if (sdkRoot) { return sdkRoot; }

    throw new Error("Cannot determine sdk root");
}

export function requireNdkRoot() {
    if (ndkRoot) { return ndkRoot; }

    throw new Error("Cannot determine ndk root");
}

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration("android-debug")) {
            await updatePaths();
            await android.handlePathsUpdated();
        }
    }));

    await updatePaths();
}
