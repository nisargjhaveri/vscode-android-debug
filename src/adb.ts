import ADB, { Device } from 'appium-adb';

let sdkRoot: string;
let lldbServerRoot: string;

let adb: ADB;

export async function getAdb() {
    if (!adb) {
        adb = await ADB.createADB({sdkRoot});
    }

    return adb;
}

export async function getDeviceAdb(device: Device) {
    let deviceAdb = (await getAdb()).clone();
    deviceAdb.setDevice(device);

    return deviceAdb;
}

export async function getLldbServerRoot() {
    return lldbServerRoot;
}

export function activate(_sdkRoot?: string, _lldbServerRoot?: string) {
    sdkRoot = _sdkRoot ?? "";
    lldbServerRoot = _lldbServerRoot ?? "";
}
