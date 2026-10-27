"use client";

import { Upload, X } from "lucide-react";
import { useId, useRef } from "react";

export function FilePicker({ file, onChange, label = "选择文件", accept = ".xlsx", maxMB = 20, disabled = false }: {
  file: File | null; onChange: (file: File | null) => void; label?: string; accept?: string; maxMB?: number; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  return <div className="file-picker">
    <input ref={input} id={id} hidden tabIndex={-1} aria-hidden="true" type="file" accept={accept} disabled={disabled} aria-label={label} onChange={(event) => { onChange(event.target.files?.[0] ?? null); event.target.value = ""; }} />
    <button type="button" className="secondary-action" disabled={disabled} onClick={() => input.current?.click()}><Upload size={16} />{file ? "更换文件" : label}</button>
    <span className="file-picker-info">{file ? <><strong>{file.name}</strong><small>{(file.size / 1024).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} KB</small></> : <small>{accept} · 最大 {maxMB} MB</small>}</span>
    {file && <button type="button" className="icon-button" disabled={disabled} aria-label={`移除 ${file.name}`} onClick={() => { if (input.current) input.current.value = ""; onChange(null); }}><X size={16} /></button>}
  </div>;
}
