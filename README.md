# android-debug · Android Debugging in VS Code

> This is still work-in-progress. Please [find or create issues on GitHub](https://github.com/nisargjhaveri/vscode-android-debug/issues) if you find something is not working as expected.

Debug Android apps in VS Code, with Native, Java or Dual debugging.

# Features
- Launch/Attach Android apps
- Java, Native or Dual debugging.
- Specify one or more locations to search for your so files, or source paths for Java.
- Dynamic support for specifying and selecting ABIs to support various fat and split apk configurations.
- Select from connected devices or start an existing emulator for debugging.

# Requirements
- Android SDK to be installed along with platform-tools and optionally Android NDK for native code debugging. If you have these installed at custom locations, see [Configurations](#configurations).

- [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) extension for native debugging

- [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) extension for java debugging
- [Language Support for Java(TM) by Red Hat](https://marketplace.visualstudio.com/items?itemName=redhat.java) extension for java debugging

# Quick Start

For a simple Android app with both Java and Native code, the following config should get you started. See [Launch Configuration Options](#launch-configuration-options) for more details.

```jsonc
{
    "version": "0.2.0",
    "configurations": [
        // Launch app for debugging
        {
            "name": "Android",
            "type": "android-debug",
            "request": "launch",
            "target": "select",
            "mode": "dual", // Change to `java` or `native` to attach only Java or Native debugger.
            "packageName": "com.example.sampleapplication", // Package name for your app.
            "launchActivity": ".MainActivity",  // Activity to launch
            "native": {
                "symbolSearchPaths": [
                    "${workspaceFolder}/app/build/intermediates/cmake/debug/obj/${command:abi}/",
                ],
            },
            "java": {
                "sourcePaths": ["${workspaceFolder}/app/src/main/java"]
            }
        },

        // Attach to running app
        {
            "name": "Android",
            "type": "android-debug",
            "request": "attach",
            "target": "select",
            "pid": "${command:pickAndroidProcess}",
            "mode": "dual", // Change to `java` or `native` to attach only Java or Native debugger.
            "packageName": "com.example.sampleapplication", // Package name for your app.
            "native": {
                "symbolSearchPaths": [
                    "${workspaceFolder}/app/build/intermediates/cmake/debug/obj/${command:abi}/",
                ],
            },
            "java": {
                "sourcePaths": ["${workspaceFolder}/app/src/main/java"]
            }
        }
    ]
}
```

# How to use

Create a launch configuration in your `launch.json` file with `type: android-debug` to use this extension.

## Launch Configuration Options
Here are all the options supported with explanation and example values.

```jsonc
{
    // Set the name of the launch config.
    "name": "Android",

    // Set type to `android-debug` to use this extension.
    "type": "android-debug",

    // Request.
    // `launch` for launching and debugging the app.
    // `attach` for attaching to already running app.
    "request": "launch" or "attach",

    // Target device for debugging.
    // This can `select`, `last-selected` or serial of the connected android device as shown in 'adb devices'
    "target": "select",

    // Process id of the app.
    // Set to `${command:pickAndroidProcess}` to pick the process when you start the debugging.
    // Required and only applicable for `attach` request.
    "pid": "${command:pickAndroidProcess}",

    // Full path to the built APK.
    // If available this apk will be installed first to the target device.
    // At least one of `apkPath` or `packageName` is required for `launch` request.
    "apkPath": "${workspaceFolder}/app/build/outputs/apk/debug/app-debug.apk",

    // Package name of your app.
    // At least one of `apkPath` or `packageName` is required for `launch` request.
    "packageName": "com.example.sampleapplication",

    // Specify the activity you'd want to launch for debugging
    // The activity is launched with the following command:
    // $ adb shell am start -D -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${packageName}/${launchActivity}
    // Required and only applicable for `launch` request.
    "launchActivity": ".MainActivity",

    // Mode for debugging. One of `java`, `native` or `dual`.
    // Defaults to `java` if not specified.
    "mode": "dual",

    // Resume app process after attaching native debugger in case it is waiting for debugger by attaching a dummy Java debugger.
    // Defaults to `true` for `launch` request, `false` for `attach` request.
    // Only applicable in 'native' mode.
    "resumeProcess": true,

    // Options for native debugging
    "native": {
        // List of supported ABIs for the app.
        // Defaults to `android-debug.abiSupported` configuration if available.
        "abiSupported": ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"],

        // Map of ABI to custom string. To be used with ${command:mappedAbi}.
        // This can be useful if you have custom build system and the location of SO files uses custom strings for ABIs.
        // Defaults to `android-debug.abiMap` configuration if available.
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

        // All other options specified here are passes as is to the underlying Native debugger. See https://github.com/vadimcn/vscode-lldb/blob/master/MANUAL.md
    },

    // Options for java debugging
    "java": {
        // List of source paths for your java files.
        "sourcePaths": ["${workspaceFolder}/app/src/main/java"]

        // All other options specified here are passes as is to the underlying Java debugger. See https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug
    }
}
```

# Configurations
The following settings can be set as per your requirements and setup.

## SDK and NDK locations
* `android-debug.sdkRoot`: Location for Android SDK on your machine
* `android-debug.ndkRoot`: Location for Android NDK on your machine

## Defaults for launch configuration
* `android-debug.abiSupported`: List of supported ABIs for the app. Used as default when `native.abiSupported` is not specified in launch config.
* `android-debug.abiMap`: Map of ABI to custom string. Used as default when `native.abiMap` is not specified in launch config.
