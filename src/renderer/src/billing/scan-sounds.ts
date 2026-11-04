type Cue = "ok" | "error";

const files: Record<Cue, string> = { ok: "sounds/scan-ok.wav", error: "sounds/scan-error.wav" };
const players = new Map<Cue, HTMLAudioElement>();

function play(cue: Cue): void {
  try {
    let player = players.get(cue);
    if (!player) {
      player = new Audio(new URL(files[cue], document.baseURI).href);
      players.set(cue, player);
    }
    player.currentTime = 0;
    player.play().catch(() => {});
  } catch {
    // a missing audio device must never block a scan
  }
}

export const playScanOk = (): void => play("ok");
export const playScanError = (): void => play("error");
