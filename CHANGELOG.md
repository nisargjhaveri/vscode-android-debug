# Change Log

All notable changes to the "android-debug" extension will be documented in this file.

## v0.0.8
- Fix start lldb server phase, which was failing due to an incorrect path

## v0.0.7
- Support `ANDROID_NDK_ROOT` environment variable to specify ndk root

## v0.0.6
- Add new `android-debug.abiSupported` and `android-debug.abiMap` config options to default to when not specified in launch config.
- Faster process picker
- Improve ABI picker by showing supported ABIs first

## v0.0.5
- Launch requests are now supported with `android-debug`.
- Remove hard dependency on CodeLLDB.
- Prompt to install required extensions whenever needed.
- Miscellaneous improvements 

## v0.0.4
### Breaking Changes
- The debugger type is now `android-debug` instead of `android`.

### What's new
- Add ability to list and launch stopped AVDs from target picker.
- Multiple other improvements in target picker.

## v0.0.3
- Fix sdk detection on Windows
- Minor improvement in process picker sort

## v0.0.2

### What's new
- Automatically identify sdk and ndk root.
- Improvements to process picker.
- New 'android' debugger type, with experimental support for dual native and java debugging.
- Experimental support for Java debugging based on Debugger for Java by Microsoft.

### Breaking changes
- Some options for 'lldb' debug type have changed

## v0.0.1
- Initial release with support for some basic scenarios.