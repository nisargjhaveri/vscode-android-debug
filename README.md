# android-debug · Android Native Debugging in VS Code

> This is still work-in-progress. Please open issues if you find something is not working as expected.

Add ability to debug native code in Android in VS Code. If your Android app uses native code and you'd like to debug it in VS Code, this is fot you.

# Features

- Attach to running Android apps via lldb.
- Specify one or more locations to search for your so files.
- Dynamic support for specifying and selecting ABIs to support various fat and split apk conficurations.

# Requirements

You need to specify `android-debug.sdkRoot` and `android-debug.ndkRoot` to sdk and ndk install folder on your machine respectively.

# Configurations

The following settings are required to be set.

* `android-debug.sdkRoot`: Location for Android SDK on your machine
* `android-debug.ndkRoot`: Location for Android NDK on your machine
