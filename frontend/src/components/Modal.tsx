import React from "react";

export default function Modal({
  open, wide, sub, title, footer, onClose, children
}: {
  open: boolean; wide?: boolean; sub: string; title: string;
  footer: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <div className="overlay open" onClick={onClose}></div>
      <div className="modal-shell open">
        <div className={"modal-box" + (wide ? " wide" : "")}>
          <div className="drawer-header">
            <div>
              <div className="micro-label">{sub}</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
            </div>
            <button className="btn-icon" onClick={onClose}>✕</button>
          </div>
          <div className="drawer-body">{children}</div>
          <div className="drawer-footer">{footer}</div>
        </div>
      </div>
    </>
  );
}
