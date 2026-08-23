/**
 * Shared FFmpeg video encoder profiles for assemble (and mirrored for CSDM).
 *
 * @typedef {"libx264" | "libx265" | "hevc_nvenc" | "h264_nvenc"} VideoCodec
 */

/** @type {Record<string, VideoCodec>} */
const ALIASES = {
  h264: "libx264",
  x264: "libx264",
  libx264: "libx264",
  h265: "libx265",
  hevc: "libx265",
  x265: "libx265",
  libx265: "libx265",
  "h265-nvenc": "hevc_nvenc",
  "hevc-nvenc": "hevc_nvenc",
  hevc_nvenc: "hevc_nvenc",
  "h264-nvenc": "h264_nvenc",
  h264_nvenc: "h264_nvenc",
  nvenc: "hevc_nvenc",
};

/**
 * @param {string | undefined} value
 * @returns {VideoCodec}
 */
export function resolveVideoCodec(value) {
  if (!value) {
    return "libx264";
  }
  const key = String(value).trim().toLowerCase();
  const codec = ALIASES[key];
  if (!codec) {
    throw new Error(
      `Unknown video codec "${value}". Use: libx264, libx265, hevc_nvenc, h264_nvenc`,
    );
  }
  return codec;
}

/**
 * FFmpeg args after `-c:v` (does not include `-c:v` itself).
 * @param {VideoCodec} codec
 * @param {{ crf?: number, stillImage?: boolean }} [options]
 * @returns {string[]}
 */
export function videoEncoderArgs(codec, options = {}) {
  const crf = options.crf ?? 23;
  switch (codec) {
    case "libx265":
      return [
        "libx265",
        "-crf",
        String(crf),
        "-preset",
        "medium",
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
      ];
    case "hevc_nvenc":
      return [
        "hevc_nvenc",
        "-preset",
        "p4",
        "-rc",
        "vbr",
        "-cq",
        String(crf),
        "-b:v",
        "0",
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
      ];
    case "h264_nvenc":
      return [
        "h264_nvenc",
        "-preset",
        "p4",
        "-rc",
        "vbr",
        "-cq",
        String(crf),
        "-b:v",
        "0",
        "-pix_fmt",
        "yuv420p",
      ];
    case "libx264":
    default: {
      const args = ["libx264", "-crf", String(crf), "-pix_fmt", "yuv420p"];
      if (options.stillImage) {
        args.push("-tune", "stillimage");
      }
      return args;
    }
  }
}

/**
 * CSDM `ffmpegSettings` fragment for HLAE streaming.
 * @param {VideoCodec} codec
 * @param {{ crf?: number, audioBitrate?: number }} [options]
 */
export function csdmFfmpegSettings(codec, options = {}) {
  const crf = options.crf ?? 23;
  const audioBitrate = options.audioBitrate ?? 256;
  const isNvenc = codec === "hevc_nvenc" || codec === "h264_nvenc";

  // When outputParameters is set, CSDM still injects -c:v <videoCodec>;
  // put rate-control + pix_fmt here so NVENC does not get a bare -crf.
  /** @type {string} */
  let outputParameters = "";
  if (isNvenc) {
    outputParameters = `-pix_fmt yuv420p -preset p4 -rc vbr -cq ${crf} -b:v 0`;
    if (codec === "hevc_nvenc") {
      outputParameters += " -tag:v hvc1";
    }
  } else if (codec === "libx265") {
    outputParameters = `-pix_fmt yuv420p -crf ${crf} -preset medium -tag:v hvc1`;
  }

  return {
    audioBitrate,
    constantRateFactor: crf,
    customLocationEnabled: false,
    customExecutableLocation: "",
    videoContainer: "mp4",
    videoCodec: codec,
    audioCodec: "aac",
    inputParameters: "",
    outputParameters,
  };
}
