import { execFile, type ChildProcess } from "child_process";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

/** Wait for an owned child to exit; a sent signal alone is not completion. */
export function stopDashboardProcess(
  proc: ChildProcess,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    let forced = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (success: boolean): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      proc.removeListener("exit", exited);
      resolve(success);
    };
    const exited = (): void => finish(true);
    const force = (): void => {
      if (finished || forced) return;
      forced = true;
      if (timer) clearTimeout(timer);
      try {
        proc.kill("SIGKILL");
      } catch {
        finish(false);
        return;
      }
      // Quit is bounded even if the OS refuses termination or no exit arrives.
      timer = setTimeout(() => finish(false), 1000);
    };
    proc.once("exit", exited);
    if (platform === "win32" && proc.pid) {
      // An argument array avoids shell interpolation; /T includes children.
      timer = setTimeout(force, 2000);
      execFile(
        "taskkill",
        ["/PID", String(proc.pid), "/T", "/F"],
        { ...HIDDEN_SUBPROCESS_OPTIONS, timeout: 2000 },
        (error) => {
          if (error) force();
          // A successful taskkill still needs the owned process's exit event.
        },
      );
    } else {
      timer = setTimeout(force, 2000);
      try {
        proc.kill("SIGTERM");
      } catch {
        finish(false);
      }
    }
  });
}
