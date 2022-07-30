import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

import * as logger from './logger';
import * as utils from './utils';
import { ADB, Device } from './commonTypes';

let sdkRoot: string;
let ndkRoot: string;

let adb: ADB;

const defaultAppAbis = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

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

async function getLldbServer(abi: string): Promise<string> {
    try {
        let platform = os.platform();

        let llvmHostName = (platform === "win32") ? "windows-x86_64" : (platform === "darwin") ? "darwin-x86_64" : "linux-x86_64";
        let llvmArch = abi.startsWith("armeabi") ? "arm" : (abi === "arm64-v8a") ? "aarch64": (abi === "x86") ? "i386" : "x86_64";

        let llvmToolchainDir = path.normalize(`${ndkRoot}/toolchains/llvm/prebuilt/${llvmHostName}`);

        let lldvPackageVersion = (await fsPromises.readFile(path.join(llvmToolchainDir, "AndroidVersion.txt"), "utf8")).split("\n")[0];

        let lldbServerPath = path.normalize(`${llvmToolchainDir}/lib64/clang/${lldvPackageVersion}/lib/linux/${llvmArch}/lldb-server`);

        await fsPromises.access(lldbServerPath, fs.constants.R_OK);

        return lldbServerPath;
    }
    catch {
        throw new Error("Could not locate lldb-server for the device");
    }
}

async function getDeviceAbiList(deviceAdb: ADB) {
    let abilist = [];

    abilist.push(...(await deviceAdb.getDeviceProperty("ro.product.cpu.abilist")).split(","));

    if (!abilist.length) {
        abilist.push(...[
            await deviceAdb.getDeviceProperty("ro.product.cpu.abi"),
            await deviceAdb.getDeviceProperty("ro.product.cpu.abi2")
        ]);
    }

    abilist.filter((item, pos, self) => {
        return item && item.length;
    });

    return abilist;
}

export async function getBestAbi(device: Device, appAbiList?: string[]) {
    return await getBestAbiInternal(await getDeviceAdb(device), appAbiList);
}

async function getBestAbiInternal(deviceAdb:ADB, appAbiList?: string[]) {
    let deviceAbiList = await getDeviceAbiList(deviceAdb);

    appAbiList = appAbiList ?? defaultAppAbis;

    for (let abi of deviceAbiList) {
        if (appAbiList.indexOf(abi) >= 0) {
            return abi;
        }
    }

    throw new Error("Cannot find appropriate ABI to use");
}

async function getLLdbServerForDevice(deviceAdb: ADB, appAbiList?: string[]) {
    let abi = await getBestAbiInternal(deviceAdb, appAbiList);
    let lldbServerPath = await getLldbServer(abi);

    return lldbServerPath;
}

export async function startLldbServer(device: Device, packageName: string, appAbiList?: string[]) {
    let deviceAdb = await getDeviceAdb(device);
    let lldbServerPath = await getLLdbServerForDevice(deviceAdb, appAbiList);

    logger.log(`Using lldb-server at ${lldbServerPath}`);

    await deviceAdb.push(lldbServerPath, "/data/local/tmp/android-debug/lldb-server");
    await deviceAdb.shell(`run-as ${packageName} mkdir -p /data/data/${packageName}/android-debug/lldb/bin/`);

    // Ignore failures if already exists
    try {
        await deviceAdb.shell(`cat /data/local/tmp/lldb-server | run-as ${packageName} sh -c 'cat > /data/data/${packageName}/android-debug/lldb/bin/lldb-server && chmod 700 /data/data/${packageName}/android-debug/lldb/bin/lldb-server'`);
    } catch {}

    let socket = `/${packageName}/platform-${utils.randomString(16)}.sock`;
    let subprocess = deviceAdb.createSubProcess(['shell', `run-as ${packageName} /data/data/${packageName}/android-debug/lldb/bin/lldb-server platform --listen unix-abstract://${socket}`]);
    subprocess.start();

    subprocess.on('output', (stdout, stderr) => {
        if (stdout.trim()) { logger.log(`lldb-server out ${stdout.trim()}`); }
        if (stderr.trim()) { logger.log(`lldb-server err ${stderr.trim()}`); }
    });

    return {
        socket,
        subprocess,
        stop: () => subprocess.stop()
    };
}

export async function getProcessList(device: Device) {
    let deviceAdb = await getDeviceAdb(device);

    let subprocess = deviceAdb.createSubProcess(['jdwp']);
    subprocess.start();

    let processList: {pid: string, name: string}[] = [];
    subprocess.on('lines-stdout', async (lines) => {
        let processes = await Promise.all(lines.map(async (pid: string) => ({
            pid,
            name: await deviceAdb.getNameByPid(pid)
        })));

        processList.push(...processes);
    });

    // Wait for two seconds
    await new Promise((resolve, reject) => setTimeout(resolve, 2000));

    await subprocess.stop();

    logger.log("getProcessList", processList);

    return processList;
}

export async function activate(_sdkRoot?: string, _ndkRoot?: string) {
    sdkRoot = _sdkRoot ?? "";
    ndkRoot = _ndkRoot ?? "";
}