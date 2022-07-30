import { Device, VerboseDevice } from 'appium-adb';

export { Device, VerboseDevice };

export type TargetType = "Device" | "Emulator";

export interface Target extends VerboseDevice {
    name: string,
    type: TargetType,
};