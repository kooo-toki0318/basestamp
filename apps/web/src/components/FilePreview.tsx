import { useEffect, useState } from "react";

const TEXT_PREVIEW_BYTES = 64 * 1024;
const IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "m4a", "mp3", "ogg", "wav"]);
const TEXT_EXTENSIONS = new Set(["csv", "json", "md", "text", "txt", "xml"]);

type FilePreviewProperties = {
  file: File;
};

function TextPreview({ file }: FilePreviewProperties) {
  const [text, setText] = useState("Loading preview…");

  useEffect(() => {
    let active = true;
    void file
      .slice(0, TEXT_PREVIEW_BYTES)
      .text()
      .then((value) => {
        if (active) setText(value);
      })
      .catch(() => {
        if (active) setText("Text preview is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [file]);

  return (
    <>
      <pre className="file-preview-text">{text}</pre>
      {file.size > TEXT_PREVIEW_BYTES && (
        <p className="muted">Preview limited to the first 64 KiB.</p>
      )}
    </>
  );
}

export function FilePreview({ file }: FilePreviewProperties) {
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
    preview = <img src={objectUrl} alt="Selected file preview" />;
  } else if (mimeType === "application/pdf" || extension === "pdf") {
    preview = (
      <iframe
        src={objectUrl}
        title="Selected PDF preview"
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
      <p className="muted">
        Inline preview is not available for this file type.
      </p>
    );
  }

  return (
    <div className="file-preview">
      <span className="preview-label">Local preview</span>
      {preview}
    </div>
  );
}
