import * as vscode from 'vscode';
import * as logger from './logger';
import * as android from './android';
import { Device } from './commonTypes';

let context: vscode.ExtensionContext;
let lldbProcessKillers: {[socket: string]: () => void} = {};

export async function lldbServer(args: {device: Device, packageName: string})
{
	let {device, packageName} = args;

	return vscode.window.withProgress({
		"location": vscode.ProgressLocation.Notification,
		"title": "Starting LLDB server",
		"cancellable": true
	}, (progress, token) => {
		let cancellationToken = {cancel: () => {}};

		token.onCancellationRequested((e) => cancellationToken.cancel());

		return Promise.resolve()
			.then(() => android.startLldbServer(device, packageName))
			.then(({socket, stop}) => {

				lldbProcessKillers[socket] = stop;

				return socket;
			})
			.catch((e) => {
				vscode.window.showErrorMessage("Failed to start lldb server");
			});
	});
}

export function lldbServerCleanup(socket: string) {
	logger.log(`Cleaning up lldb server at socket ${socket}`);

	if (!(socket in lldbProcessKillers)) {
		return;
	}

	lldbProcessKillers[socket]();

	delete lldbProcessKillers[socket];
}

export function activate(c: vscode.ExtensionContext) {
	context = c;

	// Clean all open debugserver processes
	context.subscriptions.push({
		dispose() {
			for(const socket in lldbProcessKillers) {
				lldbProcessKillers[socket]();
			}
		}
	});
}