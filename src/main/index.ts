import { app } from "electron";
import { applyGpuPreferences, installGpuCrashGuard } from "./gpu-fallback";
import { startMainProcess } from "./app/start";

applyGpuPreferences();
installGpuCrashGuard();

if (process.env.ENABLE_CDP === "1") {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.CDP_PORT || "9222",
  );
}

startMainProcess();
