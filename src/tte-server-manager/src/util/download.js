/**
 * Triggers a browser download of `data` as pretty-printed JSON.
 *
 * `URL.revokeObjectURL` is deferred a tick rather than called synchronously after `click()` — some
 * browsers start the download asynchronously, and revoking immediately can race it.
 */
export function downloadJson(filename, data) {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);

	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();

	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A filesystem-safe filename from free text — strips anything but the characters most filesystems allow. */
export function slugForFilename(text) {
	return String(text ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "server";
}
