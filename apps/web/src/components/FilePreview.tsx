import { useEffect, useState } from "react";
import { useI18n } from "../i18n-context";

const TEXT_PREVIEW_BYTES = 64 * 1024;
const IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "m4a", "mp3", "ogg", "wav"]);
const TEXT_EXTENSIONS = new Set(["csv", "json", "md", "text", "txt", "xml"]);

type FilePreviewProperties = {
  file: File;
};

function TextPreview({ file }: FilePreviewProperties) {
  const { t } = useI18n();
  const [text, setText] = useState(t("preview.loading"));

  useEffect(() => {
    let active = true;
    void file
      .slice(0, TEXT_PREVIEW_BYTES)
      .text()
      .then((value) => {
        if (active) setText(value);
      })
      .catch(() => {
        if (active) setText(t("preview.textUnavailable"));
      });
    return () => {
      active = false;
    };
  }, [file, t]);

  return (
    <>
      <pre className="file-preview-text">{text}</pre>
      {file.size > TEXT_PREVIEW_BYTES && (
        <p className="muted">{t("preview.limited")}</p>
      )}
    </>
  );
}

export function FilePreview({ file }: FilePreviewProperties) {
  const { t } = useI18n();
  const [objectUrl] = useState(() => URL.createObjectURL(file));
  const mimeType = file.type.toLowerCase();
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const isImage = mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
  const isVideo = mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension);
  const isAudio = mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension);
  const isText = TEXT_EXTENSIONS.has(extension);

  useEffect(
    () => () => {
      URL.revokeObjectURL(objectUrl);
    },
    [objectUrl]
  );

  let preview: React.ReactNode;
  if (isImage) {
    preview = <img src={objectUrl} alt={t("preview.imageAlt")} />;
  } else if (mimeType === "application/pdf" || extension === "pdf") {
    preview = (
      <iframe
        src={objectUrl}
        title={t("preview.pdfTitle")}
        sandbox=""
      />
    );
  } else if (isVideo) {
    preview = <video src={objectUrl} controls preload="metadata" />;
  } else if (isAudio) {
    preview = <audio src={objectUrl} controls preload="metadata" />;
  } else if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("+json") ||
    mimeType.endsWith("+xml") ||
    isText
  ) {
    preview = <TextPreview file={file} />;
  } else {
    preview = (
      <p className="muted">{t("preview.unavailable")}</p>
    );
  }

  return (
    <div className="file-preview">
      <span className="preview-label">{t("preview.label")}</span>
      {preview}
    </div>
  );
}
