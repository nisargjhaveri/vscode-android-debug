# android-debug · Android Native Debugging in VS Code

> This is still work-in-progress. Please [find or create issues on GitHub](https://github.com/nisargjhaveri/vscode-android-debug/issues) if you find something is not working as expected.

Add ability to debug Java and Native code on Android in VS Code.

# Features
- Attach to running Android apps with Native, Java or Dual debugging.
- Specify one or more locations to search for your so files, or source paths for Java.
- Dynamic support for specifying and selecting ABIs to support various fat and split apk configurations.
- Select from connected devices or start an existing emulator for debugging.

# Limitations
- While this extension supports Java debuggin via [Debugger for Java by Microsoft](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug), the experience is not great yet. The debugging itself should work as expected, but the [Language Support for Java(TM) by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.java) does not support Android projects very well.

# Requirements
This extension requires Android SDK to be installed along with platform-tools and optionally Android NDK for native code debugging. If you have these installed at custom locations, see [Configurations](#configurations).

# Quick Start

For a simple Android app with both Java and Native code, the following config should get you started. See [Launch Configuration Options](#launch-configuration-options) for more details.
```json
{
    "name": "Android",
    "type": "android-debug",
    "request": "attach",
    "target": "select",
    "pid": "${command:pickAndroidProcess}",
    "mode": "dual", // Change to `java` or `native` to attach only Java or Native debugger.
    "packageName": "com.example.sampleapplication", // Pakcage name for your app.
    "native": {
        "symbolSearchPaths": [
            "${workspaceFolder}/app/build/intermediates/cmake/debug/obj/${command:abi}/",
        ],
    },
    "java": {
        "sourcePaths": ["${workspaceFolder}/app/src/main/java"]
    }
}
```

# How to use

Create a launch configuration in your `launch.json` file with `type: android-debug` to use this extension.

## Launch Configuration Options
Here are all the options supported with explanation and example values.

```json
{
    // Set the name of the launch config.
    "name": "Android",

    // Set type to `android-debug` to use this extension.
    "type": "android-debug",

    // Request should be set to `attach` for debugging an already running app.
    "request": "attach",

    // Target device for debugging.
    // This can `select`, `last-selected` or serial of the connected android device as shown in 'adb devices'
    "target": "select",

    // Process id of the app. Set to `${command:pickAndroidProcess}` to pick the process when you start the debugging.
    "pid": "${command:pickAndroidProcess}",

    // Package name of your app.
    // This is required in case of native debugging.
    "packageName": "com.example.sampleapplication",

    // Mode for debugging. One of `java`, `native` or `dual`.
    "mode": "dual",

    // Options for native debugging
    "native": {
        // List of supported ABIs for the app.
        "abiSupported": ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"],

        // Map of ABI to custom string. To be used with ${command:mappedAbi}.
        // This can be useful if you have custom build system and the location of SO files uses custom strings for ABIs.
        "abiMap": {
            "armeabi-v7a": "arm",
            "arm64-v8a": "arm64",
            "x86": "x86",
            "x86_64": "x64",
        },

        // ABI to use for the current debug session.
        // This can be set to one of the ABIs directly, or to `select` to show a picker.
        "abi": "select",

        // Paths where to look for the SO files used in your app.
        // You can use `${command:abi}` and `{command:mappedAbi}` when specifying the paths.
        "symbolSearchPaths": [
            "${workspaceFolder}/app/build/intermediates/cmake/debug/obj/${command:abi}/",
        ],
    },

    // Options for java debugging
    "java": {
        // List of source paths for your java files.
        "sourcePaths": ["${workspaceFolder}/app/src/main/java"]
    }
}
```

# Configurations
The following settings can be set as per your requirements and setup.

* `android-debug.sdkRoot`: Location for Android SDK on your machine
* `android-debug.ndkRoot`: Location for Android NDK on your machine
