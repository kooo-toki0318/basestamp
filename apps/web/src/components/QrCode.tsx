import { useMemo } from "react";
import { encode } from "uqr";

type QrCodeProperties = {
  label: string;
  value: string;
};

export function QrCode({ label, value }: QrCodeProperties) {
  const qr = useMemo(() => encode(value, { border: 4, ecc: "M" }), [value]);
  const path = useMemo(() => {
    let value_ = "";
    for (const [rowIndex, row] of qr.data.entries()) {
      for (const [columnIndex, active] of row.entries()) {
        if (active) {
          value_ +=
            "M" +
            String(columnIndex) +
            " " +
            String(rowIndex) +
            "h1v1h-1z";
        }
      }
    }
    return value_;
  }, [qr.data]);

  return (
    <svg
      className="handoff-qr"
      viewBox={"0 0 " + String(qr.size) + " " + String(qr.size)}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="white" />
      <path d={path} fill="currentColor" />
    </svg>
  );
}
