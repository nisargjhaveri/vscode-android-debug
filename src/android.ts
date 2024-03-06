import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as ini from 'ini';
import * as teen_process from 'teen_process';

import { ADB, BinaryName, Device, VerboseDevice, ShellExecOptions } from 'appium-adb';

import { logger } from './logger';
import * as utils from './utils';

import * as androidPaths from './androidPaths';
import { JDWP } from './jdwp';
import Logcat from 'appium-adb/lib/logcat';
import { printLogcat } from './extension';

let adb: ADB;
let forceRecreateAdb = false;

export async function handlePathsUpdated() {
  forceRecreateAdb = true;
}

// ADB helpers
export async function getAdb() {
  if (!adb || forceRecreateAdb) {
    adb = await ADB.createADB({ sdkRoot: androidPaths.requireSdkRoot(), adbExecTimeout: 600000 });
    forceRecreateAdb = false;
  }

  return adb;
}

export async function getDeviceAdb(device: Device) {
  let deviceAdb = (await getAdb()).clone();
  deviceAdb.setDevice(device);

  return deviceAdb;
}

// Connected device information
export async function getDeviceFromUDID(udid: string): Promise<VerboseDevice> {
  let adb = await getAdb();

  let devices = await adb.getConnectedDevices({ verbose: true });

  let device = devices.filter((d) => {
    return d.udid === udid;
  });

  if (device.length > 0) {
    return device[0];
  }

  throw new Error(`Could not find connected device with serial ${udid}`);
}

export async function isDeviceConnected(udid: string): Promise<boolean> {
  let adb = await getAdb();

  let devices = await adb.getConnectedDevices();

  let found = devices.filter((d) => {
    return d.state === "device" && d.udid === udid;
  });

  return found.length > 0;
}

async function getDeviceAbiListInternal(deviceAdb: ADB) {
  let abilist = [];

  abilist.push(...(await deviceAdb.getDeviceProperty("ro.product.cpu.abilist")).split(","));

  if (!abilist.length) {
    abilist.push(...[
      await deviceAdb.getDeviceProperty("ro.product.cpu.abi"),
      await deviceAdb.getDeviceProperty("ro.product.cpu.abi2")
    ]);
  }

  abilist.filter((item) => {
    return item && item.length;
  });

  return abilist;
}

export async function getDeviceAbiList(device: Device) {
  return await getDeviceAbiListInternal(await getDeviceAdb(device));
}

export async function getBestAbi(device: Device, abiSupportedList: string[]) {
  let deviceAdb = await getDeviceAdb(device);
  let deviceAbiList = await getDeviceAbiListInternal(deviceAdb);

  abiSupportedList = abiSupportedList;

  for (let abi of deviceAbiList) {
    if (abiSupportedList.indexOf(abi) >= 0) {
      return abi;
    }
  }

  throw new Error("Cannot find appropriate ABI to use");
}

// LLDB server
async function getLldbServer(abi: string): Promise<string> {
  try {
    let platform = os.platform();

    let llvmHostName = (platform === "win32") ? "windows-x86_64" : (platform === "darwin") ? "darwin-x86_64" : "linux-x86_64";
    let llvmArch = abi.startsWith("armeabi") ? "arm" : (abi === "arm64-v8a") ? "aarch64" : (abi === "x86") ? "i386" : "x86_64";

    let llvmToolchainDir = path.normalize(`${androidPaths.requireNdkRoot()}/toolchains/llvm/prebuilt/${llvmHostName}`);

    let lldvPackageVersion = (await fsPromises.readFile(path.join(llvmToolchainDir, "AndroidVersion.txt"), "utf8")).split("\n")[0];

    const toolchainLibsPath = [
      `lib64/clang/${lldvPackageVersion}`, // Old path for NDK <= 25
      `lib/clang/${lldvPackageVersion}`,
      `lib/clang/${lldvPackageVersion.split(".")[0]}`
    ];
    for (let toolchainLib of toolchainLibsPath) {
      let lldbServerPath = path.normalize(`${llvmToolchainDir}/${toolchainLib}/lib/linux/${llvmArch}/lldb-server`);

      try {
        await fsPromises.access(lldbServerPath, fs.constants.R_OK);

        return lldbServerPath;
      } catch {
        // This path does not exist, try next
      }
    }

    throw new Error("Could not locate lldb-server for the device");
  } catch {
    throw new Error("Could not locate lldb-server for the device");
  }
}

export async function startLldbServer(device: Device, packageName: string, abi: string) {
  if (!packageName) {
    throw new Error("A valid package name is required.");
  }

  let deviceAdb = await getDeviceAdb(device);
  let lldbServerLocalPath = await getLldbServer(abi);

  logger.log(`Using lldb-server at ${lldbServerLocalPath}`);

  const lldbServerTmpPath = `/data/local/tmp/android-debug/lldb-server`;
  const lldbServerDir = `/data/data/${packageName}/android-debug/lldb/bin`;
  const lldbServerPath = `${lldbServerDir}/lldb-server`;

  await deviceAdb.push(lldbServerLocalPath, lldbServerTmpPath);
  await deviceAdb.shell(`run-as ${packageName} mkdir -p ${lldbServerDir}`);

  // Ignore failures if already exists
  try {
    await deviceAdb.shell(`cat ${lldbServerTmpPath} | run-as ${packageName} sh -c 'cat > ${lldbServerPath} && chmod 700 ${lldbServerPath}'`);
  } catch { }

  let socket = `/${packageName}/platform-${utils.randomString(16)}.sock`;
  let subprocess = deviceAdb.createSubProcess(['shell', `run-as ${packageName} ${lldbServerPath} platform --listen unix-abstract://${socket}`]);
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

// Process information
export async function getProcessList(device: Device, populatePackageNames: boolean = false) {
  let deviceAdb = await getDeviceAdb(device);

  let subprocess = deviceAdb.createSubProcess(['jdwp']);
  subprocess.start();

  let resolveWaitTimer: (v: void) => void;
  let processWaitTimer = new Promise((resolve, reject) => { resolveWaitTimer = resolve; });
  // @ts-ignore
  let timeout = setTimeout(resolveWaitTimer, 3000);

  let processPromises: Promise<{ pid: string, name: string, packages: string[] }>[] = [];
  subprocess.on('lines-stdout', (lines: string[]) => {
    // Clear timeout first if we have more output
    clearTimeout(timeout);

    // Get process info
    let processes = lines
      .map((l) => l.trim())
      .map((pid: string) => getProcessInfoInternal(deviceAdb, pid, populatePackageNames));

    processPromises.push(...processes);

    // Wait for 200 ms for more output, if any
    timeout = setTimeout(resolveWaitTimer, 200);
  });

  await processWaitTimer;

  await subprocess.stop();

  let processList = await Promise.all(processPromises);

  logger.log("getProcessList", processList);

  return processList;
}

async function getProcessInfoInternal(deviceAdb: ADB, pid: string, populatePackageNames: boolean) {
  let name = await deviceAdb.getNameByPid(pid);
  let packages: string[] = [];

  if (populatePackageNames) {
    packages = await getPackagesForProcess(deviceAdb, pid);

    packages = packages.sort((a, b) => {
      if (a === name) { return -1; }
      if (b === name) { return 1; }

      let result = Number(name.startsWith(b)) - Number(name.startsWith(a));
      if (result !== 0) { return result; }

      return a.localeCompare(b);
    });
  }

  return {
    pid,
    name,
    packages
  };
}

export async function getProcessInfo(device: Device, pid: string, populatePackageNames: boolean) {
  return getProcessInfoInternal(await getDeviceAdb(device), pid, populatePackageNames);
}

async function getPackagesForProcess(deviceAdb: ADB, pid: string) {
  let packages: string[] = [];
  try {
    let out = await deviceAdb.shell(`stat -c %u /proc/${pid} | xargs -n 1 cmd package list packages --uid`);
    let pattern = /^package:(\S+)\s+.*/gm;

    packages = [...out.matchAll(pattern)].map((match) => match[1]);
  }
  catch {
    // Ignore errors
  }

  return packages;
}

export async function getPackageNameFromApk(apkPath: string) {
  if (!apkPath) {
    return "";
  }

  let adb = await getAdb();

  let appInfo = await adb.getApkInfo(apkPath);

  return "name" in appInfo ? appInfo.name : "";
}

// JDWP Port forwarding
export async function forwardJdwpPort(device: Device, pid: string) {
  let deviceAdb = await getDeviceAdb(device);
  return await deviceAdb.adbExec(["forward", `tcp:0`, `jdwp:${pid}`]) as any as string;
}

export async function removeTcpForward(device: Device, port: string) {
  let deviceAdb = await getDeviceAdb(device);
  return await deviceAdb.removePortForward(port);
}

export async function resumeJavaDebugger(device: Device, pid: string): Promise<() => Promise<void>> {
  let port = await forwardJdwpPort(device, pid);
  let jdwp = new JDWP(Number(port), "localhost");

  let cleanup = async () => {
    jdwp.disconnect();
    removeTcpForward(device, port);
  };

  try {
    await jdwp.connect();
    await jdwp.resume();

    return cleanup;
  }
  catch (e) {
    cleanup();
    throw e;
  }
}

// AVD helpers
export async function getAvdDisplayName(avdName: string) {
  let displayName: string | undefined = undefined;

  try {
    let avdProperties: any = await adb.getEmuImageProperties(avdName);

    if (avdProperties?.path) {
      let configPath = path.join(avdProperties.path, "config.ini");
      let avdConfig = ini.parse(await fsPromises.readFile(configPath, 'utf8'));

      displayName = avdConfig["avd.ini.displayname"];
    }
  }
  catch {
    // Ignore errors
  }

  return displayName || avdName.replace(/_/g, " ");
}

export async function getAvdList() {
  let adb = await getAdb();

  try {
    let emulatorPath = await adb.getBinaryFromSdkRoot("emulator" as BinaryName);

    let result = await teen_process.exec(emulatorPath, ['-list-avds'], { shell: false });

    let avdNames: string[] = [];
    if (result.code === 0) {
      avdNames = result.stdout.split("\n").map((avd) => avd.trim()).filter((avd) => avd);
    }

    return avdNames;
  }
  catch {
    // Ignore errors
  }

  return [];
}

export async function launchAVD(avdName: string) {
  let adb = (await getAdb()).clone();
  await adb.launchAVD(avdName);
  if (adb.curDeviceId) {
    return getDeviceFromUDID(adb.curDeviceId);
  }
  throw new Error("Could not launch Android Virtual Device");
}

// Application install and launch
export async function installApp(device: Device, apkPath: string) {
  let deviceAdb = await getDeviceAdb(device);

  try {
    await deviceAdb.install(apkPath, { "replace": true });
  }
  catch (e: any) {
    throw new Error("Installation of APK failed: " + (e.stderr ?? e.message));
  }
}

// Definition of different logcat severity levels
enum LogCatSeverity {
  unknown = 0,
  default = 1,
  verbose = 2,
  debug = 3,
  info = 4,
  warning = 5,
  error = 6,
  fatal = 7,
  silent = 8
}

// Parse a logcat severity into the enum
function parseLogCatSeverity(s: String): LogCatSeverity {
  switch (s) {
    case 'V': return LogCatSeverity.verbose;
    case 'D': return LogCatSeverity.debug;
    case 'I': return LogCatSeverity.info;
    case 'W': return LogCatSeverity.warning;
    case 'E': return LogCatSeverity.error;
    case 'F': return LogCatSeverity.fatal;
    case 'S': return LogCatSeverity.silent;
    default: return LogCatSeverity.default;
  }
}

// Map severity to names shown in the log
function formatLogCatSeverity(severity: LogCatSeverity): string {
  switch (severity) {
    case LogCatSeverity.verbose: return "verbose";
    case LogCatSeverity.debug: return "debug";
    case LogCatSeverity.info: return "info";
    case LogCatSeverity.warning: return "warning";
    case LogCatSeverity.error: return "error";
    case LogCatSeverity.fatal: return "fatal";
    default: return "verbose";
  }
}

// Parse a log cat message line into a json object
function parseLogCatEntry(str: String) {
  // Split the string into
  let array = str.split(' ').filter(Boolean);
  array.length = 5;

  let currentDate = new Date();
  let date = new Date(Date.parse(array[0] + " " + array[1]));
  date.setFullYear(currentDate.getFullYear());

  let pid = array[2];
  let tid = array[3];

  let severity = parseLogCatSeverity(array[4]);

  let tagMessage = str.substring(array.join(' ').length + 1);
  let index = tagMessage.indexOf(':');

  let tag = tagMessage.substring(0, index).trim();
  let message = tagMessage.substring(index + 1).trim();

  return {
    date: date,
    pid: pid,
    tid: tid,
    severity: severity,
    tag: tag,
    message: message
  };
}

// Format integer to have a fixed padding
function formatInt(v: number, numDigits: number): string {
  return v.toString().padStart(numDigits, '0');
}

// Format date for android logcat output
function formatDate(date: Date): string {
  let dateStr = `${formatInt(date.getFullYear(), 4)}-${formatInt(date.getMonth() + 1, 2)}-${formatInt(date.getDate(), 2)}`;
  let timeStr = `${formatInt(date.getHours(), 2)}:${formatInt(date.getMinutes(), 2)}:${formatInt(date.getSeconds(), 2)}.${formatInt(date.getMilliseconds(), 3)}`;

  return `${dateStr} ${timeStr}`;
}

// Create an empty directory on the device
export async function createDirectory(device: Device, path: string) {
  let deviceAdb = await getDeviceAdb(device);

  await deviceAdb.shell(['mkdir', '-p', path]);
  await deviceAdb.shell(['chmod', '777', path]);
}

// Sync a directory to the device
export async function syncDirectory(device: Device, local: string, remote: string) {
  await createDirectory(device, remote);

  let deviceAdb = await getDeviceAdb(device);
  await deviceAdb.adbExec(['push', '--sync', local, remote]);
}

// Attach logcat output
export async function captureLogCat(device: Device, pid: string) {
  let adb = await getDeviceAdb(device);

  let logCat = new Logcat({ adb: adb.executable });

  logCat.on('output', function (output) {
    let entry = parseLogCatEntry(output.message);
    if (entry.pid === pid) {
      let formattedDate = formatDate(entry.date);
      let name = formatLogCatSeverity(entry.severity);
      printLogcat(formattedDate + " [" + name + "] " + entry.tag + ": " + entry.message);
    }
  });

  logCat.startCapture();

  return logCat;
}

export async function launchApp(device: Device, packageName: string, launchActivity: string, extra: any | null) {
  let deviceAdb = await getDeviceAdb(device);

  let extraArgs = '';
  for (const [key, value] of Object.entries(extra)) {
    if (value instanceof "".constructor) {
      extraArgs += `--es ${key} "${value}" `;
    }
    else if (value instanceof Boolean) {
      extraArgs += `--eb ${key} ${value} `;
    }
    else if (value instanceof [].constructor) {
      let array = <Array<any>>value;
      let arrayParam = "\"" + array.join("\",\"") + "\"";
      extraArgs += `--esa ${key} ${arrayParam} `;
    }
  }

  let launchCmd = `am start -D -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${extraArgs} ${packageName}/${launchActivity}`;

  let { stdout, stderr } = await deviceAdb.shell(launchCmd, { outputFormat: deviceAdb.EXEC_OUTPUT_FORMAT.FULL } as ShellExecOptions) as any as { stdout: string, stderr: string };

  // The error handling is inspired from from appium-adb's startApp method
  if (stderr.includes('Error: Activity class') && stderr.includes('does not exist')) {
    throw new Error(`Activity used to start the app doesn't exist or cannot be launched. Make sure it exists and is a launchable activity.`);
  } else if (stderr.includes('Error: Intent does not match any activities') || stderr.includes('Error: Activity not started, unable to resolve Intent')) {
    throw new Error(`Activity for intent used to start the app doesn't exist or cannot be launched. Make sure it exists and is a launchable activity.`);
  } else if (stderr.includes('java.lang.SecurityException')) {
    // if the app is disabled on a real device it will throw a security exception
    throw new Error(`The permission to start activity has been denied. Make sure the activity/package names are correct.`);
  }
}

export async function killApp(device: Device, packageName: string) {
  let deviceAdb = await getDeviceAdb(device);

  return await deviceAdb.shell(`am force-stop ${packageName}`);
}
