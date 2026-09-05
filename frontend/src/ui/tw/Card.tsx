import React from "react";

/* Tailwind-utility version of the plain-CSS ../Card.tsx — kept in this
   separate `ui/tw/` subfolder specifically to avoid colliding with the
   existing `ui/Card.tsx` (already live, used by DrawingRequestForm.tsx
   etc., built on the app's plain `.card`/`.card-pad` CSS classes). This
   one is for pages being converted to Tailwind (starting with
   pages/Dashboard.tsx); references the app's real CSS custom properties
   directly (bg-[var(--bg-card)] etc.) instead of duplicating them as
   static Tailwind theme tokens, so dark mode (which swaps these vars'
   values under html.dark) keeps working with zero `dark:` variants
   needed here. */
export default function Card({
  padded = true, className = "", children, ...rest
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return (
    <div
      className={`rounded-radius-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-[var(--shadow-card)] ${padded ? "p-4 sm:p-5" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
