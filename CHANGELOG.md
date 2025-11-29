# Change Log

All notable changes to the "android-debug" extension will be documented in this file.

## v0.1.5
- Use system simpleperf for API level 29 and above
- Reverse sort ndk versions when trying to automatically detect ndk root

## v0.1.4
- Break on art_sigsegv_fault and art_sigbus_fault explicitly. Fix debugger detaching on crash without breaking. (#18)

## v0.1.3
- Add `recordAdditionalArgs` option to profiler configuration to allow passing additional arguments to `simpleperf record`.
- Bump a few dependencies based on `npm audit`.

## v0.1.2
- Handle case when simpleperf exists on its own before stopping profiler
- Minor: Add sampled events in profile info

## v0.1.1
- Add options to specify events to sample and sampling frequency to profiler.
- Ignore missing symbol search paths while symbolicating profiles

## v0.1.0
- Add command to resume process waiting for debugger
- Fix invalid emulators listed in target picker
- Add experimental support for CPU profiling using simpleperf and Firefox Profiler as interface.

## v0.0.10
- Minor fixes and upgrade to some dependencies.
- Ignore SIGBUS in native debugging to better align with Android Studio.

## v0.0.9
- Breaking: `mode` now defaults to `java` instead of `native` if not specified.
- Add option to install apk while by specifying `apkPath` option for `launch` requests.
- Ignore SIGSEGV in native debugging to be compatible with Android Studio.
- Fix lldb-server path in NDK 26.

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