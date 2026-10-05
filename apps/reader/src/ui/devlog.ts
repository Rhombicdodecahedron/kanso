/** Dev builds: mirror a log line to the local repo server (independent of Metro's log stream). */
export function devLog(line: string): void {
  if (!__DEV__) return;
  console.log(`[kanso-debug] ${line}`);
  fetch('http://127.0.0.1:8787/log', { method: 'POST', body: `${new Date().toISOString()} ${line}` }).catch(() => {});
}
