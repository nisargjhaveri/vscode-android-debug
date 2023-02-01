import * as vscode from 'vscode';

class OutputLogger {
    private channel: vscode.OutputChannel = vscode.window.createOutputChannel("Android Debug");

    private getFormattedTime() {
        let time = new Date();
        return `${time.getFullYear()}-${time.getMonth()+1}-${time.getDate()} ${time.getHours()}:${time.getMinutes()}`;
    }

    private formatSingleMessage(message: any) {
        if (typeof(message) === "undefined") {
            return "undefined";
        }
        else if (message === null) {
            return "null";
        }
        else if (typeof message === "object") {
            return JSON.stringify(message, undefined, 4);
        }
        else if (message.toString) {
            return message.toString();
        }
        else {
            return message;
        }
    }

    private format(severity: "ERROR"|"WARN"|"INFO"|"DEBUG", ...data: any[]) {
        let message = data.map(this.formatSingleMessage).join(' ');

        return `[${this.getFormattedTime()}] [${severity}] ${message}`;
    }

    log(...data: any[]): void {
        this.info(...data);
    }

    debug(...data: any[]): void {
        this.channel.appendLine(this.format("DEBUG", ...data));
    }
    info(...data: any[]): void {
        this.channel.appendLine(this.format("INFO", ...data));
    }
    warn(...data: any[]): void {
        this.channel.appendLine(this.format("WARN", ...data));
    }
    error(...data: any[]): void {
        this.channel.appendLine(this.format("ERROR", ...data));
    }
}

export const logger = new OutputLogger();