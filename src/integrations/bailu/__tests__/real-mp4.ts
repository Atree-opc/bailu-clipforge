import { execFileSync } from "child_process";
import { ffmpegBin } from "@/lib/ffmpeg-path";

/** Generate a tiny but real ISO-BMFF video fixture with one positive-duration video stream. */
export function generateRealMp4(outputPath: string): void {
  execFileSync(
    ffmpegBin(),
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x24:r=10:d=0.3",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ],
    { stdio: "ignore", timeout: 10_000 },
  );
}
