// Bridge for gamepad presses read by the main process while the Home menu
// holds the controllers (the page's Gamepad API sees nothing then).

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("steamcouch", {
  onPad(callback: (action: string) => void) {
    ipcRenderer.on("pad", (_event, action: string) => callback(action));
  },
});
