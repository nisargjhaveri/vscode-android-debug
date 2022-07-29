import * as logger from './logger';
import * as crypto from 'crypto';
import { ADB, Device } from './commonTypes';
import { getDeviceAdb, getLldbServerRoot } from './adb';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import path = require('path');

function randomString() {
    let random;

    try {
        random = crypto.randomBytes(16);
    } catch (e) {
        random = crypto.pseudoRandomBytes(16);
    }

    return random.toString('hex');
}


async function getAbiList(deviceAdb: ADB) {
    let abi = await deviceAdb.getDeviceProperty("ro.product.cpu.abi");
    let abilist = (await deviceAdb.getDeviceProperty("ro.product.cpu.abilist")).split(",");

    abilist.unshift(abi);
    abilist.filter((item, pos, self) => {
        return item && self.indexOf(item) === pos;
    });

    return abilist;
}

async function getLLdbServerForDevice(deviceAdb: ADB) {
    let abilist = await getAbiList(deviceAdb);
    let lldbServerRoot = await getLldbServerRoot();

    let lldbServerPath;
    for (let abi of abilist) {
        let lldbServerPossiblePath = path.join(lldbServerRoot, abi, "lldb-server");

        try {
            await fsPromises.access(lldbServerPossiblePath, fs.constants.R_OK);
            lldbServerPath = lldbServerPossiblePath;
            break;
        }
        catch (e) {
            // Assume not avaialble
        }
    }
    
    if (!lldbServerPath) {
        throw new Error("lldb-server not found for the device");
    }

    return lldbServerPath;
}

export async function startLldbServer(device: Device, packageName: string) {
    let deviceAdb = await getDeviceAdb(device);
    let lldbServerPath = await getLLdbServerForDevice(deviceAdb);

    await deviceAdb.push(lldbServerPath, "/data/local/tmp/android-debug/lldb-server");
    await deviceAdb.shell(`run-as ${packageName} mkdir -p /data/data/${packageName}/android-debug/lldb/bin/`);

    // Ignore failures if already exists
    try {
        await deviceAdb.shell(`cat /data/local/tmp/lldb-server | run-as ${packageName} sh -c 'cat > /data/data/${packageName}/android-debug/lldb/bin/lldb-server && chmod 700 /data/data/${packageName}/android-debug/lldb/bin/lldb-server'`);
    } catch {}

    let socket = `/${packageName}/platform-${randomString()}.sock`;
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
