/* In-app photo viewer. Clicking a photo used to open it in a NEW browser tab (window.open). On a phone that sends the app to
   the background, and when the person came back the app page was often reloaded and showed the sign-in screen — an approver
   looking at evidence photos lost their place and seemed to be logged out. Photos now open in an overlay INSIDE the app (see
   components/PhotoViewerHost.tsx): same tab, no navigation away, and the phone's Back button closes the viewer and returns to
   the report exactly as it was.

   viewPhoto(url, all?) — `all` is the list of urls of the same group, so the viewer can step through them. */
export const PHOTO_VIEW_EVENT = "app:view-photo";

export interface PhotoViewDetail { urls: string[]; index: number }

export function viewPhoto(url: string, all?: (string | undefined | null)[]): void {
  const urls = (all && all.length ? all : [url]).filter((u): u is string => typeof u === "string" && u.length > 0);
  const index = Math.max(0, urls.indexOf(url));
  window.dispatchEvent(new CustomEvent<PhotoViewDetail>(PHOTO_VIEW_EVENT, { detail: { urls: urls.length ? urls : [url], index } }));
}
