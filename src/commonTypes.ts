import { ADB, Device, VerboseDevice } from 'appium-adb';

export { ADB, Device };

export type TargetType = "Device" | "Emulator";

export interface Target extends VerboseDevice {
    name: string,
    type: TargetType,
};