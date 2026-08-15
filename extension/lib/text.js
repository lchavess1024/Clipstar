export function mergeTextAtSelection(value, start, end, text) {
  const current = String(value ?? "");
  const insertion = String(text ?? "");
  const safeStart = clampIndex(start, current.length);
  const safeEnd = Math.max(safeStart, clampIndex(end, current.length));

  return {
    value: current.slice(0, safeStart) + insertion + current.slice(safeEnd),
    cursor: safeStart + insertion.length
  };
}

export function isSupportedInputType(type) {
  return ["", "text", "search", "url", "tel", "email", "password"].includes(
    String(type || "").toLowerCase()
  );
}

function clampIndex(value, length) {
  const number = Number(value);
  if (!Number.isFinite(number)) return length;
  return Math.max(0, Math.min(Math.trunc(number), length));
}
