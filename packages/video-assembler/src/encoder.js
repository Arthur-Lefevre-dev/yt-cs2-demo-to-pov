/**
 * Shared FFmpeg video encoder profiles for assemble (and mirrored for CSDM).
 *
 * @typedef {"libx264" | "libx265" | "hevc_nvenc" | "h264_nvenc" | "hevc_amf" | "h264_amf"} VideoCodec
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
  "h265-amf": "hevc_amf",
  "hevc-amf": "hevc_amf",
  hevc_amf: "hevc_amf",
  "h264-amf": "h264_amf",
  h264_amf: "h264_amf",
  amf: "hevc_amf",
  amd: "hevc_amf",
};

const CODEC_HELP =
  "libx264, libx265, hevc_nvenc, h264_nvenc, hevc_amf, h264_amf";

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
    throw new Error(`Unknown video codec "${value}". Use: ${CODEC_HELP}`);
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
    case "hevc_amf":
      return [
        "hevc_amf",
        "-quality",
        "balanced",
        "-rc",
        "cqp",
        "-qp_i",
        String(crf),
        "-qp_p",
        String(crf),
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
      ];
    case "h264_amf":
      return [
        "h264_amf",
        "-quality",
        "balanced",
        "-rc",
        "cqp",
        "-qp_i",
        String(crf),
        "-qp_p",
        String(crf),
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
 * Extra FFmpeg flags for CSDM HLAE `outputParameters` (CSDM still injects `-c:v`).
 * @param {string} codec
 * @param {number} crf
 */
export function csdmOutputParameters(codec, crf) {
  if (codec === "hevc_nvenc" || codec === "h264_nvenc") {
    let params = `-pix_fmt yuv420p -preset p4 -rc vbr -cq ${crf} -b:v 0`;
    if (codec === "hevc_nvenc") {
      params += " -tag:v hvc1";
    }
    return params;
  }
  if (codec === "hevc_amf" || codec === "h264_amf") {
    let params = `-pix_fmt yuv420p -quality balanced -rc cqp -qp_i ${crf} -qp_p ${crf}`;
    if (codec === "hevc_amf") {
      params += " -tag:v hvc1";
    }
    return params;
  }
  if (codec === "libx265") {
    return `-pix_fmt yuv420p -crf ${crf} -preset medium -tag:v hvc1`;
  }
  return "";
}

/**
 * CSDM `ffmpegSettings` fragment for HLAE streaming.
 * @param {VideoCodec} codec
 * @param {{ crf?: number, audioBitrate?: number }} [options]
 */
export function csdmFfmpegSettings(codec, options = {}) {
  const crf = options.crf ?? 23;
  const audioBitrate = options.audioBitrate ?? 256;

  return {
    audioBitrate,
    constantRateFactor: crf,
    customLocationEnabled: false,
    customExecutableLocation: "",
    videoContainer: "mp4",
    videoCodec: codec,
    audioCodec: "aac",
    inputParameters: "",
    outputParameters: csdmOutputParameters(codec, crf),
  };
}
